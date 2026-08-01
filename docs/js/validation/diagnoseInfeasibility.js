import {
  getAllEmployees,
  getAllShiftTypes,
  getBusinessDays,
  getRequests,
  getRequirements,
  getRoleRequirements,
  getSettings,
} from "../db/index.js";
import {
  isoDate,
  monthDates,
  parseIsoDate,
} from "../utils/calendar.js";
import {
  employeeHasRole,
  englishLevelRank,
} from "../utils/restaurantSkills.js";
import { precheck } from "./precheck.js";

const KEY_SEPARATOR = "\u0000";

function personDayKey(employeeId, date) {
  return `${employeeId}${KEY_SEPARATOR}${date}`;
}

function requirementKey(date, shiftCode) {
  return `${date}${KEY_SEPARATOR}${shiftCode}`;
}

function addDays(value, offset) {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + offset);
  return isoDate(date);
}

function daysBetween(start, end) {
  const first = parseIsoDate(start);
  const last = parseIsoDate(end);
  return Math.round((last.getTime() - first.getTime()) / 86_400_000);
}

function skillSetting(settings, code, minimumLevel = "1") {
  const current = settings.skills?.[code] ?? {};
  return {
    minimum_level: current.minimum_level ?? minimumLevel,
    required_count: Number(current.required_count ?? 0),
    priority: current.priority === "hard" ? "hard" : "soft",
  };
}

export async function diagnoseInfeasibility(targetMonth) {
  const diagnostics = [];
  const seen = new Set();

  const add = (message, { day = null, condition = "" } = {}) => {
    if (seen.has(message)) return;
    seen.add(message);
    diagnostics.push({
      severity: "error",
      date: day,
      condition,
      message,
    });
  };

  for (const issue of await precheck(targetMonth)) {
    if (issue.severity !== "error") continue;
    const day = issue.message.split(/\s+/).find(
      (token) => token.length === 10 && token[4] === "-" && token[7] === "-",
    ) ?? null;
    add(issue.message, { day, condition: "事前チェック" });
  }

  let days;
  try {
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(String(targetMonth));
    if (!monthMatch || Number(monthMatch[1]) < 1) throw new Error();
    days = monthDates(targetMonth);
  } catch {
    return diagnostics;
  }
  const validDays = new Set(days);

  const [employees, shifts, requirements, requests, settings] = await Promise.all([
    getAllEmployees(),
    getAllShiftTypes(),
    getRequirements(targetMonth),
    getRequests(targetMonth),
    getSettings(),
  ]);
  const active = employees.filter((employee) => Boolean(employee.active));
  const workShifts = shifts.filter((shift) => Boolean(shift.is_work));
  const shiftCodes = new Set(workShifts.map((shift) => shift.shift_code));
  const restCodes = new Set(
    workShifts
      .filter((shift) => Boolean(shift.requires_rest_next_day))
      .map((shift) => shift.shift_code),
  );
  const requirementMap = new Map(
    requirements.map((requirement) => [
      requirementKey(requirement.date, requirement.shift_code),
      Number(requirement.required_count),
    ]),
  );
  const hardOff = new Set(
    requests
      .filter((request) => request.priority === "hard" && request.request_type === "off")
      .map((request) => personDayKey(request.employee_id, request.date)),
  );
  const hardFixed = new Map();
  for (const request of requests) {
    if (
      request.priority === "hard"
      && ["fixed", "prefer"].includes(request.request_type)
    ) {
      hardFixed.set(personDayKey(request.employee_id, request.date), request.shift_code);
    }
  }

  for (const employee of active) {
    const employeeId = employee.employee_id;
    const name = employee.name || employeeId;
    const available = days.length - days.filter(
      (day) => hardOff.has(personDayKey(employeeId, day)),
    ).length;
    const minimum = Number(employee.min_work_days ?? 0);
    const maximum = Math.min(
      Number(employee.max_work_days ?? days.length),
      days.length,
    );
    if (minimum > available) {
      add(
        `${name}（${employeeId}）は最低 ${minimum} 日勤務ですが、hard の休み希望を除くと勤務可能日は ${available} 日です。／この職員の当月の hard 休み希望を減らすか、最低勤務日数を下げてください。`,
        { condition: "月間最低勤務日数とhard休み希望" },
      );
    }
    if (minimum > maximum) {
      add(
        `${name}（${employeeId}）の最低勤務日数 ${minimum} 日が最大勤務日数 ${maximum} 日を超えています。／最低勤務日数を下げるか、最大勤務日数を上げてください。`,
        { condition: "月間勤務日数の上下限" },
      );
    }

    const fixedDays = [...hardFixed]
      .filter(([key, code]) => {
        const [fixedEmployeeId] = key.split(KEY_SEPARATOR);
        return fixedEmployeeId === employeeId && shiftCodes.has(code);
      })
      .map(([key]) => key.split(KEY_SEPARATOR)[1])
      .sort();
    const maxConsecutive = Math.max(1, Number(employee.max_consecutive_days ?? 1));
    let runStart = null;
    let runEnd = null;
    for (const day of [...fixedDays, null]) {
      const contiguous = runEnd && day && addDays(runEnd, 1) === day;
      if (day && (runEnd === null || contiguous)) {
        runStart ||= day;
        runEnd = day;
        continue;
      }
      if (
        runStart
        && runEnd
        && daysBetween(runStart, runEnd) + 1 > maxConsecutive
      ) {
        add(
          `${name}（${employeeId}）は ${runStart}〜${runEnd} に hard の勤務指定が連続しており、最大連続勤務 ${maxConsecutive} 日を超えています。／期間内の hard 希望を削除・「できる限り」に変更するか、最大連続勤務日数を増やしてください。`,
          { day: `${runStart}〜${runEnd}`, condition: "最大連続勤務日数" },
        );
      }
      runStart = day;
      runEnd = day;
    }

    for (const [key, code] of hardFixed) {
      const [fixedEmployeeId, day] = key.split(KEY_SEPARATOR);
      if (
        fixedEmployeeId !== employeeId
        || !validDays.has(day)
        || !shiftCodes.has(code)
      ) {
        continue;
      }
      if ((requirementMap.get(requirementKey(day, code)) ?? 0) === 0) {
        add(
          `${day} は ${code} の必要人数が 0 人ですが、${name}（${employeeId}）に hard の ${code} 勤務指定があります。／この日の ${code} の必要人数を増やすか、この hard 希望を削除・「できる限り」に変更してください。`,
          { day, condition: "hard勤務指定と必要人数" },
        );
      }
      if (code === "N" && !employee.night_allowed) {
        add(
          `${day} は夜勤指定ですが、${name}（${employeeId}）は夜勤不可に設定されています。／この職員を夜勤可に変更するか、夜勤の hard 希望を削除・別の勤務区分に変更してください。`,
          { day, condition: "夜勤可否とhard勤務指定" },
        );
      }
      if (restCodes.has(code)) {
        const nextDay = addDays(day, 1);
        const nextCode = hardFixed.get(personDayKey(employeeId, nextDay));
        if (nextCode && nextCode !== "O") {
          add(
            `${day} の ${code} は翌日休みが必要ですが、${nextDay} に hard の ${nextCode} 勤務指定があります。／翌日の hard 希望を削除・「できる限り」に変更するか、いずれかの勤務区分を変更してください。`,
            { day: `${day}・${nextDay}`, condition: "勤務区分の翌日休み" },
          );
        }
      }
    }
  }

  if (settings.restaurant_mode) {
    const [businessDayRows, roleRequirements] = await Promise.all([
      getBusinessDays(targetMonth),
      getRoleRequirements(targetMonth),
    ]);
    const businessDays = new Map(businessDayRows.map((row) => [row.date, row]));
    const openDays = days.filter((day) => {
      const required = [...shiftCodes].reduce(
        (sum, code) => sum + (requirementMap.get(requirementKey(day, code)) ?? 0),
        0,
      );
      const isOpen = businessDays.get(day)?.is_open ?? 1;
      return required > 0 && Boolean(isOpen);
    });

    const english = skillSetting(settings, "english_support", "basic");
    if (english.required_count > 0 && english.priority === "hard") {
      const requiredLevel = englishLevelRank(english.minimum_level);
      const eligible = active.filter((employee) => employeeHasRole(
        employee,
        "english_support",
        { skillLevel: requiredLevel },
      ));
      const needed = Math.max(1, english.required_count);
      for (const day of openDays) {
        if (settings.require_english_per_shift) {
          for (const code of shiftCodes) {
            if (
              (requirementMap.get(requirementKey(day, code)) ?? 0) > 0
              && eligible.length < needed
            ) {
              add(
                `${day} の ${code} は英語対応者が ${needed} 人必要ですが、候補者は ${eligible.length} 人です。／英語対応者を増やすか、必要レベル・人数を下げるか、優先度を「できる限り」に変更してください。`,
                { day, condition: "英語対応者の必要人数" },
              );
            }
          }
        } else if (eligible.length < needed) {
          add(
            `${day} は英語対応者が ${needed} 人必要ですが、候補者は ${eligible.length} 人です。／英語対応者を増やすか、必要レベル・人数を下げるか、優先度を「できる限り」に変更してください。`,
            { day, condition: "英語対応者の必要人数" },
          );
        }
      }
    }

    const roleNames = {
      opener: "開店作業",
      closer: "閉店作業",
      english_support: "英語対応",
      allergy_support: "アレルギー説明",
      peak_support: "ピーク対応",
    };
    for (const requirement of roleRequirements) {
      if (
        requirement.priority !== "hard"
        || !validDays.has(requirement.date)
        || !shiftCodes.has(requirement.shift_code)
      ) {
        continue;
      }
      const eligible = active.filter(
        (employee) => employeeHasRole(employee, requirement.role_code),
      );
      if (Number(requirement.required_count) > eligible.length) {
        const label = roleNames[requirement.role_code] ?? requirement.role_code;
        add(
          `${requirement.date} の ${requirement.shift_code} は ${label} が ${requirement.required_count} 人必要ですが、候補者は ${eligible.length} 人です。／対応可能な職員を増やすか、役割の必要人数を減らすか、優先度を「できる限り」に変更してください。`,
          {
            day: requirement.date,
            condition: `役割別必要人数（${label}）`,
          },
        );
      }
    }
  }

  if (!diagnostics.length) {
    add(
      "日付ごとの必要人数、hard希望、勤務日数、役割条件などの組み合わせが解なしになっています。条件を1つずつ緩和して再作成してください。",
      { condition: "複数条件の組み合わせ" },
    );
  }
  return diagnostics;
}
