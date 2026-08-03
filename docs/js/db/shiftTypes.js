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

function normalizeShiftCode(value) {
  return stringValue(value).trim().toUpperCase();
}

function matchesShiftCode(value, code) {
  return normalizeShiftCode(value) === code;
}

function emptyShiftTypeUsage() {
  return {
    requirements: 0,
    roleRequirements: 0,
    requests: 0,
    scheduleAssignments: 0,
    total: 0,
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

export function countShiftTypeUsage(shiftCode) {
  const code = normalizeShiftCode(shiftCode);

  return runTransaction(
    ["requirements", "role_requirements", "requests", "schedules"],
    "readonly",
    async (transaction) => {
      const [requirements, roleRequirements, requests, schedules] =
        await Promise.all([
          requestToPromise(
            transaction.objectStore("requirements").getAll(),
          ),
          requestToPromise(
            transaction.objectStore("role_requirements").getAll(),
          ),
          requestToPromise(transaction.objectStore("requests").getAll()),
          requestToPromise(transaction.objectStore("schedules").getAll()),
        ]);

      const usage = {
        requirements: requirements.filter((requirement) =>
          matchesShiftCode(requirement.shift_code, code)
        ).length,
        roleRequirements: roleRequirements.filter((requirement) =>
          matchesShiftCode(requirement.shift_code, code)
        ).length,
        requests: requests.filter((request) =>
          matchesShiftCode(request.shift_code, code)
        ).length,
        scheduleAssignments: schedules.reduce(
          (count, schedule) => count + (
            Array.isArray(schedule.assignments)
              ? schedule.assignments.filter((assignment) =>
                matchesShiftCode(assignment?.shift_code, code)
              ).length
              : 0
          ),
          0,
        ),
      };
      usage.total = usage.requirements
        + usage.roleRequirements
        + usage.requests
        + usage.scheduleAssignments;
      return usage;
    },
  );
}

export function deleteShiftType(shiftCode, { cascade = false } = {}) {
  const code = normalizeShiftCode(shiftCode);
  if (code === "O") {
    throw new Error("休み区分 O は削除できません。");
  }

  if (cascade) {
    return runTransaction(
      [
        "shift_types",
        "requirements",
        "role_requirements",
        "requests",
        "schedules",
        "settings",
      ],
      "readwrite",
      async (transaction) => {
        const shiftTypesStore = transaction.objectStore("shift_types");
        const requirementsStore = transaction.objectStore("requirements");
        const roleRequirementsStore = transaction.objectStore(
          "role_requirements",
        );
        const requestsStore = transaction.objectStore("requests");
        const schedulesStore = transaction.objectStore("schedules");
        const settingsStore = transaction.objectStore("settings");
        const [requirements, roleRequirements, requests, schedules, settings] =
          await Promise.all([
            requestToPromise(requirementsStore.getAll()),
            requestToPromise(roleRequirementsStore.getAll()),
            requestToPromise(requestsStore.getAll()),
            requestToPromise(schedulesStore.getAll()),
            requestToPromise(settingsStore.get(1)),
          ]);

        const matchingRequirements = requirements.filter((requirement) =>
          matchesShiftCode(requirement.shift_code, code)
        );
        const matchingRoleRequirements = roleRequirements.filter(
          (requirement) => matchesShiftCode(requirement.shift_code, code),
        );
        const matchingRequests = requests.filter((request) =>
          matchesShiftCode(request.shift_code, code)
        );
        let scheduleAssignments = 0;
        const changedSchedules = [];

        for (const schedule of schedules) {
          if (!Array.isArray(schedule.assignments)) continue;
          let changed = false;
          const assignments = schedule.assignments.map((assignment) => {
            if (!matchesShiftCode(assignment?.shift_code, code)) {
              return assignment;
            }
            changed = true;
            scheduleAssignments += 1;
            return { ...assignment, shift_code: "O" };
          });
          if (changed) {
            changedSchedules.push({ ...schedule, assignments });
          }
        }

        const usage = {
          requirements: matchingRequirements.length,
          roleRequirements: matchingRoleRequirements.length,
          requests: matchingRequests.length,
          scheduleAssignments,
          total: matchingRequirements.length
            + matchingRoleRequirements.length
            + matchingRequests.length
            + scheduleAssignments,
        };
        const mutations = [
          ...matchingRequirements.map((requirement) =>
            requestToPromise(requirementsStore.delete(requirement.id))
          ),
          ...matchingRoleRequirements.map((requirement) =>
            requestToPromise(roleRequirementsStore.delete(requirement.id))
          ),
          ...matchingRequests.map((request) =>
            requestToPromise(requestsStore.delete(request.id))
          ),
          ...changedSchedules.map((schedule) =>
            requestToPromise(schedulesStore.put(schedule))
          ),
        ];

        if (
          settings
          && settings.requirement_template
          && typeof settings.requirement_template === "object"
          && !Array.isArray(settings.requirement_template)
        ) {
          const requirementTemplate = { ...settings.requirement_template };
          let templateChanged = false;
          for (const templateShiftCode of Object.keys(requirementTemplate)) {
            if (matchesShiftCode(templateShiftCode, code)) {
              delete requirementTemplate[templateShiftCode];
              templateChanged = true;
            }
          }
          if (templateChanged) {
            mutations.push(requestToPromise(settingsStore.put({
              ...settings,
              requirement_template: requirementTemplate,
            })));
          }
        }

        mutations.push(requestToPromise(shiftTypesStore.delete(code)));
        await Promise.all(mutations);
        return usage;
      },
    );
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
      return emptyShiftTypeUsage();
    },
  );
}
