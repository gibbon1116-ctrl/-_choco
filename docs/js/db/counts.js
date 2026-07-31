import { requestToPromise, runTransaction } from "./helpers.js";

export function counts(targetMonth) {
  return runTransaction(
    ["employees", "shift_types", "requirements", "requests"],
    "readonly",
    async (transaction) => {
      const employeeCount = requestToPromise(
        transaction.objectStore("employees").index("by_active").count(1),
      );
      const shiftCount = requestToPromise(
        transaction.objectStore("shift_types").count(),
      );
      const requirementStore = transaction.objectStore("requirements");
      const requestStore = transaction.objectStore("requests");
      const requirementCount = requestToPromise(
        targetMonth
          ? requirementStore.index("by_month").count(targetMonth)
          : requirementStore.count(),
      );
      const requestCount = requestToPromise(
        targetMonth
          ? requestStore.index("by_month").count(targetMonth)
          : requestStore.count(),
      );

      const [employees, shifts, requirements, requests] = await Promise.all([
        employeeCount,
        shiftCount,
        requirementCount,
        requestCount,
      ]);
      return { employees, shifts, requirements, requests };
    },
  );
}
