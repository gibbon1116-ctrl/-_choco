import { freezePanesInXlsx } from "./zipFreezePanes.js";

export const EMPLOYEE_COLUMNS = Object.freeze([
  "employee_id", "name", "role", "skills", "active", "night_allowed",
  "max_consecutive_days", "min_work_days", "max_work_days", "note",
  "english_level", "can_cashier", "can_open", "can_close",
  "can_handle_complaints", "can_explain_allergy", "is_new_staff",
  "can_train_new_staff", "product_skill_ice", "product_skill_chocolate",
  "product_skill_cookie", "new_product_skill", "can_manage_cash",
  "can_hygiene_check", "peak_support_level",
]);

export const STAFF_SKILL_COLUMNS = Object.freeze([
  "employee_id", "name", "english_level", "can_cashier", "can_open",
  "can_close", "can_handle_complaints", "can_explain_allergy", "is_new_staff",
  "can_train_new_staff", "product_skill_ice", "product_skill_chocolate",
  "product_skill_cookie", "new_product_skill", "can_manage_cash",
  "can_hygiene_check", "peak_support_level",
]);

export const STAFF_RELATION_COLUMNS = Object.freeze([
  "employee_id_1", "employee_id_2", "relation_type", "priority", "weight", "active", "note",
]);
export const PRODUCT_CAMPAIGN_COLUMNS = Object.freeze([
  "product_name", "category", "start_date", "end_date",
  "required_skill_level", "require_leader_first_week", "note",
]);
export const ROLE_REQUIREMENT_COLUMNS = Object.freeze([
  "target_month", "date", "shift_code", "role_code", "required_count", "priority",
]);
export const REQUIREMENT_COLUMNS = Object.freeze([
  "target_month", "date", "shift_code", "required_count",
]);
export const REQUEST_COLUMNS = Object.freeze([
  "target_month", "employee_id", "date", "request_type", "shift_code", "priority", "note",
]);

const THIN_BORDER = Object.freeze({ style: "thin", color: { rgb: "D8DEE8" } });

export function getXlsx() {
  const xlsx = globalThis.XLSX;
  if (!xlsx?.utils?.book_new || !xlsx?.read || !xlsx?.write) {
    throw new Error("xlsx-js-styleを読み込めませんでした。");
  }
  return xlsx;
}

export function displayWidth(value) {
  let width = 0;
  for (const character of String(value ?? "")) {
    const code = character.codePointAt(0);
    width += (
      code >= 0x1100
      && (code <= 0x115f || code === 0x2329 || code === 0x232a
        || (code >= 0x2e80 && code <= 0xa4cf)
        || (code >= 0xac00 && code <= 0xd7a3)
        || (code >= 0xf900 && code <= 0xfaff)
        || (code >= 0xfe10 && code <= 0xfe6f)
        || (code >= 0xff00 && code <= 0xff60)
        || (code >= 0xffe0 && code <= 0xffe6))
    ) ? 2 : 1;
  }
  return width;
}

function mergeStyle(cell, style) {
  cell.s = {
    ...(cell.s ?? {}),
    ...style,
    font: { ...(cell.s?.font ?? {}), ...(style.font ?? {}) },
    fill: { ...(cell.s?.fill ?? {}), ...(style.fill ?? {}) },
    alignment: { ...(cell.s?.alignment ?? {}), ...(style.alignment ?? {}) },
    border: { ...(cell.s?.border ?? {}), ...(style.border ?? {}) },
  };
}

function cellsInRange(worksheet) {
  const xlsx = getXlsx();
  const range = xlsx.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
  const cells = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = xlsx.utils.encode_cell({ r: row, c: column });
      if (worksheet[address]) cells.push({ cell: worksheet[address], row, column });
    }
  }
  return { cells, range };
}

function autoColumns(worksheet, rows, maximumWidth, padding) {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  worksheet["!cols"] = Array.from({ length: columnCount }, (_, column) => ({
    wch: Math.min(
      Math.max(0, ...rows.map((row) => displayWidth(row[column]?.v ?? row[column]))) + padding,
      maximumWidth,
    ),
  }));
}

export function createLightSheet(rows) {
  const xlsx = getXlsx();
  const worksheet = xlsx.utils.aoa_to_sheet(rows);
  const { range } = cellsInRange(worksheet);
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = worksheet[xlsx.utils.encode_cell({ r: 0, c: column })];
    if (!cell) continue;
    mergeStyle(cell, {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: "1649C6" } },
    });
  }
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  worksheet["!freeze"] = {
    xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen",
  };
  autoColumns(worksheet, rows, 35, 2);
  return worksheet;
}

export function styleScheduleSheet(worksheet, rows) {
  const xlsx = getXlsx();
  const { cells, range } = cellsInRange(worksheet);
  for (const { cell, row } of cells) {
    mergeStyle(cell, {
      border: { bottom: THIN_BORDER },
      alignment: { vertical: "center", wrapText: true },
    });
    if (row === 0) {
      mergeStyle(cell, {
        fill: { patternType: "solid", fgColor: { rgb: "10233F" } },
        font: { bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
      });
    }
  }
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  worksheet["!freeze"] = {
    xSplit: 1, ySplit: 1, topLeftCell: "B2", activePane: "bottomRight", state: "frozen",
  };
  worksheet["!gridlines"] = false;
  autoColumns(worksheet, rows, 40, 3);
  worksheet["!rows"] = Array.from({ length: range.e.r + 1 }, (_, row) => {
    if (row === 0) return { hpt: 26 };
    let lines = 1;
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = worksheet[xlsx.utils.encode_cell({ r: row, c: column })];
      const width = worksheet["!cols"]?.[column]?.wch ?? 10;
      lines = Math.max(lines, Math.ceil(displayWidth(cell?.v) / Math.max(8, width - 2)));
    }
    return lines > 1 ? { hpt: Math.min(90, 16 * lines) } : undefined;
  });
  return worksheet;
}

export async function workbookFromSource(source) {
  const xlsx = getXlsx();
  if (source?.SheetNames && source?.Sheets) return source;
  if (source?.workbook?.SheetNames) return source.workbook;
  let input = source?.arrayBuffer ?? source;
  if (typeof input?.arrayBuffer === "function") input = await input.arrayBuffer();
  if (ArrayBuffer.isView(input)) {
    input = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  if (!(input instanceof ArrayBuffer)) {
    throw new TypeError("Excelファイル、ArrayBuffer、またはWorkbookを指定してください。");
  }
  return xlsx.read(input, { type: "array", cellDates: true });
}

export async function firstSheetRows(source) {
  const xlsx = getXlsx();
  const workbook = await workbookFromSource(source);
  const firstName = workbook.SheetNames[0];
  if (!firstName) return [];
  return xlsx.utils.sheet_to_json(workbook.Sheets[firstName], { defval: "", raw: true });
}

export function requireColumns(rows, required) {
  const columns = new Set(rows.columns ?? Object.keys(rows[0] ?? {}));
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length) {
    throw new Error(`Excelに必要な列がありません: ${missing.join(", ")}`);
  }
}

export async function sheetRowsWithColumns(source) {
  const xlsx = getXlsx();
  const workbook = await workbookFromSource(source);
  const firstName = workbook.SheetNames[0];
  if (!firstName) {
    const rows = [];
    rows.columns = [];
    return rows;
  }
  const worksheet = workbook.Sheets[firstName];
  const arrays = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true });
  const columns = (arrays[0] ?? []).map((column) => String(column));
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: "", raw: true });
  rows.columns = columns;
  return rows;
}

export async function workbookResult(workbook, filename, { download = true } = {}) {
  const xlsx = getXlsx();
  let arrayBuffer = xlsx.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true });
  arrayBuffer = await freezePanesInXlsx(arrayBuffer, workbook);
  if (download) {
    const blob = new Blob([arrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return { workbook, arrayBuffer, filename };
}

export function rowsFromRecords(records, columns) {
  return [
    [...columns],
    ...records.map((record) => columns.map((column) => record[column] ?? "")),
  ];
}
