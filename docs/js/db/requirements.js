import {
  deleteRecordsByIndex,
  getAllFromIndex,
  getAllFromStore,
  integerValue,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

export function getRequirements(targetMonth) {
  return targetMonth
    ? getAllFromIndex("requirements", "by_month", targetMonth)
    : getAllFromStore("requirements");
}

export function replaceRequirements(targetMonth, rows) {
  const month = stringValue(targetMonth);
  const records = Array.from(rows)
    .map((row) => ({
      target_month: month,
      date: stringValue(row.date),
      shift_code: stringValue(row.shift_code),
      required_count: integerValue(row.required_count),
    }))
    .filter((row) => row.required_count >= 0);

  return runTransaction("requirements", "readwrite", async (transaction) => {
    const store = transaction.objectStore("requirements");
    await deleteRecordsByIndex(store, "by_month", month);
    for (const record of records) {
      await requestToPromise(store.add(record));
    }
    return records.length;
  });
}
