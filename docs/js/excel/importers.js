import * as databaseApi from "../db/index.js";
import { monthDates } from "../utils/calendar.js";
import { RELATION_LABELS, ROLE_LABELS } from "../utils/restaurantSkills.js";
import { validateEmployee } from "../validation/employeeValidation.js";
import {
  EMPLOYEE_COLUMNS,
  STAFF_SKILL_COLUMNS,
  sheetRowsWithColumns,
  requireColumns,
} from "./xlsxCore.js";

const BOOLEAN_EMPLOYEE_COLUMNS = Object.freeze([
  "can_cashier", "can_open", "can_close", "can_handle_complaints",
  "can_explain_allergy", "is_new_staff", "can_train_new_staff",
  "can_manage_cash", "can_hygiene_check",
]);
const LEVEL_COLUMNS = Object.freeze([
  "product_skill_ice", "product_skill_chocolate", "product_skill_cookie",
  "new_product_skill", "peak_support_level",
]);

function has(row, column) {
  return Object.prototype.hasOwnProperty.call(row, column);
}

function value(row, column, fallback = "") {
  return has(row, column) ? row[column] : fallback;
}

function booleanValue(input) {
  if (typeof input === "string") {
    return ["true", "1", "yes", "y", "はい", "可"].includes(input.trim().toLowerCase());
  }
  return Boolean(input);
}

function integerValue(input, fallback = 0, fallbackWhenFalsy = false) {
  let source = input;
  if (source === undefined || source === null || source === "" || (fallbackWhenFalsy && !source)) {
    source = fallback;
  }
  const number = typeof source === "number"
    ? Math.trunc(source)
    : (/^[+-]?\d+$/.test(String(source).trim()) ? Number(source) : Number.NaN);
  if (!Number.isFinite(number)) throw new TypeError(`${input} は整数ではありません。`);
  return number;
}

function isoDate(input) {
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, "0");
    const day = String(input.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof input === "number") {
    const parsed = globalThis.XLSX?.SSF?.parse_date_code(input);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(input ?? "").trim();
  const direct = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (direct) return `${direct[1]}-${direct[2].padStart(2, "0")}-${direct[3].padStart(2, "0")}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`日付 ${text} を読み取れません。`);
  return isoDate(parsed);
}

function normalizeEmployee(row) {
  const data = Object.fromEntries(EMPLOYEE_COLUMNS.map((column) => [column, value(row, column, "")]));
  data.active = booleanValue(value(row, "active", true));
  data.night_allowed = booleanValue(value(row, "night_allowed", true));
  for (const column of BOOLEAN_EMPLOYEE_COLUMNS) data[column] = booleanValue(value(row, column, false));
  data.english_level = String(value(row, "english_level", "none") || "none").trim().toLowerCase();
  for (const column of LEVEL_COLUMNS) data[column] = integerValue(value(row, column, 0), 0);
  data.max_consecutive_days = integerValue(value(row, "max_consecutive_days", 5), 5, true);
  data.min_work_days = integerValue(value(row, "min_work_days", 0), 0);
  data.max_work_days = integerValue(value(row, "max_work_days", 31), 31, true);
  return data;
}

async function replaceRequests(targetMonth, rows, api) {
  const existing = await api.getRequests(targetMonth);
  for (const row of existing) await api.deleteRequest(row.id);
  for (const row of rows) await api.addRequest(row);
}

async function replaceAll(existingRows, deleteRow, insertRow, rows) {
  for (const row of existingRows) await deleteRow(row.id);
  for (const row of rows) await insertRow(row);
}

export async function importEmployees(source, { api = databaseApi } = {}) {
  const rows = await sheetRowsWithColumns(source);
  requireColumns(rows, ["employee_id", "name"]);
  const prepared = rows.map(normalizeEmployee);
  for (const data of prepared) {
    const errors = validateEmployee(data);
    if (errors.length) {
      throw new Error(`職員ID ${data.employee_id || "(空欄)"}: ${errors.join(" ")}`);
    }
  }
  for (const data of prepared) await api.upsertEmployee(data);
  return rows.length;
}

export async function importStaffSkills(source, { api = databaseApi } = {}) {
  const rows = await sheetRowsWithColumns(source);
  requireColumns(rows, STAFF_SKILL_COLUMNS);
  const existing = new Map((await api.getAllEmployees()).map(
    (employee) => [String(employee.employee_id), employee],
  ));
  const prepared = rows.map((row) => {
    const employeeId = String(row.employee_id).trim();
    if (!existing.has(employeeId)) throw new Error(`職員ID ${employeeId} は職員マスタにありません。`);
    const data = { ...existing.get(employeeId) };
    for (const column of STAFF_SKILL_COLUMNS) {
      if (!["employee_id", "name"].includes(column)) data[column] = value(row, column, data[column] ?? 0);
    }
    for (const column of BOOLEAN_EMPLOYEE_COLUMNS) data[column] = booleanValue(data[column]);
    for (const column of LEVEL_COLUMNS) data[column] = integerValue(data[column], 0);
    const errors = validateEmployee(data);
    if (errors.length) throw new Error(`${employeeId}: ${errors.join(" / ")}`);
    return data;
  });
  for (const data of prepared) await api.upsertEmployee(data);
  return prepared.length;
}

export async function importRequirements(source, targetMonth = null, { api = databaseApi } = {}) {
  const rows = await sheetRowsWithColumns(source);
  requireColumns(rows, ["date", "shift_code", "required_count"]);
  let month = targetMonth;
  if (month === null) {
    if (!rows.columns.includes("target_month") || !rows.length) throw new Error("対象年月を指定してください。");
    month = String(rows[0].target_month);
  }
  const validDates = new Set(monthDates(month));
  const shiftCodes = new Set((await api.getAllShiftTypes()).filter((shift) => shift.is_work).map((shift) => shift.shift_code));
  const prepared = rows.map((row) => ({
    date: isoDate(row.date),
    shift_code: String(row.shift_code).trim().toUpperCase(),
    required_count: integerValue(row.required_count),
  }));
  for (const row of prepared) {
    if (!validDates.has(row.date)) throw new Error(`${row.date} は対象年月 ${month} の日付ではありません。`);
    if (!shiftCodes.has(row.shift_code)) throw new Error(`勤務区分 ${row.shift_code} は勤務区分マスタにありません。`);
    if (row.required_count < 0) throw new Error("必要人数は0以上にしてください。");
  }
  await api.replaceRequirements(month, prepared);
  return prepared.length;
}

export async function importRequests(source, targetMonth = null, { api = databaseApi } = {}) {
  const rows = await sheetRowsWithColumns(source);
  requireColumns(rows, ["employee_id", "date", "request_type", "priority"]);
  const month = targetMonth ?? (rows.length ? String(rows[0].target_month ?? "") : "");
  const validDates = new Set(monthDates(month));
  const employeeIds = new Set((await api.getAllEmployees()).map((employee) => String(employee.employee_id)));
  const shiftCodes = new Set((await api.getAllShiftTypes()).map((shift) => String(shift.shift_code)));
  const prepared = [];
  for (const row of rows) {
    const item = {
      target_month: month,
      employee_id: String(row.employee_id),
      date: isoDate(row.date),
      request_type: String(row.request_type).trim(),
      shift_code: String(row.shift_code || "").trim().toUpperCase(),
      priority: String(row.priority ?? "soft").trim(),
      note: String(row.note || ""),
    };
    if (!employeeIds.has(item.employee_id)) throw new Error(`職員ID ${item.employee_id} は職員マスタにありません。`);
    if (!validDates.has(item.date)) throw new Error(`${item.date} は対象年月 ${month} の日付ではありません。`);
    if (!["off", "avoid", "prefer", "fixed"].includes(item.request_type)) {
      throw new Error(`希望種別 ${item.request_type} は使用できません。`);
    }
    if (!["hard", "soft"].includes(item.priority)) throw new Error("priority は hard または soft にしてください。");
    if (item.request_type === "off") item.shift_code = "O";
    if (!shiftCodes.has(item.shift_code)) throw new Error(`勤務区分 ${item.shift_code} は勤務区分マスタにありません。`);
    prepared.push(item);
  }
  await replaceRequests(month, prepared, api);
  return rows.length;
}

export async function importStaffRelations(source, { api = databaseApi } = {}) {
  const rows = await sheetRowsWithColumns(source);
  requireColumns(rows, ["employee_id_1", "employee_id_2", "relation_type", "priority"]);
  const employeeIds = new Set((await api.getAllEmployees()).map((employee) => String(employee.employee_id)));
  const prepared = rows.map((row) => ({
    employee_id_1: String(row.employee_id_1), employee_id_2: String(row.employee_id_2),
    relation_type: String(row.relation_type), priority: String(row.priority ?? "soft"),
    weight: integerValue(row.weight, 50, true), active: booleanValue(value(row, "active", true)),
    note: String(row.note || ""),
  }));
  for (const item of prepared) {
    if (!employeeIds.has(item.employee_id_1) || !employeeIds.has(item.employee_id_2)) {
      throw new Error("スタッフ配置条件に職員マスタ未登録のIDがあります。");
    }
    if (item.employee_id_1 === item.employee_id_2) throw new Error("同じスタッフ同士は登録できません。");
    if (!(item.relation_type in RELATION_LABELS) || !["hard", "soft"].includes(item.priority)) {
      throw new Error("配置ルールまたはpriorityの値を確認してください。");
    }
  }
  await replaceAll(
    await api.getAllStaffRelations(),
    (id) => api.deleteStaffRelation(id),
    (row) => api.upsertStaffRelation(row),
    prepared,
  );
  return prepared.length;
}

export async function importProductCampaigns(source, { api = databaseApi } = {}) {
  const rows = await sheetRowsWithColumns(source);
  requireColumns(rows, ["product_name", "category", "start_date", "end_date", "required_skill_level"]);
  const prepared = rows.map((row) => ({
    product_name: String(row.product_name), category: String(row.category),
    start_date: isoDate(row.start_date), end_date: isoDate(row.end_date),
    required_skill_level: integerValue(row.required_skill_level, 2, true),
    require_leader_first_week: booleanValue(value(row, "require_leader_first_week", true)),
    note: String(row.note || ""),
  }));
  for (const item of prepared) {
    if (!["ice", "chocolate", "cookie", "other"].includes(item.category)) {
      throw new Error("category は ice / chocolate / cookie / other にしてください。");
    }
    if (item.start_date > item.end_date || ![1, 2, 3].includes(item.required_skill_level)) {
      throw new Error(`${item.product_name} の期間または必要スキルレベルを確認してください。`);
    }
  }
  await replaceAll(
    await api.getAllProductCampaigns(),
    (id) => api.deleteProductCampaign(id),
    (row) => api.upsertProductCampaign(row),
    prepared,
  );
  return prepared.length;
}

export async function importRoleRequirements(source, targetMonth = null, { api = databaseApi } = {}) {
  const rows = await sheetRowsWithColumns(source);
  requireColumns(rows, ["date", "shift_code", "role_code", "required_count", "priority"]);
  const month = targetMonth ?? (rows.length ? String(rows[0].target_month ?? "") : "");
  const validDates = new Set(monthDates(month));
  const shiftCodes = new Set((await api.getAllShiftTypes()).filter((shift) => shift.is_work).map((shift) => shift.shift_code));
  const prepared = rows.map((row) => ({
    date: isoDate(row.date), shift_code: String(row.shift_code).trim().toUpperCase(),
    role_code: String(row.role_code).trim(), required_count: integerValue(row.required_count),
    priority: String(row.priority).trim(),
  }));
  for (const item of prepared) {
    if (!validDates.has(item.date) || !shiftCodes.has(item.shift_code)) {
      throw new Error("役割別必要人数に対象年月外の日付または未登録の勤務区分があります。");
    }
    if (!(item.role_code in ROLE_LABELS) || !["hard", "soft"].includes(item.priority)) {
      throw new Error("role_code または priority の値を確認してください。");
    }
  }
  await api.replaceRoleRequirements(month, prepared);
  return prepared.length;
}
