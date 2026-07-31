import * as databaseApi from "./db/index.js";
import * as calendarApi from "./utils/calendar.js";

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    console.info("永続ストレージAPIは利用できません。");
    return false;
  }

  const persisted = await navigator.storage.persist();
  console.info("永続ストレージ:", persisted ? "許可済み" : "未許可");
  return persisted;
}

globalThis.shiftScheduler = Object.freeze({
  ...databaseApi,
  ...calendarApi,
});

try {
  await Promise.all([
    databaseApi.openDatabase(),
    requestPersistentStorage(),
  ]);
  console.info("勤務表メーカー Phase 1 のデータ層を初期化しました。");
} catch (error) {
  console.error("勤務表メーカーの初期化に失敗しました。", error);
}

const app = document.querySelector("#app");

if (app) {
  const message = document.createElement("p");
  message.textContent = "勤務表メーカー（ブラウザ版・実装中）";
  app.append(message);
}
