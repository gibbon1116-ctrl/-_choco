import {
  booleanInteger,
  getAllFromStore,
  hasMatchingRecord,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

function normalizeShiftType(data) {
  return {
    shift_code: stringValue(data.shift_code).trim().toUpperCase(),
    shift_name: stringValue(data.shift_name).trim(),
    is_work: booleanInteger(data.is_work, true),
    start_time: stringValue(data.start_time),
    end_time: stringValue(data.end_time),
    requires_rest_next_day: booleanInteger(
      data.requires_rest_next_day,
      false,
    ),
    color: stringValue(data.color, "FFFFFF").replaceAll("#", "").toUpperCase(),
    note: stringValue(data.note),
  };
}

export function getAllShiftTypes() {
  return getAllFromStore("shift_types");
}

export async function upsertShiftType(data) {
  const shiftType = normalizeShiftType(data);
  await runTransaction("shift_types", "readwrite", (transaction) =>
    requestToPromise(transaction.objectStore("shift_types").put(shiftType)),
  );
  return shiftType;
}

export function deleteShiftType(shiftCode) {
  const code = stringValue(shiftCode).trim().toUpperCase();
  if (code === "O") {
    throw new Error("休み区分 O は削除できません。");
  }

  return runTransaction(
    ["shift_types", "requirements"],
    "readwrite",
    async (transaction) => {
      const inUse = await hasMatchingRecord(
        transaction.objectStore("requirements"),
        (requirement) => requirement.shift_code === code,
      );
      if (inUse) {
        throw new Error("必要人数で使用中の勤務区分は削除できません。");
      }
      await requestToPromise(
        transaction.objectStore("shift_types").delete(code),
      );
    },
  );
}
