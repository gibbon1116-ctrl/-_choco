import {
  getAllEmployees,
  getAllProductCampaigns,
  getAllStaffRelations,
  getBusinessDays,
  getRequirements,
  getRoleRequirements,
  getSettings,
} from "../db/index.js";
import {
  CATEGORY_SKILL_FIELDS,
  RELATION_LABELS,
  ROLE_LABELS,
  SKILL_DEFINITIONS,
  employeeHasRole,
  employeeHasSkill,
} from "../utils/restaurantSkills.js";
import { isoDate, parseIsoDate } from "../utils/calendar.js";

const KEY_SEPARATOR = "\u0000";

function shiftKey(date, shiftCode) {
  return `${date}${KEY_SEPARATOR}${shiftCode}`;
}

function assignmentKey(employeeId, date) {
  return `${employeeId}${KEY_SEPARATOR}${date}`;
}

function addDays(value, offset) {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + offset);
  return isoDate(date);
}

function settingFor(settings, code) {
  return settings.skills?.[code] ?? {};
}

function campaignsForDay(day, campaigns) {
  return campaigns.filter(
    (campaign) => String(campaign.start_date) <= day && day <= String(campaign.end_date),
  );
}

export async function restaurantConditionChecks(
  targetMonth,
  assignments,
  { data = null } = {},
) {
  const source = data ?? {};
  const [
    settings,
    employeeRows,
    businessDayRows,
    campaigns,
    roleRequirements,
    relationRows,
    requirements,
  ] = await Promise.all([
    source.settings ?? getSettings(),
    source.employees ?? getAllEmployees(),
    source.businessDays ?? getBusinessDays(targetMonth),
    source.campaigns ?? getAllProductCampaigns(),
    source.roleRequirements ?? getRoleRequirements(targetMonth),
    source.staffRelations ?? getAllStaffRelations(),
    source.requirements ?? getRequirements(targetMonth),
  ]);
  if (!settings.restaurant_mode) return [];

  const employees = new Map(employeeRows.filter(
    (employee) => Boolean(employee.active),
  ).map((employee) => [String(employee.employee_id), employee]));
  const businessDays = new Map(businessDayRows.map((row) => [String(row.date), row]));
  const relations = relationRows.filter((relation) => Boolean(relation.active));
  const requiredByDay = new Map();
  for (const row of requirements) {
    const date = String(row.date);
    requiredByDay.set(date, (requiredByDay.get(date) ?? 0) + Number(row.required_count));
  }

  const assignedByDay = new Map();
  const assignedByShift = new Map();
  const shiftFor = new Map();
  for (const assignment of assignments ?? []) {
    const employeeId = String(assignment.employee_id);
    const date = String(assignment.date);
    const shiftCode = String(assignment.shift_code);
    shiftFor.set(assignmentKey(employeeId, date), shiftCode);
    if (shiftCode === "O") continue;
    if (!assignedByDay.has(date)) assignedByDay.set(date, []);
    assignedByDay.get(date).push(employeeId);
    const key = shiftKey(date, shiftCode);
    if (!assignedByShift.has(key)) assignedByShift.set(key, []);
    assignedByShift.get(key).push(employeeId);
  }

  const rows = [];
  const add = (date, category, passed, detail, priority = "soft") => rows.push({
    日付: date,
    確認項目: category,
    結果: passed ? "充足" : "要確認",
    優先度: priority === "hard" ? "必須" : "できる限り",
    内容: detail,
  });

  const allDays = [...new Set((assignments ?? []).map(
    (assignment) => String(assignment.date),
  ))].sort();
  for (const day of allDays) {
    const savedInfo = businessDays.get(day);
    if (savedInfo && !Boolean(savedInfo.is_open ?? 1)) continue;
    if ((requiredByDay.get(day) ?? 0) <= 0 && !savedInfo) continue;
    const info = savedInfo ?? {};
    const workers = (assignedByDay.get(day) ?? []).map(
      (employeeId) => employees.get(employeeId),
    ).filter(Boolean);

    const english = settingFor(settings, "english_support");
    if (Number(english.required_count ?? 0) > 0) {
      const needed = Number(english.required_count);
      const count = workers.filter((employee) => employeeHasSkill(
        employee,
        "english_support",
        english.minimum_level ?? "basic",
      )).length;
      add(day, "英語対応", count >= needed, `英語対応者 ${count}/${needed}人`, english.priority ?? "hard");
    }

    const allergy = settingFor(settings, "allergy_support");
    if (Number(allergy.required_count ?? 0) > 0) {
      const needed = Number(allergy.required_count);
      const count = workers.filter(
        (employee) => employeeHasSkill(employee, "allergy_support"),
      ).length;
      add(day, "アレルギー説明", count >= needed, `説明対応者 ${count}/${needed}人`, allergy.priority ?? "soft");
    }

    const activeCampaigns = campaignsForDay(day, campaigns);
    if (activeCampaigns.length || Boolean(info.new_product_active)) {
      const newProduct = settingFor(settings, "new_product");
      const configuredLevel = Number(newProduct.minimum_level ?? 1);
      const requiredLevel = Math.max(
        configuredLevel,
        ...(activeCampaigns.length
          ? activeCampaigns.map((campaign) => Number(campaign.required_skill_level ?? 2))
          : [1]),
      );
      const needed = Number(newProduct.required_count ?? 0);
      const count = workers.filter(
        (employee) => Number(employee.new_product_skill ?? 0) >= requiredLevel,
      ).length;
      const names = activeCampaigns.map(
        (campaign) => campaign.product_name,
      ).join("、") || "新商品";
      if (needed > 0) {
        add(
          day,
          "新商品対応",
          count >= needed,
          `${names}: 対応者 ${count}/${needed}人`,
          newProduct.priority ?? "soft",
        );
      }

      for (const campaign of activeCampaigns) {
        if (
          Boolean(campaign.require_leader_first_week)
          && day < addDays(String(campaign.start_date), 7)
        ) {
          const leaderCount = workers.filter(
            (employee) => Number(employee.new_product_skill ?? 0) >= 3,
          ).length;
          add(
            day,
            "新商品初週",
            leaderCount >= 1,
            `${campaign.product_name}: 指導可能者 ${leaderCount}/1人`,
            "soft",
          );
        }
        const skillField = CATEGORY_SKILL_FIELDS[campaign.category];
        if (skillField) {
          const categoryCount = workers.filter(
            (employee) => Number(employee[skillField] ?? 0) >= requiredLevel,
          ).length;
          add(
            day,
            "商品カテゴリ",
            categoryCount >= 1,
            `${campaign.product_name}: カテゴリ対応者 ${categoryCount}/1人`,
            "soft",
          );
        }
      }
    }

    for (const definition of SKILL_DEFINITIONS) {
      if (["english_support", "new_product", "allergy_support"].includes(definition.code)) {
        continue;
      }
      const setting = settingFor(settings, definition.code);
      const needed = Number(setting.required_count ?? 0);
      if (needed <= 0) continue;
      const count = workers.filter((employee) => employeeHasSkill(
        employee,
        definition.code,
        setting.minimum_level ?? 1,
      )).length;
      add(
        day,
        definition.label,
        count >= needed,
        `対応者 ${count}/${needed}人`,
        setting.priority ?? "soft",
      );
    }
  }

  for (const requirement of roleRequirements) {
    const memberIds = assignedByShift.get(
      shiftKey(requirement.date, requirement.shift_code),
    ) ?? [];
    const members = memberIds.map((employeeId) => employees.get(employeeId)).filter(Boolean);
    const count = members.filter(
      (employee) => employeeHasRole(employee, requirement.role_code),
    ).length;
    const needed = Number(requirement.required_count);
    add(
      requirement.date,
      "役割配置",
      count >= needed,
      `${requirement.shift_code}・${ROLE_LABELS[requirement.role_code] ?? requirement.role_code} ${count}/${needed}人`,
      requirement.priority,
    );
  }

  for (const [key, ids] of [...assignedByShift].sort()) {
    const [day, shiftCode] = key.split(KEY_SEPARATOR);
    const members = ids.map((employeeId) => employees.get(employeeId)).filter(Boolean);
    if (members.length && members.every((employee) => Boolean(employee.is_new_staff))) {
      add(day, "新人フォロー", false, `${shiftCode} が新人スタッフのみです。`, "hard");
    }
    if (shiftCode === "E") {
      const count = members.filter((employee) => employeeHasRole(employee, "opener")).length;
      add(day, "開店対応", count >= 1, `${shiftCode}・開店対応者 ${count}/1人`, "hard");
    }
    if (shiftCode === "L") {
      const count = members.filter((employee) => employeeHasRole(employee, "closer")).length;
      add(day, "閉店対応", count >= 1, `${shiftCode}・閉店対応者 ${count}/1人`, "hard");
    }
  }

  const highDays = new Set(businessDayRows.filter(
    (row) => ["high", "very_high"].includes(row.demand_level),
  ).map((row) => String(row.date)));
  const mentorGroups = new Map();
  for (const relation of relations) {
    if (relation.relation_type !== "mentor_pair") continue;
    const employeeId1 = String(relation.employee_id_1);
    const employeeId2 = String(relation.employee_id_2);
    const employee1 = employees.get(employeeId1);
    const employee2 = employees.get(employeeId2);
    if (!employee1 || !employee2) continue;

    const employee1IsMentee = Boolean(employee1.is_new_staff)
      && !Boolean(employee1.can_train_new_staff);
    const employee1IsMentor = Boolean(employee1.can_train_new_staff)
      && !Boolean(employee1.is_new_staff);
    const employee2IsMentee = Boolean(employee2.is_new_staff)
      && !Boolean(employee2.can_train_new_staff);
    const employee2IsMentor = Boolean(employee2.can_train_new_staff)
      && !Boolean(employee2.is_new_staff);
    const firstToSecond = employee1IsMentee && employee2IsMentor;
    const secondToFirst = employee2IsMentee && employee1IsMentor;
    if (firstToSecond === secondToFirst) continue;

    const menteeId = firstToSecond ? employeeId1 : employeeId2;
    const mentorId = firstToSecond ? employeeId2 : employeeId1;
    const group = mentorGroups.get(menteeId) ?? {
      mentors: new Set(),
      hard: false,
      softWeight: 0,
    };
    group.mentors.add(mentorId);
    if (relation.priority === "hard") {
      group.hard = true;
    } else {
      group.softWeight = Math.max(group.softWeight, Number(relation.weight) || 0);
    }
    mentorGroups.set(menteeId, group);
  }

  for (const relation of relations) {
    const employeeId1 = String(relation.employee_id_1);
    const employeeId2 = String(relation.employee_id_2);
    for (const day of allDays) {
      const shift1 = shiftFor.get(assignmentKey(employeeId1, day)) ?? "O";
      const shift2 = shiftFor.get(assignmentKey(employeeId2, day)) ?? "O";
      const same = shift1 === shift2 && shift1 !== "O";
      const bothWork = shift1 !== "O" && shift2 !== "O";
      const eitherWork = shift1 !== "O" || shift2 !== "O";
      const type = relation.relation_type;
      const violated = (
        (["avoid_together", "never_together"].includes(type) && same)
        || (type === "avoid_closing_pair" && same && shift1 === "L")
        || (type === "prefer_together" && eitherWork && !bothWork)
        || (type === "prefer_peak_pair" && highDays.has(day) && eitherWork && !bothWork)
      );
      if (violated) {
        add(
          day,
          "スタッフ配置条件",
          false,
          `${RELATION_LABELS[type] ?? type}（${employeeId1}・${employeeId2}）`,
          relation.priority,
        );
      }
    }
  }

  const employeeLabel = (employeeId) => {
    const name = String(employees.get(employeeId)?.name ?? "").trim();
    return name ? `${name}（${employeeId}）` : employeeId;
  };
  for (const [menteeId, group] of mentorGroups) {
    const mentorIds = [...group.mentors];
    const mentorLabels = mentorIds.map(employeeLabel).join("、");
    for (const day of allDays) {
      const menteeShift = shiftFor.get(assignmentKey(menteeId, day)) ?? "O";
      if (menteeShift === "O") continue;
      const hasMentor = mentorIds.some(
        (mentorId) => shiftFor.get(assignmentKey(mentorId, day)) === menteeShift,
      );
      if (!hasMentor) {
        add(
          day,
          "スタッフ配置条件",
          false,
          `${RELATION_LABELS.mentor_pair}：新人 ${employeeLabel(menteeId)} のシフト ${menteeShift} に教育係（${mentorLabels}）がいません。`,
          group.hard ? "hard" : "soft",
        );
      }
    }
  }
  return rows;
}

export async function restaurantWarnings(targetMonth, assignments, options = {}) {
  const checks = await restaurantConditionChecks(targetMonth, assignments, options);
  return checks.filter(
    (row) => row.結果 === "要確認" && row.優先度 === "必須",
  ).map((row) => `${row.日付}：${row.確認項目} — ${row.内容}`);
}
