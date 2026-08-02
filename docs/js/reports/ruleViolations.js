import {
  getAllEmployees,
  getAllShiftTypes,
  getRequirements,
  getRequests,
} from "../db/index.js";
import { monthDates } from "../utils/calendar.js";
import { restaurantWarnings } from "./restaurantChecks.js";
import { requestViolations } from "./summaries.js";

const KEY_SEPARATOR = "\u0000";
const CATEGORY_ORDER = Object.freeze([
  "必要人数の不足",
  "月間勤務日数",
  "最大連続勤務日数",
  "夜勤の可否",
  "夜勤翌日の休み",
  "必須の希望",
  "必須の配置条件",
]);

function assignmentKey(employeeId, date) {
  return `${employeeId}${KEY_SEPARATOR}${date}`;
}

function shiftKey(date, shiftCode) {
  return `${date}${KEY_SEPARATOR}${shiftCode}`;
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function employeeLabel(employee) {
  const employeeId = String(employee.employee_id);
  const name = String(employee.name ?? "").trim();
  return name ? `${name}（${employeeId}）` : employeeId;
}

/** Return the hard conditions a concrete schedule does not satisfy. */
export async function hardRuleViolations(
  targetMonth,
  assignments,
  { data = null } = {},
) {
  const source = data ?? {};
  const [employeeRows, shiftTypes, requirements, requests] = await Promise.all([
    source.employees ?? getAllEmployees(),
    source.shiftTypes ?? getAllShiftTypes(),
    source.requirements ?? getRequirements(targetMonth),
    source.requests ?? getRequests(targetMonth),
  ]);
  const employees = employeeRows.filter((employee) => Boolean(employee.active));
  const employeesById = new Map(employees.map(
    (employee) => [String(employee.employee_id), employee],
  ));
  const days = monthDates(targetMonth);
  const assignedShift = new Map();
  const assignedCounts = new Map();
  for (const assignment of assignments ?? []) {
    const employeeId = String(assignment.employee_id);
    const date = String(assignment.date);
    const shiftCode = String(assignment.shift_code ?? "O");
    assignedShift.set(assignmentKey(employeeId, date), shiftCode);
    if (shiftCode !== "O") {
      const key = shiftKey(date, shiftCode);
      assignedCounts.set(key, (assignedCounts.get(key) ?? 0) + 1);
    }
  }

  const rows = [];
  const add = (category, message) => rows.push({ category, message });

  for (const requirement of requirements) {
    const needed = Math.max(0, integer(requirement.required_count));
    if (needed <= 0) continue;
    const date = String(requirement.date);
    const shiftCode = String(requirement.shift_code);
    const actual = assignedCounts.get(shiftKey(date, shiftCode)) ?? 0;
    if (actual < needed) {
      add(
        "必要人数の不足",
        `${date}の${shiftCode}は必要${needed}人に対して${actual}人です。`,
      );
    }
  }

  for (const employee of employees) {
    const employeeId = String(employee.employee_id);
    const workedDays = days.filter(
      (date) => (assignedShift.get(assignmentKey(employeeId, date)) ?? "O") !== "O",
    ).length;
    const minimum = Math.max(0, integer(employee.min_work_days));
    const maximum = Math.max(0, integer(employee.max_work_days, days.length));
    if (workedDays < minimum) {
      add(
        "月間勤務日数",
        `${employeeLabel(employee)}の勤務日数は下限${minimum}日に対して${workedDays}日です。`,
      );
    } else if (workedDays > maximum) {
      add(
        "月間勤務日数",
        `${employeeLabel(employee)}の勤務日数は上限${maximum}日に対して${workedDays}日です。`,
      );
    }

    let currentRun = 0;
    let longestRun = 0;
    for (const date of days) {
      if ((assignedShift.get(assignmentKey(employeeId, date)) ?? "O") !== "O") {
        currentRun += 1;
        longestRun = Math.max(longestRun, currentRun);
      } else {
        currentRun = 0;
      }
    }
    const maximumConsecutive = Math.max(1, integer(employee.max_consecutive_days, 1));
    if (longestRun > maximumConsecutive) {
      add(
        "最大連続勤務日数",
        `${employeeLabel(employee)}は上限${maximumConsecutive}日に対して${longestRun}日連続で勤務しています。`,
      );
    }
  }

  for (const assignment of assignments ?? []) {
    const employee = employeesById.get(String(assignment.employee_id));
    if (!employee || String(assignment.shift_code) !== "N" || Boolean(employee.night_allowed)) {
      continue;
    }
    add(
      "夜勤の可否",
      `${assignment.date}に${employeeLabel(employee)}が夜勤に配置されています。`,
    );
  }

  const restShiftCodes = new Set(shiftTypes.filter(
    (shift) => Boolean(shift.requires_rest_next_day),
  ).map((shift) => String(shift.shift_code)));
  const dayIndexes = new Map(days.map((date, index) => [date, index]));
  for (const assignment of assignments ?? []) {
    const date = String(assignment.date);
    const dayIndex = dayIndexes.get(date);
    if (!restShiftCodes.has(String(assignment.shift_code)) || dayIndex === undefined) continue;
    const nextDate = days[dayIndex + 1];
    if (!nextDate) continue;
    const nextShift = assignedShift.get(assignmentKey(assignment.employee_id, nextDate)) ?? "O";
    if (nextShift === "O") continue;
    const employee = employeesById.get(String(assignment.employee_id));
    add(
      "夜勤翌日の休み",
      `${date}の${assignment.shift_code}勤務後、${employee ? employeeLabel(employee) : assignment.employee_id}が${nextDate}も勤務しています。`,
    );
  }

  const reportData = {
    ...source,
    employees: employeeRows,
    shiftTypes,
    requirements,
    requests,
  };
  const hardRequests = (await requestViolations(
    targetMonth,
    assignments,
    { requests },
  )).filter((violation) => violation.priority === "hard");
  for (const violation of hardRequests) {
    const employee = employeesById.get(String(violation.employee_id));
    const label = employee ? employeeLabel(employee) : String(violation.employee_id);
    add(
      "必須の希望",
      `${violation.date}の${label}の希望（${violation.request_type}：${violation.requested_shift}）に対して実際は${violation.actual_shift}です。`,
    );
  }

  for (const warning of await restaurantWarnings(
    targetMonth,
    assignments,
    { data: reportData },
  )) {
    add("必須の配置条件", warning);
  }

  const categoryIndexes = new Map(CATEGORY_ORDER.map(
    (category, index) => [category, index],
  ));
  return rows.sort(
    (left, right) => categoryIndexes.get(left.category) - categoryIndexes.get(right.category),
  );
}
