import {
  booleanInteger,
  getAllFromIndex,
  getAllFromStore,
  integerValue,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

function normalizeStaffRelation(data) {
  const relation = {
    employee_id_1: stringValue(data.employee_id_1),
    employee_id_2: stringValue(data.employee_id_2),
    relation_type: stringValue(data.relation_type),
    priority: stringValue(data.priority, "soft"),
    weight: integerValue(data.weight, 50),
    note: stringValue(data.note),
    active: booleanInteger(data.active, true),
  };
  if (data.id) {
    relation.id = integerValue(data.id);
  }
  return relation;
}

export function getAllStaffRelations() {
  return getAllFromStore("staff_relations");
}

export async function getStaffRelationsByEmployee(employeeId) {
  const key = stringValue(employeeId);
  const [asFirst, asSecond] = await Promise.all([
    getAllFromIndex("staff_relations", "by_employee_1", key),
    getAllFromIndex("staff_relations", "by_employee_2", key),
  ]);
  return Array.from(
    new Map([...asFirst, ...asSecond].map((relation) => [relation.id, relation])).values(),
  );
}

export async function upsertStaffRelation(data) {
  const relation = normalizeStaffRelation(data);
  const id = await runTransaction("staff_relations", "readwrite", (transaction) =>
    requestToPromise(transaction.objectStore("staff_relations").put(relation)),
  );
  return { ...relation, id };
}

export function deleteStaffRelation(id) {
  return runTransaction("staff_relations", "readwrite", (transaction) =>
    requestToPromise(
      transaction.objectStore("staff_relations").delete(integerValue(id)),
    ),
  );
}
