import {
  booleanInteger,
  getAllFromIndex,
  getAllFromStore,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

function normalizeBusinessDay(data) {
  return {
    target_month: stringValue(data.target_month),
    date: stringValue(data.date),
    is_open: booleanInteger(data.is_open, true),
    is_weekend: booleanInteger(data.is_weekend, false),
    is_event_day: booleanInteger(data.is_event_day, false),
    event_name: stringValue(data.event_name),
    demand_level: stringValue(data.demand_level, "normal"),
    new_product_active: booleanInteger(data.new_product_active, false),
    note: stringValue(data.note),
  };
}

export function getBusinessDays(targetMonth) {
  return targetMonth
    ? getAllFromIndex("business_days", "by_month", targetMonth)
    : getAllFromStore("business_days");
}

export function getBusinessDayByDate(date) {
  return runTransaction("business_days", "readonly", (transaction) =>
    requestToPromise(
      transaction.objectStore("business_days").index("by_date").get(date),
    ),
  );
}

export function upsertBusinessDay(data) {
  const record = normalizeBusinessDay(data);
  return runTransaction("business_days", "readwrite", async (transaction) => {
    const store = transaction.objectStore("business_days");
    const existing = await requestToPromise(store.index("by_date").get(record.date));
    if (existing) {
      record.id = existing.id;
    }
    const id = await requestToPromise(store.put(record));
    return { ...record, id };
  });
}
