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

function normalizeRequest(data, date = data.date) {
  return {
    target_month: stringValue(data.target_month),
    employee_id: stringValue(data.employee_id),
    date: stringValue(date),
    request_type: stringValue(data.request_type),
    shift_code: stringValue(data.shift_code),
    priority: stringValue(data.priority, "soft"),
    note: stringValue(data.note),
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
  const records = dates.map((date) => normalizeRequest(data, date));

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
