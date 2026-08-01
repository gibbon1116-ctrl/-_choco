import {
  getAllEmployees,
  getAllProductCampaigns,
  getAllShiftTypes,
  getBusinessDays,
  getRequests,
  getRequirements,
} from "../db/index.js";
import {
  isWeekend,
  monthDates,
  weekdayLabel,
} from "../utils/calendar.js";
import { requestViolations } from "./summaries.js";

const KEY_SEPARATOR = "\u0000";

function employeeDayKey(employeeId, date) {
  return `${employeeId}${KEY_SEPARATOR}${date}`;
}

function normalizedColor(value) {
  return `#${String(value || "FFFFFF").replace(/^#/, "")}`;
}

function skillBadges(employee, shiftCode) {
  if (shiftCode === "O") return [];
  const badges = [];
  if (["basic", "conversational", "fluent"].includes(employee.english_level)) badges.push("EN");
  if (Number(employee.new_product_skill ?? 0) >= 2) badges.push("新");
  if (employee.can_cashier) badges.push("レジ");
  if (employee.can_open) badges.push("開");
  if (employee.can_close) badges.push("閉");
  if (employee.can_train_new_staff) badges.push("教");
  if (employee.can_hygiene_check) badges.push("衛");
  if (employee.can_explain_allergy) badges.push("ア");
  return badges;
}

export async function buildScheduleViewModel(
  targetMonth,
  assignments,
  { data = null } = {},
) {
  const source = data ?? {};
  const [
    businessDayRows,
    campaigns,
    shifts,
    employeeRows,
    requests,
    requirements,
  ] = await Promise.all([
    source.businessDays ?? getBusinessDays(targetMonth),
    source.campaigns ?? getAllProductCampaigns(),
    source.shiftTypes ?? getAllShiftTypes(),
    source.employees ?? getAllEmployees(),
    source.requests ?? getRequests(targetMonth),
    source.requirements ?? getRequirements(targetMonth),
  ]);
  const businessDays = new Map(businessDayRows.map((row) => [String(row.date), row]));
  const dates = monthDates(targetMonth).map((date) => {
    const weekday = weekdayLabel(date);
    const weekend = isWeekend(date);
    const info = businessDays.get(date) ?? {};
    const activeCampaigns = campaigns.filter(
      (campaign) => String(campaign.start_date) <= date && date <= String(campaign.end_date),
    );
    let eventLabel = info.is_event_day ? String(info.event_name ?? "") : "";
    if (activeCampaigns.length && !eventLabel) eventLabel = "新商品";
    return {
      date,
      day: Number(date.slice(-2)),
      weekday,
      is_weekend: weekend,
      is_saturday: weekend && weekday === "土",
      is_sunday: weekend && weekday === "日",
      event_label: eventLabel,
      is_event: Boolean(eventLabel),
    };
  });

  const shiftMap = Object.fromEntries(shifts.map((shift) => [
    String(shift.shift_code),
    {
      shift_code: String(shift.shift_code),
      shift_name: shift.shift_name,
      start_time: shift.start_time || "",
      end_time: shift.end_time || "",
      color: normalizedColor(shift.color),
      is_work: Boolean(shift.is_work),
    },
  ]));
  const employees = employeeRows.filter((employee) => Boolean(employee.active));
  const assignmentMap = new Map((assignments ?? []).map((assignment) => [
    employeeDayKey(assignment.employee_id, assignment.date),
    String(assignment.shift_code),
  ]));
  const requestMap = new Map(requests.map((request) => [
    employeeDayKey(request.employee_id, request.date),
    request,
  ]));
  const violations = await requestViolations(targetMonth, assignments, { requests });
  const violationSet = new Set(violations.map(
    (violation) => employeeDayKey(violation.employee_id, violation.date),
  ));

  const requiredTotals = {};
  for (const requirement of requirements) {
    requiredTotals[requirement.date] = (requiredTotals[requirement.date] ?? 0)
      + Number(requirement.required_count);
  }
  const assignedTotals = {};
  const diffTotals = {};
  for (const dateInfo of dates) {
    const count = employees.filter((employee) => (
      assignmentMap.get(employeeDayKey(employee.employee_id, dateInfo.date)) ?? "O"
    ) !== "O").length;
    assignedTotals[dateInfo.date] = count;
    diffTotals[dateInfo.date] = count - (requiredTotals[dateInfo.date] ?? 0);
  }

  const staffRows = employees.map((employee) => {
    const cells = {};
    for (const dateInfo of dates) {
      const key = employeeDayKey(employee.employee_id, dateInfo.date);
      const shiftCode = assignmentMap.get(key) ?? "O";
      const shift = shiftMap[shiftCode] ?? shiftMap.O ?? {
        shift_name: shiftCode,
        start_time: "",
        end_time: "",
        color: "#FFFFFF",
        is_work: false,
      };
      const request = requestMap.get(key);
      cells[dateInfo.date] = {
        shift_code: shiftCode,
        shift_name: shift.shift_name,
        start_time: shift.start_time,
        end_time: shift.end_time,
        color: shift.color,
        is_work: shift.is_work,
        request_type: request?.request_type ?? null,
        request_priority: request?.priority ?? null,
        request_violated: violationSet.has(key),
        skill_badges: skillBadges(employee, shiftCode),
      };
    }
    return {
      employee_id: String(employee.employee_id),
      name: employee.name,
      role: employee.role || "",
      night_allowed: Boolean(employee.night_allowed),
      cells,
    };
  });

  return {
    dates,
    summary: {
      required: requiredTotals,
      assigned: assignedTotals,
      diff: diffTotals,
    },
    staff_rows: staffRows,
    shift_map: shiftMap,
    violations,
  };
}
