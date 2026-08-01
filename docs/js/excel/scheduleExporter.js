import * as databaseApi from "../db/index.js";
import { displayDate, monthDates, weekdayLabel } from "../utils/calendar.js";
import { RELATION_LABELS } from "../utils/restaurantSkills.js";
import {
  employeeSummary,
  requestViolations,
  shiftSummary,
} from "../reports/summaries.js";
import { restaurantConditionChecks } from "../reports/restaurantChecks.js";
import {
  PRODUCT_CAMPAIGN_COLUMNS,
  STAFF_SKILL_COLUMNS,
  getXlsx,
  styleScheduleSheet,
  workbookResult,
} from "./xlsxCore.js";

function normalizeColor(value, fallback = "FFFFFF") {
  const color = String(value || fallback).replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(color) ? color : fallback;
}

function appendStyledSheet(workbook, name, rows) {
  const xlsx = getXlsx();
  const worksheet = xlsx.utils.aoa_to_sheet(rows);
  styleScheduleSheet(worksheet, rows);
  xlsx.utils.book_append_sheet(workbook, worksheet, name);
  return worksheet;
}

function recordsAsRows(records, columns) {
  return [columns, ...records.map((record) => columns.map((column) => record[column] ?? ""))];
}

function assignmentsByEmployee(assignments) {
  const result = new Map();
  for (const assignment of assignments) {
    const employeeId = String(assignment.employee_id);
    if (!result.has(employeeId)) result.set(employeeId, new Map());
    result.get(employeeId).set(String(assignment.date), String(assignment.shift_code));
  }
  return result;
}

function relationshipResult(relation, relationChecks) {
  const token = `${relation.employee_id_1}・${relation.employee_id_2}`;
  return relationChecks.some((row) => String(row.内容 ?? "").includes(token)) ? "要確認" : "充足";
}

export async function exportSchedule(scheduleId, {
  api = databaseApi,
  adminExport = false,
  download = true,
  filename = null,
} = {}) {
  const schedules = await api.getSchedules();
  const schedule = schedules.find((row) => Number(row.schedule_id) === Number(scheduleId));
  if (!schedule) throw new Error("出力対象の勤務表が見つかりません。");

  const targetMonth = String(schedule.target_month);
  const assignments = (schedule.assignments ?? []).map((assignment) => ({
    employee_id: String(assignment.employee_id),
    date: String(assignment.date),
    shift_code: String(assignment.shift_code),
  }));
  const [
    employees,
    shifts,
    requests,
    settings,
    businessDays,
    campaigns,
    roleRequirements,
    staffRelations,
    requirements,
  ] = await Promise.all([
    api.getAllEmployees(),
    api.getAllShiftTypes(),
    api.getRequests(targetMonth),
    api.getSettings(),
    api.getBusinessDays(targetMonth),
    api.getAllProductCampaigns(),
    api.getRoleRequirements(targetMonth),
    api.getAllStaffRelations(),
    api.getRequirements(targetMonth),
  ]);

  const xlsx = getXlsx();
  const workbook = xlsx.utils.book_new();
  const days = monthDates(targetMonth);
  const employeeNames = new Map(employees.map(
    (employee) => [String(employee.employee_id), employee.name],
  ));
  const shiftColors = new Map(shifts.map(
    (shift) => [String(shift.shift_code), normalizeColor(shift.color)],
  ));
  const assignmentMap = assignmentsByEmployee(assignments);
  const assignedEmployeeIds = [...assignmentMap.keys()].sort((left, right) => (
    String(employeeNames.get(left) ?? left).localeCompare(String(employeeNames.get(right) ?? right), "ja")
  ));
  const staffSummary = await employeeSummary(assignments, { employees });
  const staffSummaryById = new Map(staffSummary.map((row) => [String(row.employee_id), row]));
  const shiftCounts = await shiftSummary(assignments, { shiftTypes: shifts });
  const violations = await requestViolations(targetMonth, assignments, { requests });
  const restaurantData = {
    settings,
    employees,
    businessDays,
    campaigns,
    roleRequirements,
    staffRelations,
    requirements,
  };
  const checks = await restaurantConditionChecks(targetMonth, assignments, { data: restaurantData });

  const scheduleRows = [[
    "職員名",
    ...days.map((day) => displayDate(day)),
    "勤務日数",
    "夜勤回数",
    "土日勤務",
  ]];
  for (const employeeId of assignedEmployeeIds) {
    const stats = staffSummaryById.get(employeeId) ?? { 勤務日数: 0, 夜勤回数: 0, 土日勤務: 0 };
    const employeeAssignments = assignmentMap.get(employeeId);
    scheduleRows.push([
      employeeNames.get(employeeId) ?? employeeId,
      ...days.map((day) => employeeAssignments.get(day) ?? "O"),
      Number(stats.勤務日数),
      Number(stats.夜勤回数),
      Number(stats.土日勤務),
    ]);
  }
  const scheduleSheet = appendStyledSheet(workbook, "勤務表", scheduleRows);
  for (let row = 1; row < scheduleRows.length; row += 1) {
    for (let column = 1; column <= days.length; column += 1) {
      const address = xlsx.utils.encode_cell({ r: row, c: column });
      const cell = scheduleSheet[address];
      if (!cell) continue;
      const shiftCode = String(cell.v);
      cell.s = {
        ...(cell.s ?? {}),
        fill: { patternType: "solid", fgColor: { rgb: shiftColors.get(shiftCode) ?? "FFFFFF" } },
        alignment: { ...(cell.s?.alignment ?? {}), horizontal: "center" },
        font: {
          ...(cell.s?.font ?? {}),
          bold: true,
          color: { rgb: shiftCode === "O" ? "5F6B7A" : "153E90" },
        },
      };
    }
  }

  const dailyRows = [["日付", "曜日", "勤務区分", "配置職員"]];
  for (const day of days) {
    for (const shift of shifts) {
      const members = assignments.filter(
        (assignment) => assignment.date === day && assignment.shift_code === shift.shift_code,
      ).map((assignment) => employeeNames.get(assignment.employee_id) ?? assignment.employee_id);
      if (members.length) {
        dailyRows.push([
          day,
          weekdayLabel(day),
          `${shift.shift_code} ${shift.shift_name}`,
          members.join("、"),
        ]);
      }
    }
  }
  appendStyledSheet(workbook, "日別配置", dailyRows);
  appendStyledSheet(
    workbook,
    "職員別集計",
    recordsAsRows(staffSummary, ["employee_id", "職員名", "勤務日数", "夜勤回数", "土日勤務"]),
  );
  appendStyledSheet(
    workbook,
    "勤務区分別集計",
    recordsAsRows(shiftCounts, ["コード", "勤務区分", "回数"]),
  );

  if (violations.length) {
    appendStyledSheet(
      workbook,
      "希望休違反",
      recordsAsRows(violations, [
        "employee_id", "date", "request_type", "priority",
        "requested_shift", "actual_shift", "note",
      ]),
    );
  } else {
    appendStyledSheet(workbook, "希望休違反", [["結果"], ["希望違反はありません。"]]);
  }

  appendStyledSheet(workbook, "ルール確認", [
    ["項目", "内容"],
    ["対象年月", targetMonth],
    ["作成日時", schedule.created_at ?? ""],
    ["状態", schedule.status ?? ""],
    ["ペナルティ合計", schedule.objective_value ?? ""],
    ["計算時間（秒）", Number(schedule.solver_wall_time ?? 0) / 1000],
    ["絶対条件", "1日1勤務・必要人数・夜勤可否・hard希望・最大連続勤務・夜勤明け休み"],
    ["最適化条件", "soft希望・勤務日数・勤務区分・夜勤回数・土日勤務の均等化、同点時のランダム分散"],
  ]);

  if (checks.length) {
    appendStyledSheet(
      workbook,
      "飲食店条件確認",
      recordsAsRows(checks, ["日付", "確認項目", "結果", "優先度", "内容"]),
    );
  } else {
    appendStyledSheet(
      workbook,
      "飲食店条件確認",
      [["結果"], ["飲食店向け条件は無効、または確認対象がありません。"]],
    );
  }

  appendStyledSheet(
    workbook,
    "スタッフスキル一覧",
    recordsAsRows(employees, STAFF_SKILL_COLUMNS),
  );

  const eventRows = [["区分", "名称", "カテゴリ", "開始日", "終了日", "需要レベル", "必要スキル", "備考"]];
  for (const campaign of campaigns) {
    eventRows.push([
      "新商品", campaign.product_name, campaign.category, campaign.start_date, campaign.end_date,
      "", campaign.required_skill_level, campaign.note ?? "",
    ]);
  }
  for (const businessDay of businessDays.filter((row) => Boolean(row.is_event_day))) {
    eventRows.push([
      "イベント", businessDay.event_name, "", businessDay.date, businessDay.date,
      businessDay.demand_level, "", businessDay.note ?? "",
    ]);
  }
  appendStyledSheet(workbook, "新商品イベント一覧", eventRows);

  if (adminExport) {
    const relationChecks = checks.filter(
      (row) => row.確認項目 === "スタッフ配置条件" && row.結果 === "要確認",
    );
    const relationRows = [["スタッフ1", "スタッフ2", "配置ルール", "優先度", "重み", "結果", "管理者メモ"]];
    for (const relation of staffRelations) {
      relationRows.push([
        employeeNames.get(String(relation.employee_id_1)) ?? relation.employee_id_1,
        employeeNames.get(String(relation.employee_id_2)) ?? relation.employee_id_2,
        RELATION_LABELS[relation.relation_type] ?? relation.relation_type,
        relation.priority,
        relation.weight,
        relationshipResult(relation, relationChecks),
        relation.note ?? "",
      ]);
    }
    appendStyledSheet(workbook, "相性条件確認", relationRows);
  }

  const outputFilename = filename ?? `勤務表_${targetMonth.replace("-", "")}_${scheduleId}_${adminExport ? "管理者確認用" : "通常配布用"}.xlsx`;
  return workbookResult(workbook, outputFilename, { download });
}

export const SCHEDULE_SHEET_NAMES = Object.freeze([
  "勤務表", "日別配置", "職員別集計", "勤務区分別集計", "希望休違反",
  "ルール確認", "飲食店条件確認", "スタッフスキル一覧", "新商品イベント一覧",
]);
