import {
  getAllEmployees,
  getAllShiftTypes,
  getRequests,
} from "../db/index.js";
import { isWeekend } from "../utils/calendar.js";

function assignmentKey(employeeId, date) {
  return `${employeeId}\u0000${date}`;
}

export async function employeeSummary(assignments, { employees = null } = {}) {
  const employeeRows = employees ?? await getAllEmployees();
  const names = new Map(employeeRows.map(
    (employee) => [String(employee.employee_id), employee.name],
  ));
  const grouped = new Map();

  for (const assignment of assignments ?? []) {
    const employeeId = String(assignment.employee_id);
    if (!grouped.has(employeeId)) {
      grouped.set(employeeId, {
        employee_id: employeeId,
        職員名: names.get(employeeId) ?? employeeId,
        勤務日数: 0,
        夜勤回数: 0,
        土日勤務: 0,
      });
    }
    const row = grouped.get(employeeId);
    if (assignment.shift_code !== "O") {
      row.勤務日数 += 1;
      if (isWeekend(assignment.date)) row.土日勤務 += 1;
    }
    if (assignment.shift_code === "N") row.夜勤回数 += 1;
  }
  return [...grouped.values()];
}

export async function shiftSummary(assignments, { shiftTypes = null } = {}) {
  const shifts = shiftTypes ?? await getAllShiftTypes();
  const names = new Map(shifts.map(
    (shift) => [String(shift.shift_code), shift.shift_name],
  ));
  const totals = new Map();
  for (const assignment of assignments ?? []) {
    const code = String(assignment.shift_code);
    totals.set(code, (totals.get(code) ?? 0) + 1);
  }
  return [...totals].map(([code, count]) => ({
    コード: code,
    勤務区分: names.get(code) ?? code,
    回数: count,
  }));
}

export async function requestViolations(
  targetMonth,
  assignments,
  { requests = null } = {},
) {
  const requestRows = requests ?? await getRequests(targetMonth);
  const assigned = new Map((assignments ?? []).map((assignment) => [
    assignmentKey(assignment.employee_id, assignment.date),
    assignment.shift_code,
  ]));
  const violations = [];

  for (const request of requestRows) {
    const actual = assigned.get(assignmentKey(request.employee_id, request.date)) ?? "O";
    const expected = request.shift_code || "O";
    const violated = (
      (request.request_type === "off" && actual !== "O")
      || (request.request_type === "avoid" && actual === expected)
      || (["prefer", "fixed"].includes(request.request_type) && actual !== expected)
    );
    if (!violated) continue;
    violations.push({
      employee_id: request.employee_id,
      date: request.date,
      request_type: request.request_type,
      priority: request.priority,
      requested_shift: expected,
      actual_shift: actual,
      note: request.note ?? "",
    });
  }
  return violations;
}

export async function buildSummary(assignments, options = {}) {
  const staff = await employeeSummary(assignments, options);
  return {
    employee_count: staff.length,
    total_work_days: staff.reduce((sum, row) => sum + row.勤務日数, 0),
    total_nights: staff.reduce((sum, row) => sum + row.夜勤回数, 0),
    total_weekend_work: staff.reduce((sum, row) => sum + row.土日勤務, 0),
  };
}
