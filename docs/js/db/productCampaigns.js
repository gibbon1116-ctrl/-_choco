import {
  booleanInteger,
  getAllFromStore,
  integerValue,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

function normalizeProductCampaign(data) {
  const campaign = {
    product_name: stringValue(data.product_name),
    category: stringValue(data.category),
    start_date: stringValue(data.start_date),
    end_date: stringValue(data.end_date),
    required_skill_level: integerValue(data.required_skill_level, 2),
    require_leader_first_week: booleanInteger(
      data.require_leader_first_week,
      true,
    ),
    note: stringValue(data.note),
  };
  if (data.id) {
    campaign.id = integerValue(data.id);
  }
  return campaign;
}

export function getAllProductCampaigns() {
  return getAllFromStore("product_campaigns");
}

export async function upsertProductCampaign(data) {
  const campaign = normalizeProductCampaign(data);
  const id = await runTransaction("product_campaigns", "readwrite", (transaction) =>
    requestToPromise(transaction.objectStore("product_campaigns").put(campaign)),
  );
  return { ...campaign, id };
}

export function deleteProductCampaign(id) {
  return runTransaction("product_campaigns", "readwrite", (transaction) =>
    requestToPromise(
      transaction.objectStore("product_campaigns").delete(integerValue(id)),
    ),
  );
}
