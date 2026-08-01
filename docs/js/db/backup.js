import {
  DATABASE_VERSION,
  STORE_NAMES,
  openDatabase,
} from "./database.js";
import {
  requestToPromise,
  transactionToPromise,
} from "./helpers.js";

export const BACKUP_SCHEMA_VERSION = DATABASE_VERSION;

function backupFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `勤務表メーカー_バックアップ_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
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

async function readStores(database) {
  const transaction = database.transaction(STORE_NAMES, "readonly");
  const completed = transactionToPromise(transaction);
  try {
    const entries = await Promise.all(STORE_NAMES.map(async (storeName) => [
      storeName,
      await requestToPromise(transaction.objectStore(storeName).getAll()),
    ]));
    await completed;
    return Object.fromEntries(entries);
  } catch (error) {
    try { transaction.abort(); } catch { /* The transaction may already be finished. */ }
    throw error;
  }
}

function normalizedBackup(jsonData) {
  let backup = jsonData;
  if (typeof backup === "string") {
    try {
      backup = JSON.parse(backup);
    } catch {
      throw new Error("バックアップJSONを読み取れませんでした。");
    }
  }
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new Error("バックアップデータの形式が正しくありません。");
  }
  if (Number(backup.schemaVersion) !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`対応していないバックアップのスキーマバージョンです: ${backup.schemaVersion ?? "未指定"}`);
  }
  if (!backup.stores || typeof backup.stores !== "object") {
    throw new Error("バックアップにストアデータがありません。");
  }
  for (const storeName of STORE_NAMES) {
    if (!Array.isArray(backup.stores[storeName])) {
      throw new Error(`バックアップに必要なストアがありません: ${storeName}`);
    }
  }
  return backup;
}

export async function exportAllData({
  download = true,
  database = null,
  now = new Date(),
} = {}) {
  const targetDatabase = database ?? await openDatabase();
  const backup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    stores: await readStores(targetDatabase),
  };
  if (download) downloadJson(backup, backupFilename(now));
  return backup;
}

export async function importAllData(jsonData, { database = null } = {}) {
  const backup = normalizedBackup(jsonData);
  const targetDatabase = database ?? await openDatabase();
  const transaction = targetDatabase.transaction(STORE_NAMES, "readwrite");
  const completed = transactionToPromise(transaction);
  try {
    const requests = [];
    for (const storeName of STORE_NAMES) {
      const store = transaction.objectStore(storeName);
      requests.push(requestToPromise(store.clear()));
      for (const record of backup.stores[storeName]) {
        requests.push(requestToPromise(store.put(structuredClone(record))));
      }
    }
    await Promise.all(requests);
    await completed;
  } catch (error) {
    try { transaction.abort(); } catch { /* Preserve the original error. */ }
    try { await completed; } catch { /* Preserve the original error. */ }
    throw error;
  }
  return Object.fromEntries(STORE_NAMES.map(
    (storeName) => [storeName, backup.stores[storeName].length],
  ));
}
