import {
  deleteRecordsByIndex,
  getAllFromIndex,
  getAllFromStore,
  integerValue,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

function normalizeRoleRequirement(data, targetMonth = data.target_month) {
  return {
    target_month: stringValue(targetMonth),
    date: stringValue(data.date),
    shift_code: stringValue(data.shift_code),
    role_code: stringValue(data.role_code),
    required_count: integerValue(data.required_count),
    priority: stringValue(data.priority, "hard"),
  };
}

export function getRoleRequirements(targetMonth) {
  return targetMonth
    ? getAllFromIndex("role_requirements", "by_month", targetMonth)
    : getAllFromStore("role_requirements");
}

export function replaceRoleRequirements(targetMonth, rows) {
  const month = stringValue(targetMonth);
  const records = Array.from(rows)
    .map((row) => normalizeRoleRequirement(row, month))
    .filter((row) => row.required_count >= 0);

  return runTransaction("role_requirements", "readwrite", async (transaction) => {
    const store = transaction.objectStore("role_requirements");
    await deleteRecordsByIndex(store, "by_month", month);
    for (const record of records) {
      await requestToPromise(store.add(record));
    }
    return records.length;
  });
}

export function upsertRoleRequirement(data) {
  const record = normalizeRoleRequirement(data);
  const key = [
    record.target_month,
    record.date,
    record.shift_code,
    record.role_code,
  ];

  return runTransaction("role_requirements", "readwrite", async (transaction) => {
    const store = transaction.objectStore("role_requirements");
    const existing = await requestToPromise(
      store.index("by_month_date_shift_role").get(key),
    );
    if (existing) {
      record.id = existing.id;
    }
    const id = await requestToPromise(store.put(record));
    return { ...record, id };
  });
}

export function deleteRoleRequirement(id) {
  return runTransaction("role_requirements", "readwrite", (transaction) =>
    requestToPromise(
      transaction.objectStore("role_requirements").delete(integerValue(id)),
    ),
  );
}
