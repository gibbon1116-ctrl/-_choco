import {
  getAllFromIndex,
  getAllFromStore,
  integerValue,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

function localIsoSeconds(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join("T");
}

function latestFromSource(source, query = null) {
  return new Promise((resolve, reject) => {
    const request = source.openCursor(query, "prev");
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => reject(request.error);
  });
}

export function getSchedules(targetMonth) {
  return targetMonth
    ? getAllFromIndex("schedules", "by_month", targetMonth)
    : getAllFromStore("schedules");
}

export function saveSchedule(
  targetMonth,
  status,
  assignments,
  objectiveValue,
  solverWallTime,
  note = "",
) {
  const record = {
    target_month: stringValue(targetMonth),
    created_at: localIsoSeconds(),
    status: stringValue(status),
    objective_value: objectiveValue ?? null,
    solver_wall_time: solverWallTime ?? null,
    note: stringValue(note),
    assignments: Array.from(assignments, (assignment) => ({
      employee_id: stringValue(assignment.employee_id),
      date: stringValue(assignment.date),
      shift_code: stringValue(assignment.shift_code),
    })),
  };

  return runTransaction("schedules", "readwrite", async (transaction) => {
    const scheduleId = await requestToPromise(
      transaction.objectStore("schedules").add(record),
    );
    return scheduleId;
  });
}

export function updateScheduleAssignments(scheduleId, assignments) {
  return runTransaction("schedules", "readwrite", async (transaction) => {
    const store = transaction.objectStore("schedules");
    const record = await requestToPromise(store.get(integerValue(scheduleId)));
    if (!record) {
      throw new Error("対象の勤務表が見つかりませんでした。");
    }

    const updatedRecord = {
      ...record,
      assignments: Array.from(assignments, (assignment) => ({
        employee_id: stringValue(assignment.employee_id),
        date: stringValue(assignment.date),
        shift_code: stringValue(assignment.shift_code),
      })),
      edited_at: localIsoSeconds(),
    };
    await requestToPromise(store.put(updatedRecord));
    return updatedRecord;
  });
}

export function latestSchedule(targetMonth) {
  return runTransaction("schedules", "readonly", (transaction) => {
    const store = transaction.objectStore("schedules");
    return targetMonth
      ? latestFromSource(
        store.index("by_month"),
        IDBKeyRange.only(targetMonth),
      )
      : latestFromSource(store);
  });
}
