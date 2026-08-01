import {
  getAllEmployees,
  getAllProductCampaigns,
  getAllShiftTypes,
  getAllStaffRelations,
  getBusinessDays,
  getRequests,
  getRequirements,
  getRoleRequirements,
  getSettings,
} from "../db/index.js";
import { isWeekend, monthDates } from "../utils/calendar.js";
import {
  SKILL_DEFINITIONS,
  employeeHasRole,
  employeeHasSkill,
  englishLevelRank,
  skillLevelLabel,
} from "../utils/restaurantSkills.js";

const REQUEST_TYPES = new Set(["off", "avoid", "prefer", "fixed"]);
const PRIORITIES = new Set(["hard", "soft"]);
const KEY_SEPARATOR = "\u0000";

function personDayKey(employeeId, date) {
  return `${employeeId}${KEY_SEPARATOR}${date}`;
}

function skillSetting(settings, code, minimumLevel = "1") {
  const current = settings.skills?.[code] ?? {};
  return {
    minimum_level: current.minimum_level ?? minimumLevel,
    required_count: Number(current.required_count ?? 0),
    priority: current.priority === "hard" ? "hard" : "soft",
  };
}

function addIssue(issues, severity, message) {
  issues.push({ severity, message });
}

export async function precheck(targetMonth) {
  const issues = [];
  let validDateList;
  try {
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(String(targetMonth));
    if (!monthMatch || Number(monthMatch[1]) < 1) throw new Error();
    validDateList = monthDates(targetMonth);
  } catch {
    return [{
      severity: "error",
      message: "対象年月は YYYY-MM 形式で指定してください。",
    }];
  }
  const validDates = new Set(validDateList);

  const [employees, shifts, requirements, requests, settings] = await Promise.all([
    getAllEmployees(),
    getAllShiftTypes(),
    getRequirements(targetMonth),
    getRequests(targetMonth),
    getSettings(),
  ]);
  const active = employees.filter((employee) => Boolean(employee.active));
  const shiftCodes = new Set(shifts.map((shift) => shift.shift_code));
  const employeeIds = new Set(employees.map((employee) => employee.employee_id));

  if (!active.length) {
    addIssue(issues, "error", "勤務対象の職員が登録されていません。");
  }
  if (!requirements.length) {
    addIssue(issues, "error", `${targetMonth} の必要人数が登録されていません。`);
  }

  for (const requirement of requirements) {
    if (!validDates.has(requirement.date)) {
      addIssue(issues, "error", `必要人数の日付 ${requirement.date} が対象年月外です。`);
    }
    if (!shiftCodes.has(requirement.shift_code)) {
      addIssue(issues, "error", `勤務区分 ${requirement.shift_code} が勤務区分マスタにありません。`);
    }
    if (Number(requirement.required_count) < 0) {
      addIssue(issues, "error", `${requirement.date} の必要人数が負の値です。`);
    }
  }

  for (const request of requests) {
    if (!employeeIds.has(request.employee_id)) {
      addIssue(issues, "error", `希望の職員ID ${request.employee_id} が職員マスタにありません。`);
    }
    if (!validDates.has(request.date)) {
      addIssue(issues, "error", `希望の日付 ${request.date} が対象年月外です。`);
    }
    if (request.shift_code && !shiftCodes.has(request.shift_code)) {
      addIssue(issues, "error", `希望の勤務区分 ${request.shift_code} が勤務区分マスタにありません。`);
    }
    if (!REQUEST_TYPES.has(request.request_type)) {
      addIssue(issues, "error", `希望種別 ${request.request_type} は使用できません。`);
    }
    if (!PRIORITIES.has(request.priority)) {
      addIssue(issues, "error", `優先度 ${request.priority} は hard または soft にしてください。`);
    }
  }

  const hardByPersonDay = new Map();
  for (const request of requests) {
    if (request.priority !== "hard") continue;
    const key = personDayKey(request.employee_id, request.date);
    const requested = request.request_type === "off"
      ? "O"
      : (request.shift_code || "O");
    if (["off", "fixed"].includes(request.request_type)) {
      if (!hardByPersonDay.has(key)) hardByPersonDay.set(key, new Set());
      hardByPersonDay.get(key).add(requested);
    }
  }
  for (const [key, codes] of hardByPersonDay) {
    if (codes.size <= 1) continue;
    const [employeeId, day] = key.split(KEY_SEPARATOR);
    addIssue(
      issues,
      "error",
      `${employeeId} の ${day} に矛盾する hard 希望（${[...codes].sort().join(", ")}）があります。`,
    );
  }

  const hardOff = new Set(
    requests
      .filter((request) => request.priority === "hard" && request.request_type === "off")
      .map((request) => personDayKey(request.employee_id, request.date)),
  );
  const hardFixed = new Map();
  for (const request of requests) {
    if (request.priority === "hard" && request.request_type === "fixed") {
      hardFixed.set(personDayKey(request.employee_id, request.date), request.shift_code);
    }
  }
  const requirementsByDate = new Map();
  for (const requirement of requirements) {
    if (!Number(requirement.required_count)) continue;
    if (!requirementsByDate.has(requirement.date)) requirementsByDate.set(requirement.date, []);
    requirementsByDate.get(requirement.date).push(requirement);
  }

  for (const [day, rows] of requirementsByDate) {
    const total = rows.reduce((sum, row) => sum + Number(row.required_count), 0);
    if (total > active.length) {
      addIssue(
        issues,
        "error",
        `${day} は合計 ${total} 人必要ですが、勤務対象者は ${active.length} 人です。`,
      );
    }
    for (const requirement of rows) {
      const eligible = active.filter((employee) => {
        const key = personDayKey(employee.employee_id, day);
        if (hardOff.has(key)) return false;
        if (requirement.shift_code === "N" && !employee.night_allowed) return false;
        const fixed = hardFixed.get(key);
        return !fixed || fixed === requirement.shift_code;
      });
      if (Number(requirement.required_count) > eligible.length) {
        addIssue(
          issues,
          "error",
          `${day} の ${requirement.shift_code} は ${requirement.required_count} 人必要ですが、割当可能候補は ${eligible.length} 人です。`,
        );
      }
    }
  }

  const totalRequired = requirements.reduce(
    (sum, requirement) => sum + Number(requirement.required_count),
    0,
  );
  const totalCapacity = active.reduce(
    (sum, employee) => sum + Number(employee.max_work_days),
    0,
  );
  if (totalRequired > totalCapacity) {
    addIssue(
      issues,
      "error",
      `月間必要勤務数 ${totalRequired} が職員の最大勤務日数合計 ${totalCapacity} を超えています。`,
    );
  }

  if (settings.restaurant_mode) {
    const [roleRequirements, allRelations, campaigns, businessDays] = await Promise.all([
      getRoleRequirements(targetMonth),
      getAllStaffRelations(),
      getAllProductCampaigns(),
      getBusinessDays(targetMonth),
    ]);
    const relations = allRelations.filter((relation) => Boolean(relation.active));

    const english = skillSetting(settings, "english_support", "basic");
    const requiresEnglish = english.required_count > 0;
    const requiredEnglishLevel = englishLevelRank(english.minimum_level);
    const englishStaff = active.filter((employee) => employeeHasRole(
      employee,
      "english_support",
      { skillLevel: requiredEnglishLevel },
    ));
    if (requiresEnglish && !englishStaff.length) {
      addIssue(
        issues,
        english.priority === "hard" ? "error" : "warning",
        "店舗設定の最低英語レベルを満たすスタッフが登録されていません。",
      );
    }
    if (requiresEnglish && englishStaff.length < english.required_count) {
      addIssue(
        issues,
        english.priority === "hard" ? "error" : "warning",
        `最低英語レベルを満たす対応者は ${english.required_count} 人必要ですが、登録は ${englishStaff.length} 人です。`,
      );
    }

    for (const definition of SKILL_DEFINITIONS) {
      if (["english_support", "new_product", "allergy_support"].includes(definition.code)) {
        continue;
      }
      const current = skillSetting(settings, definition.code);
      const eligible = active.filter((employee) => employeeHasSkill(
        employee,
        definition.code,
        current.minimum_level,
      ));
      if (current.priority === "hard" && current.required_count > eligible.length) {
        addIssue(
          issues,
          "error",
          `${definition.label}は${skillLevelLabel(definition.code, current.minimum_level)}以上が${current.required_count} 人必要ですが、対応可能者は ${eligible.length} 人です。`,
        );
      }
    }

    const openers = active.filter((employee) => employeeHasRole(employee, "opener"));
    const closers = active.filter((employee) => employeeHasRole(employee, "closer"));
    if (
      requirements.some((row) => row.shift_code === "E" && Number(row.required_count) > 0)
      && !openers.length
    ) {
      addIssue(issues, "error", "早番が必要ですが、開店作業可能なスタッフがいません。");
    }
    if (
      requirements.some((row) => row.shift_code === "L" && Number(row.required_count) > 0)
      && !closers.length
    ) {
      addIssue(issues, "error", "遅番が必要ですが、閉店作業可能なスタッフがいません。");
    }
    if (
      active.length
      && active.every((employee) => Boolean(employee.is_new_staff))
      && requirements.some((row) => Number(row.required_count) > 0)
    ) {
      addIssue(issues, "error", "勤務対象者が全員新人のため、新人だけの勤務を回避できません。");
    }

    const allergy = skillSetting(settings, "allergy_support");
    if (
      allergy.required_count > 0
      && !active.some((employee) => employeeHasRole(employee, "allergy_support"))
    ) {
      addIssue(
        issues,
        allergy.priority === "hard" ? "error" : "warning",
        "アレルギー説明対応可能なスタッフが登録されていません。",
      );
    }
    if (
      businessDays.some((row) => ["high", "very_high"].includes(row.demand_level))
      && !active.some((employee) => employeeHasRole(employee, "peak_support"))
    ) {
      addIssue(issues, "warning", "繁忙日がありますが、ピーク対応力2以上のスタッフがいません。");
    }

    const totalsByDay = new Map();
    for (const requirement of requirements) {
      totalsByDay.set(
        requirement.date,
        (totalsByDay.get(requirement.date) ?? 0) + Number(requirement.required_count),
      );
    }
    for (const businessDay of businessDays) {
      if (!["high", "very_high"].includes(businessDay.demand_level)) continue;
      const standard = Number(
        isWeekend(businessDay.date)
          ? settings.weekend_required
          : settings.weekday_required,
      );
      const total = totalsByDay.get(businessDay.date) ?? 0;
      if (standard && total < standard) {
        addIssue(
          issues,
          "warning",
          `${businessDay.date} は繁忙日ですが、必要人数合計 ${total} 人が店舗標準 ${standard} 人を下回っています。`,
        );
      }
    }

    const newProduct = skillSetting(settings, "new_product");
    for (const campaign of campaigns) {
      if (
        String(campaign.end_date) < `${targetMonth}-01`
        || String(campaign.start_date) > `${targetMonth}-31`
      ) {
        continue;
      }
      const skilled = active.filter(
        (employee) => Number(employee.new_product_skill ?? 0) >= Number(campaign.required_skill_level),
      );
      const requiredCount = Math.max(1, newProduct.required_count);
      if (skilled.length < requiredCount) {
        addIssue(
          issues,
          newProduct.required_count > 0 && newProduct.priority === "hard" ? "error" : "warning",
          `新商品「${campaign.product_name}」に必要な能力のスタッフが ${requiredCount} 人必要ですが、登録は ${skilled.length} 人です。`,
        );
      }
    }

    for (const requirement of roleRequirements) {
      if (!validDates.has(requirement.date)) {
        addIssue(
          issues,
          "error",
          `役割別必要人数の日付 ${requirement.date} が対象年月外です。`,
        );
        continue;
      }
      if (!shiftCodes.has(requirement.shift_code)) {
        addIssue(
          issues,
          "error",
          `役割条件の勤務区分 ${requirement.shift_code} がマスタにありません。`,
        );
        continue;
      }
      const eligible = active.filter((employee) => employeeHasRole(employee, requirement.role_code));
      if (requirement.priority === "hard" && Number(requirement.required_count) > eligible.length) {
        addIssue(
          issues,
          "error",
          `${requirement.date} ${requirement.shift_code} の役割 ${requirement.role_code} は ${requirement.required_count} 人必要ですが、対応可能者は ${eligible.length} 人です。`,
        );
      }
    }

    const fixedLookup = new Map();
    for (const request of requests) {
      if (request.priority === "hard" && request.request_type === "fixed") {
        fixedLookup.set(personDayKey(request.employee_id, request.date), request.shift_code);
      }
    }
    for (const relation of relations) {
      if (relation.employee_id_1 === relation.employee_id_2) {
        addIssue(issues, "error", "スタッフ配置条件に同じスタッフ同士の組み合わせがあります。");
      }
      if (relation.relation_type === "never_together" && relation.priority === "hard") {
        for (const day of validDates) {
          const first = fixedLookup.get(personDayKey(relation.employee_id_1, day));
          const second = fixedLookup.get(personDayKey(relation.employee_id_2, day));
          if (first && first === second) {
            addIssue(
              issues,
              "error",
              `${day} の同時配置禁止と必須の勤務指定が矛盾しています（${relation.employee_id_1}・${relation.employee_id_2}）。`,
            );
            break;
          }
        }
      }
    }
  }

  if (!issues.some((issue) => issue.severity === "error")) {
    addIssue(issues, "info", "事前チェックで明らかな矛盾は見つかりませんでした。");
  }
  return issues;
}

export function blockingIssues(issues) {
  return issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message);
}
