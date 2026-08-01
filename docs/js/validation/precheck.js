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
const MAX_SUBSET_ELIGIBILITY_ISSUES = 10;

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
      message: "対象年月は YYYY-MM 形式で指定してください。／対象年月を例「2026-08」の形式に修正してください。",
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
  const workShiftCodes = new Set(
    shifts.filter((shift) => Boolean(shift.is_work)).map((shift) => shift.shift_code),
  );
  const employeeIds = new Set(employees.map((employee) => employee.employee_id));

  if (!active.length) {
    addIssue(issues, "error", "勤務対象の職員が登録されていません。／職員マスタで勤務対象の職員を1人以上有効にしてください。");
  }
  if (!requirements.length) {
    addIssue(issues, "error", `${targetMonth} の必要人数が登録されていません。／必要人数画面で対象月の必要人数を登録してください。`);
  }

  for (const requirement of requirements) {
    if (!validDates.has(requirement.date)) {
      addIssue(issues, "error", `必要人数の日付 ${requirement.date} が対象年月外です。／対象年月内の日付に修正するか、この必要人数を削除してください。`);
    }
    if (!shiftCodes.has(requirement.shift_code)) {
      addIssue(issues, "error", `勤務区分 ${requirement.shift_code} が勤務区分マスタにありません。／勤務区分マスタに追加するか、必要人数の勤務区分を登録済みのものに修正してください。`);
    }
    if (Number(requirement.required_count) < 0) {
      addIssue(issues, "error", `${requirement.date} の必要人数が負の値です。／必要人数を 0 人以上に修正してください。`);
    }
  }

  for (const request of requests) {
    if (!employeeIds.has(request.employee_id)) {
      addIssue(issues, "error", `希望の職員ID ${request.employee_id} が職員マスタにありません。／職員を登録するか、この希望の職員を登録済みの職員に修正してください。`);
    }
    if (!validDates.has(request.date)) {
      addIssue(issues, "error", `希望の日付 ${request.date} が対象年月外です。／対象年月内の日付に修正するか、この希望を削除してください。`);
    }
    if (request.shift_code && !shiftCodes.has(request.shift_code)) {
      addIssue(issues, "error", `希望の勤務区分 ${request.shift_code} が勤務区分マスタにありません。／勤務区分マスタに追加するか、この希望を登録済みの勤務区分に修正してください。`);
    }
    if (!REQUEST_TYPES.has(request.request_type)) {
      addIssue(issues, "error", `希望種別 ${request.request_type} は使用できません。／希望種別を「希望休」「避けたい勤務」「希望勤務」「勤務指定」のいずれかに修正してください。`);
    }
    if (!PRIORITIES.has(request.priority)) {
      addIssue(issues, "error", `優先度 ${request.priority} は hard または soft にしてください。／優先度を「必須」または「できる限り」に修正してください。`);
    }
  }

  const hardByPersonDay = new Map();
  const hardAvoidedByPersonDay = new Map();
  const hardFixedByPersonDay = new Map();
  const hardPreferredByPersonDay = new Map();
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
    if (request.request_type === "fixed" && workShiftCodes.has(requested)) {
      if (!hardFixedByPersonDay.has(key)) hardFixedByPersonDay.set(key, new Set());
      hardFixedByPersonDay.get(key).add(requested);
    }
    if (request.request_type === "prefer" && workShiftCodes.has(requested)) {
      if (!hardPreferredByPersonDay.has(key)) hardPreferredByPersonDay.set(key, new Set());
      hardPreferredByPersonDay.get(key).add(requested);
    }
    if (request.request_type === "avoid") {
      if (!hardAvoidedByPersonDay.has(key)) hardAvoidedByPersonDay.set(key, new Set());
      hardAvoidedByPersonDay.get(key).add(requested);
    }
  }
  for (const [key, codes] of hardByPersonDay) {
    if (codes.size <= 1) continue;
    const [employeeId, day] = key.split(KEY_SEPARATOR);
    addIssue(
      issues,
      "error",
      `${employeeId} の ${day} に矛盾する hard 希望（${[...codes].sort().join(", ")}）があります。／同じ職員・同じ日の hard 希望のどちらかを削除するか、優先度を「できる限り」に変更してください。`,
    );
  }
  for (const [key, fixedCodes] of hardFixedByPersonDay) {
    const preferredCodes = hardPreferredByPersonDay.get(key);
    if (!preferredCodes) continue;
    const [employeeId, day] = key.split(KEY_SEPARATOR);
    for (const fixedCode of [...fixedCodes].sort()) {
      for (const preferredCode of [...preferredCodes].sort()) {
        if (fixedCode === preferredCode) continue;
        addIssue(
          issues,
          "error",
          `${employeeId} の ${day} は hard の勤務指定 ${fixedCode} と希望勤務 ${preferredCode} が矛盾しています。／競合する hard 希望のどちらかを削除するか、優先度を「できる限り」に変更してください。`,
        );
      }
    }
  }
  for (const [key, pinnedCodes] of hardByPersonDay) {
    const avoidedCodes = hardAvoidedByPersonDay.get(key);
    if (!avoidedCodes) continue;
    const conflicts = [...pinnedCodes].filter((code) => avoidedCodes.has(code)).sort();
    if (!conflicts.length) continue;
    const [employeeId, day] = key.split(KEY_SEPARATOR);
    addIssue(
      issues,
      "error",
      `${employeeId} の ${day} は hard 希望で ${conflicts.join(", ")} に固定されていますが、同じ勤務区分を避ける hard 希望もあります。／競合する hard 希望のどちらかを削除するか、優先度を「できる限り」に変更してください。`,
    );
  }

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
  const isEligible = (employee, shiftCode, day) => {
    const key = personDayKey(employee.employee_id, day);
    if (hardOff.has(key)) return false;
    if (hardAvoidedByPersonDay.get(key)?.has(shiftCode)) return false;
    if (shiftCode === "N" && !employee.night_allowed) return false;
    const fixed = hardFixed.get(key);
    return !fixed || fixed === shiftCode;
  };
  const requirementsByDate = new Map();
  for (const requirement of requirements) {
    if (!Number(requirement.required_count)) continue;
    if (!requirementsByDate.has(requirement.date)) requirementsByDate.set(requirement.date, []);
    requirementsByDate.get(requirement.date).push(requirement);
  }

  let subsetEligibilityIssueCount = 0;
  let omittedSubsetEligibilityIssueCount = 0;
  for (const [day, rows] of requirementsByDate) {
    const total = rows.reduce((sum, row) => sum + Number(row.required_count), 0);
    if (total > active.length) {
      addIssue(
        issues,
        "error",
        `${day} は合計 ${total} 人必要ですが、勤務対象者は ${active.length} 人です。／この日の必要人数を減らすか、勤務対象の職員を増やしてください。`,
      );
    }
    const demandByCode = new Map();
    for (const requirement of rows) {
      if (
        Number(requirement.required_count) <= 0
        || !workShiftCodes.has(requirement.shift_code)
      ) continue;
      demandByCode.set(
        requirement.shift_code,
        (demandByCode.get(requirement.shift_code) || 0) + Number(requirement.required_count),
      );
    }
    const workCodes = [...demandByCode.keys()];
    const eligibleByCode = new Map();
    const singleShiftShortfalls = new Set();
    for (const requirement of rows) {
      const eligible = active.filter((employee) => (
        isEligible(employee, requirement.shift_code, day)
      ));
      eligibleByCode.set(
        requirement.shift_code,
        new Set(eligible.map((employee) => employee.employee_id)),
      );
      if (Number(requirement.required_count) > eligible.length) {
        singleShiftShortfalls.add(requirement.shift_code);
        addIssue(
          issues,
          "error",
          `${day} の ${requirement.shift_code} は ${requirement.required_count} 人必要ですが、割当可能候補は ${eligible.length} 人です。／必要人数を減らすか、該当日の hard 希望・夜勤可否・勤務対象設定を見直してください。`,
        );
      }
    }
    if (workCodes.length > 20) continue;

    const explainingMasks = workCodes
      .map((code, index) => (singleShiftShortfalls.has(code) ? 1 << index : 0))
      .filter(Boolean);
    const subsetLimit = 1 << workCodes.length;
    for (let subsetSize = 2; subsetSize <= workCodes.length; subsetSize += 1) {
      for (let subsetMask = 1; subsetMask < subsetLimit; subsetMask += 1) {
        let bitCount = 0;
        for (let remaining = subsetMask; remaining; remaining &= remaining - 1) bitCount += 1;
        if (bitCount !== subsetSize) continue;
        if (explainingMasks.some((mask) => (subsetMask & mask) === mask)) continue;

        let demand = 0;
        const pool = new Set();
        const codes = [];
        for (let index = 0; index < workCodes.length; index += 1) {
          if (!(subsetMask & (1 << index))) continue;
          const code = workCodes[index];
          codes.push(code);
          demand += demandByCode.get(code);
          for (const employeeId of eligibleByCode.get(code)) pool.add(employeeId);
        }
        if (pool.size >= demand) continue;

        explainingMasks.push(subsetMask);
        if (subsetEligibilityIssueCount < MAX_SUBSET_ELIGIBILITY_ISSUES) {
          addIssue(
            issues,
            "error",
            `${day} は ${codes.join("・")} の合計必要人数 ${demand} 人に対し、これらの勤務に割当可能な職員は ${pool.size} 人しかいません。／必要人数を減らすか、対応可能な職員を増やす、または該当日の hard 希望・夜勤可否を見直してください。`,
          );
          subsetEligibilityIssueCount += 1;
        } else {
          omittedSubsetEligibilityIssueCount += 1;
        }
      }
    }
  }
  if (omittedSubsetEligibilityIssueCount) {
    addIssue(
      issues,
      "error",
      `必要人数の組み合わせに対する割当可能候補の不足がほかに ${omittedSubsetEligibilityIssueCount} 件あります（表示上限 ${MAX_SUBSET_ELIGIBILITY_ISSUES} 件）。／表示された日付から順に必要人数や hard 希望・夜勤可否を見直してください。`,
    );
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
      `月間必要勤務数 ${totalRequired} が職員の最大勤務日数合計 ${totalCapacity} を超えています。／月間の必要人数を減らすか、職員の最大勤務日数または勤務対象者を増やしてください。`,
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
    const activeEmployeeMap = new Map(active.map(
      (employee) => [String(employee.employee_id), employee],
    ));

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
        english.priority === "hard"
          ? "店舗設定の最低英語レベルを満たすスタッフが登録されていません。／条件を満たす職員を登録するか、必要レベル・人数を下げるか、優先度を「できる限り」に変更してください。"
          : "店舗設定の最低英語レベルを満たすスタッフが登録されていません。",
      );
    }
    if (requiresEnglish && englishStaff.length < english.required_count) {
      addIssue(
        issues,
        english.priority === "hard" ? "error" : "warning",
        english.priority === "hard"
          ? `最低英語レベルを満たす対応者は ${english.required_count} 人必要ですが、登録は ${englishStaff.length} 人です。／英語対応者を増やすか、必要レベル・人数を下げるか、優先度を「できる限り」に変更してください。`
          : `最低英語レベルを満たす対応者は ${english.required_count} 人必要ですが、登録は ${englishStaff.length} 人です。`,
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
          `${definition.label}は${skillLevelLabel(definition.code, current.minimum_level)}以上が${current.required_count} 人必要ですが、対応可能者は ${eligible.length} 人です。／対応可能な職員を増やすか、必要レベル・人数を下げるか、優先度を「できる限り」に変更してください。`,
        );
      }
    }

    const openers = active.filter((employee) => employeeHasRole(employee, "opener"));
    const closers = active.filter((employee) => employeeHasRole(employee, "closer"));
    if (
      requirements.some((row) => row.shift_code === "E" && Number(row.required_count) > 0)
      && !openers.length
    ) {
      addIssue(issues, "error", "早番が必要ですが、開店作業可能なスタッフがいません。／職員に開店作業の役割を設定するか、早番の必要人数を 0 人にしてください。");
    }
    if (
      requirements.some((row) => row.shift_code === "L" && Number(row.required_count) > 0)
      && !closers.length
    ) {
      addIssue(issues, "error", "遅番が必要ですが、閉店作業可能なスタッフがいません。／職員に閉店作業の役割を設定するか、遅番の必要人数を 0 人にしてください。");
    }
    if (
      active.length
      && active.every((employee) => Boolean(employee.is_new_staff))
      && requirements.some((row) => Number(row.required_count) > 0)
    ) {
      addIssue(issues, "error", "勤務対象者が全員新人のため、新人だけの勤務を回避できません。／経験者を勤務対象に追加するか、職員の新人設定を見直してください。");
    }

    const allergy = skillSetting(settings, "allergy_support");
    if (
      allergy.required_count > 0
      && !active.some((employee) => employeeHasRole(employee, "allergy_support"))
    ) {
      addIssue(
        issues,
        allergy.priority === "hard" ? "error" : "warning",
        allergy.priority === "hard"
          ? "アレルギー説明対応可能なスタッフが登録されていません。／職員にアレルギー説明対応の役割を設定するか、必要人数を下げるか、優先度を「できる限り」に変更してください。"
          : "アレルギー説明対応可能なスタッフが登録されていません。",
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
        const isHard = newProduct.required_count > 0 && newProduct.priority === "hard";
        addIssue(
          issues,
          isHard ? "error" : "warning",
          isHard
            ? `新商品「${campaign.product_name}」に必要な能力のスタッフが ${requiredCount} 人必要ですが、登録は ${skilled.length} 人です。／対応可能な職員を増やすか、必要レベル・人数を下げるか、優先度を「できる限り」に変更してください。`
            : `新商品「${campaign.product_name}」に必要な能力のスタッフが ${requiredCount} 人必要ですが、登録は ${skilled.length} 人です。`,
        );
      }
    }

    for (const requirement of roleRequirements) {
      if (!validDates.has(requirement.date)) {
        addIssue(
          issues,
          "error",
          `役割別必要人数の日付 ${requirement.date} が対象年月外です。／対象年月内の日付に修正するか、この役割条件を削除してください。`,
        );
        continue;
      }
      if (!shiftCodes.has(requirement.shift_code)) {
        addIssue(
          issues,
          "error",
          `役割条件の勤務区分 ${requirement.shift_code} がマスタにありません。／勤務区分マスタに追加するか、役割条件を登録済みの勤務区分に修正してください。`,
        );
        continue;
      }
      const eligible = active.filter((employee) => employeeHasRole(employee, requirement.role_code));
      if (requirement.priority === "hard" && Number(requirement.required_count) > eligible.length) {
        addIssue(
          issues,
          "error",
          `${requirement.date} ${requirement.shift_code} の役割 ${requirement.role_code} は ${requirement.required_count} 人必要ですが、対応可能者は ${eligible.length} 人です。／対応可能な職員を増やすか、役割の必要人数を減らすか、優先度を「できる限り」に変更してください。`,
        );
      }
    }

    const fixedLookup = new Map();
    for (const request of requests) {
      if (
        request.priority === "hard"
        && request.request_type === "fixed"
      ) {
        fixedLookup.set(personDayKey(request.employee_id, request.date), request.shift_code);
      }
    }
    for (const relation of relations) {
      if (relation.employee_id_1 === relation.employee_id_2) {
        addIssue(issues, "error", "スタッフ配置条件に同じスタッフ同士の組み合わせがあります。／この配置条件を削除するか、異なる2人の職員を指定してください。");
      }
      if (relation.relation_type === "prefer_together" && relation.priority === "hard") {
        const employee1 = activeEmployeeMap.get(String(relation.employee_id_1));
        const employee2 = activeEmployeeMap.get(String(relation.employee_id_2));
        if (employee1 && employee2) {
          const minimum1 = Number(employee1.min_work_days);
          const maximum1 = Number(employee1.max_work_days);
          const minimum2 = Number(employee2.min_work_days);
          const maximum2 = Number(employee2.max_work_days);
          const lowerBound = Math.max(minimum1, minimum2);
          const upperBound = Math.min(maximum1, maximum2);
          if (lowerBound > upperBound) {
            const label1 = `${employee1.name || employee1.employee_id}（${employee1.employee_id}）`;
            const label2 = `${employee2.name || employee2.employee_id}（${employee2.employee_id}）`;
            addIssue(
              issues,
              "error",
              `必須の同時配置を優先する条件ですが、${label1} の勤務日数範囲 ${minimum1}～${maximum1} 日と ${label2} の勤務日数範囲 ${minimum2}～${maximum2} 日が重なりません。／いずれかの職員の最低・最大勤務日数を範囲が重なるように調整するか、配置条件の優先度を「できる限り」に変更・削除してください。`,
            );
          }
        }
      }
      if (relation.relation_type === "never_together" && relation.priority === "hard") {
        for (const day of validDates) {
          const first = fixedLookup.get(personDayKey(relation.employee_id_1, day));
          const second = fixedLookup.get(personDayKey(relation.employee_id_2, day));
          if (first && first === second) {
            addIssue(
              issues,
              "error",
              `${day} の同時配置禁止と必須の勤務指定が矛盾しています（${relation.employee_id_1}・${relation.employee_id_2}）。／同時配置禁止またはいずれかの hard 希望を削除するか、優先度を「できる限り」に変更してください。`,
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
