import {
  getAllFromIndex,
  getAllFromStore,
  integerValue,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";
import {
  isoDate,
  monthDates,
  parseTargetMonth,
} from "../utils/calendar.js";

function createBatchId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeRequest(data, date = data.date) {
  return {
    target_month: stringValue(data.target_month),
    employee_id: stringValue(data.employee_id),
    date: stringValue(date),
    request_type: stringValue(data.request_type),
    shift_code: stringValue(data.shift_code),
    priority: stringValue(data.priority, "soft"),
    note: stringValue(data.note),
    batch_id: stringValue(data.batch_id),
  };
}

export function getRequests(targetMonth) {
  return targetMonth
    ? getAllFromIndex("requests", "by_month", targetMonth)
    : getAllFromStore("requests");
}

export function getRequestsByEmployee(employeeId) {
  return getAllFromIndex(
    "requests",
    "by_employee",
    stringValue(employeeId),
  );
}

export function addRequest(data) {
  const record = normalizeRequest(data);
  return runTransaction("requests", "readwrite", async (transaction) => {
    const id = await requestToPromise(
      transaction.objectStore("requests").add(record),
    );
    return { ...record, id };
  });
}

export function addRequestRange(data, startDate, endDate) {
  const targetMonth = stringValue(data.target_month);
  parseTargetMonth(targetMonth);
  const start = isoDate(startDate);
  const end = isoDate(endDate);

  if (end < start) {
    throw new Error("終了日は開始日以降にしてください。");
  }
  if (!start.startsWith(`${targetMonth}-`) || !end.startsWith(`${targetMonth}-`)) {
    throw new Error("開始日・終了日は対象年月内で指定してください。");
  }

  const dates = monthDates(targetMonth).filter((date) => date >= start && date <= end);
  const batchId = dates.length >= 2 ? createBatchId() : "";
  const records = dates.map((date) => normalizeRequest({ ...data, batch_id: batchId }, date));

  return runTransaction("requests", "readwrite", async (transaction) => {
    const store = transaction.objectStore("requests");
    for (const record of records) {
      await requestToPromise(store.add(record));
    }
    return records.length;
  });
}

export function deleteRequest(id) {
  return runTransaction("requests", "readwrite", (transaction) =>
    requestToPromise(
      transaction.objectStore("requests").delete(integerValue(id)),
    ),
  );
}

export function deleteRequestBatch(targetMonth, batchId) {
  const normalizedBatchId = stringValue(batchId);
  if (!normalizedBatchId) return Promise.resolve(0);

  return runTransaction("requests", "readwrite", async (transaction) => {
    const store = transaction.objectStore("requests");
    const records = await requestToPromise(
      store.index("by_month").getAll(stringValue(targetMonth)),
    );
    const matching = records.filter((record) => record.batch_id === normalizedBatchId);
    for (const record of matching) {
      await requestToPromise(store.delete(record.id));
    }
    return matching.length;
  });
}

export function deleteRequests(ids) {
  const normalizedIds = [...new Set(ids.map((id) => integerValue(id)))];
  if (!normalizedIds.length) return Promise.resolve(0);

  return runTransaction("requests", "readwrite", async (transaction) => {
    const store = transaction.objectStore("requests");
    let deletedCount = 0;
    for (const id of normalizedIds) {
      const record = await requestToPromise(store.get(id));
      if (record === undefined) continue;
      await requestToPromise(store.delete(id));
      deletedCount += 1;
    }
    return deletedCount;
  });
}

export function updateRequests(ids, changes) {
  const normalizedIds = [...new Set(ids.map((id) => integerValue(id)))];
  const allowedKeys = ["request_type", "shift_code", "priority", "note"];
  const acceptedChanges = Object.fromEntries(
    allowedKeys
      .filter((key) => Object.hasOwn(changes, key))
      .map((key) => [key, stringValue(changes[key])]),
  );
  if (!normalizedIds.length) return Promise.resolve(0);

  return runTransaction("requests", "readwrite", async (transaction) => {
    const store = transaction.objectStore("requests");
    let updatedCount = 0;
    for (const id of normalizedIds) {
      const record = await requestToPromise(store.get(id));
      if (record === undefined) continue;
      const updated = { ...record, ...acceptedChanges };
      if (updated.request_type === "off") updated.shift_code = "O";
      await requestToPromise(store.put(updated));
      updatedCount += 1;
    }
    return updatedCount;
  });
}
