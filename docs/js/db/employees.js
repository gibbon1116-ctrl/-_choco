import {
  booleanInteger,
  deleteRecordsByIndex,
  getAllFromIndex,
  getAllFromStore,
  integerValue,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

const BOOLEAN_COLUMNS = Object.freeze([
  "active",
  "night_allowed",
  "can_cashier",
  "can_open",
  "can_close",
  "can_handle_complaints",
  "can_explain_allergy",
  "is_new_staff",
  "can_train_new_staff",
  "can_manage_cash",
  "can_hygiene_check",
]);

const INTEGER_COLUMNS = Object.freeze([
  "max_consecutive_days",
  "min_work_days",
  "max_work_days",
  "product_skill_ice",
  "product_skill_chocolate",
  "product_skill_cookie",
  "new_product_skill",
  "peak_support_level",
]);

const DEFAULTS = Object.freeze({
  active: true,
  night_allowed: true,
  max_consecutive_days: 5,
  min_work_days: 0,
  max_work_days: 31,
  english_level: "none",
});

function normalizeEmployee(data) {
  const employee = {
    employee_id: stringValue(data.employee_id).trim(),
    name: stringValue(data.name).trim(),
    role: stringValue(data.role),
    skills: stringValue(data.skills),
    note: stringValue(data.note),
    english_level: stringValue(data.english_level, DEFAULTS.english_level),
  };

  for (const column of BOOLEAN_COLUMNS) {
    employee[column] = booleanInteger(data[column], DEFAULTS[column] ?? false);
  }
  for (const column of INTEGER_COLUMNS) {
    employee[column] = integerValue(data[column], DEFAULTS[column] ?? 0);
  }

  return employee;
}

export function getAllEmployees() {
  return getAllFromStore("employees");
}

export function getActiveEmployees() {
  return getAllFromIndex("employees", "by_active", 1);
}

export async function upsertEmployee(data) {
  const employee = normalizeEmployee(data);
  await runTransaction("employees", "readwrite", (transaction) =>
    requestToPromise(transaction.objectStore("employees").put(employee)),
  );
  return employee;
}

export function deleteEmployee(employeeId) {
  const key = stringValue(employeeId);
  return runTransaction(
    ["employees", "requests", "staff_relations"],
    "readwrite",
    async (transaction) => {
      await deleteRecordsByIndex(
        transaction.objectStore("requests"),
        "by_employee",
        key,
      );
      const relations = transaction.objectStore("staff_relations");
      await deleteRecordsByIndex(relations, "by_employee_1", key);
      await deleteRecordsByIndex(relations, "by_employee_2", key);
      await requestToPromise(transaction.objectStore("employees").delete(key));
    },
  );
}
