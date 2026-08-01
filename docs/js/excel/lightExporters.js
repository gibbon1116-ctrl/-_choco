import * as databaseApi from "../db/index.js";
import {
  EMPLOYEE_COLUMNS,
  PRODUCT_CAMPAIGN_COLUMNS,
  REQUIREMENT_COLUMNS,
  REQUEST_COLUMNS,
  ROLE_REQUIREMENT_COLUMNS,
  STAFF_RELATION_COLUMNS,
  STAFF_SKILL_COLUMNS,
  createLightSheet,
  getXlsx,
  rowsFromRecords,
  workbookResult,
} from "./xlsxCore.js";

export function exportRows(records, columns, sheetName, filename, options = {}) {
  const xlsx = getXlsx();
  const workbook = xlsx.utils.book_new();
  const worksheet = createLightSheet(rowsFromRecords(records, columns));
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbookResult(workbook, filename, options);
}

export async function exportEmployees({
  api = databaseApi,
  download = true,
  filename = "職員マスタ.xlsx",
} = {}) {
  return exportRows(await api.getAllEmployees(), EMPLOYEE_COLUMNS, "職員マスタ", filename, { download });
}

export async function exportStaffSkills({
  api = databaseApi,
  download = true,
  filename = "スタッフスキル.xlsx",
} = {}) {
  return exportRows(await api.getAllEmployees(), STAFF_SKILL_COLUMNS, "スタッフスキル", filename, { download });
}

export async function exportRequirements(targetMonth, {
  api = databaseApi,
  download = true,
  filename = `必要人数_${String(targetMonth).replace("-", "")}.xlsx`,
} = {}) {
  return exportRows(
    await api.getRequirements(targetMonth),
    REQUIREMENT_COLUMNS,
    "必要人数",
    filename,
    { download },
  );
}

export async function exportRequests(targetMonth, {
  api = databaseApi,
  download = true,
  filename = `希望休・勤務希望_${String(targetMonth).replace("-", "")}.xlsx`,
} = {}) {
  return exportRows(
    await api.getRequests(targetMonth),
    REQUEST_COLUMNS,
    "希望休・勤務希望",
    filename,
    { download },
  );
}

export async function exportStaffRelations({
  api = databaseApi,
  download = true,
  filename = "スタッフ配置条件.xlsx",
} = {}) {
  return exportRows(
    await api.getAllStaffRelations(),
    STAFF_RELATION_COLUMNS,
    "スタッフ配置条件",
    filename,
    { download },
  );
}

export async function exportProductCampaigns({
  api = databaseApi,
  download = true,
  filename = "新商品キャンペーン.xlsx",
} = {}) {
  return exportRows(
    await api.getAllProductCampaigns(),
    PRODUCT_CAMPAIGN_COLUMNS,
    "新商品キャンペーン",
    filename,
    { download },
  );
}

export async function exportRoleRequirements(targetMonth, {
  api = databaseApi,
  download = true,
  filename = `役割別必要人数_${String(targetMonth).replace("-", "")}.xlsx`,
} = {}) {
  return exportRows(
    await api.getRoleRequirements(targetMonth),
    ROLE_REQUIREMENT_COLUMNS,
    "役割別必要人数",
    filename,
    { download },
  );
}
