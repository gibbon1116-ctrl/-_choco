import { openDatabase } from "./database.js";

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("トランザクションが中断されました。"));
    transaction.onerror = () => reject(transaction.error ?? new Error("トランザクションに失敗しました。"));
  });
}

export async function runTransaction(storeNames, mode, operation) {
  const database = await openDatabase();
  const transaction = database.transaction(storeNames, mode);
  const completed = transactionToPromise(transaction);

  try {
    const result = await operation(transaction);
    await completed;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have aborted because of the failed request.
    }
    try {
      await completed;
    } catch {
      // Preserve the operation's original, more useful error.
    }
    throw error;
  }
}

export function getAllFromStore(storeName) {
  return runTransaction(storeName, "readonly", (transaction) =>
    requestToPromise(transaction.objectStore(storeName).getAll()),
  );
}

export function getAllFromIndex(storeName, indexName, key) {
  return runTransaction(storeName, "readonly", (transaction) =>
    requestToPromise(transaction.objectStore(storeName).index(indexName).getAll(key)),
  );
}

export function deleteRecordsByIndex(store, indexName, key) {
  return new Promise((resolve, reject) => {
    let deletedCount = 0;
    const request = store.index(indexName).openCursor(IDBKeyRange.only(key));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(deletedCount);
        return;
      }
      cursor.delete();
      deletedCount += 1;
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export function hasMatchingRecord(store, predicate) {
  return new Promise((resolve, reject) => {
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(false);
        return;
      }
      if (predicate(cursor.value)) {
        resolve(true);
        return;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export function integerValue(value, fallback = 0) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function booleanInteger(value, fallback = false) {
  return Number(Boolean(value ?? fallback));
}

export function stringValue(value, fallback = "") {
  return String(value ?? fallback);
}
