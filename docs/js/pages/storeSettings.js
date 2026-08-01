import { getSettings, saveSettings } from "../db/index.js";
import { exportAllData, importAllData } from "../db/backup.js";
import { getStorageStatus, requestStoragePersistence } from "../utils/storage.js";
import {
  SKILL_DEFINITIONS,
  skillLevelChoices,
} from "../utils/restaurantSkills.js";
import {
  createAlert,
  createButton,
  createCheckbox,
  createField,
  createLoading,
  createPageHeading,
  createSelect,
  element,
  showAlert,
} from "./pageUtils.js";

const PRIORITY_OPTIONS = Object.freeze([
  { value: "hard", label: "必須" },
  { value: "soft", label: "できる限り" },
]);

let renderVersion = 0;

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

async function updateStorageStatus(persistedValue, estimateValue) {
  if (!navigator.storage) {
    persistedValue.textContent = "このブラウザではStorage APIを利用できません。";
    estimateValue.textContent = "使用量を取得できません。";
    return;
  }
  try {
    const status = await getStorageStatus();
    persistedValue.textContent = status.persisted ? "許可済み" : "未許可";
    estimateValue.textContent = `${formatBytes(status.usage)} / ${formatBytes(status.quota)}`;
  } catch (error) {
    persistedValue.textContent = "取得できませんでした。";
    estimateValue.textContent = error instanceof Error ? error.message : String(error);
  }
}

function createDataManagementSection(container) {
  const section = element("section", "crud-card data-management-card");
  const header = element("div", "crud-card__header");
  const title = element("div");
  title.append(
    element("h2", "crud-card__title", "データ管理"),
    element("p", "crud-form__caption", "ブラウザ内データの保存状況、バックアップ、復元を管理します。"),
  );
  header.append(title);
  const messageRegion = element("div", "form-message-region data-management-message");
  const statusGrid = element("div", "storage-status-grid");
  const persistedCard = element("div", "storage-status-card");
  const persistedValue = element("strong", "storage-status-card__value", "確認中…");
  persistedCard.append(element("span", "storage-status-card__label", "永続ストレージ"), persistedValue);
  const estimateCard = element("div", "storage-status-card");
  const estimateValue = element("strong", "storage-status-card__value", "確認中…");
  estimateCard.append(element("span", "storage-status-card__label", "使用中 / 割当上限"), estimateValue);
  statusGrid.append(persistedCard, estimateCard);

  const actions = element("div", "data-management-actions");
  const persistButton = createButton("永続化を再リクエスト", { variant: "secondary" });
  const backupButton = createButton("バックアップをダウンロード", { variant: "primary" });
  const restoreButton = createButton("バックアップから復元", { variant: "secondary" });
  const fileInput = element("input", "visually-hidden");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.setAttribute("aria-label", "復元するバックアップJSONを選択");

  persistButton.addEventListener("click", async () => {
    persistButton.disabled = true;
    try {
      if (!navigator.storage?.persist) throw new Error("このブラウザでは永続化をリクエストできません。");
      const persisted = await requestStoragePersistence();
      showAlert(
        messageRegion,
        persisted ? "永続ストレージが許可されました。" : "永続ストレージは許可されませんでした。",
        persisted ? "success" : "warning",
      );
      await updateStorageStatus(persistedValue, estimateValue);
    } catch (error) {
      showAlert(messageRegion, error.message || "永続化をリクエストできませんでした。");
    } finally {
      persistButton.disabled = false;
    }
  });

  backupButton.addEventListener("click", async () => {
    backupButton.disabled = true;
    try {
      const backup = await exportAllData({ download: true });
      showAlert(
        messageRegion,
        `10ストアのバックアップを作成しました（${backup.exportedAt}）。`,
        "success",
      );
      await updateStorageStatus(persistedValue, estimateValue);
    } catch (error) {
      showAlert(messageRegion, error.message || "バックアップを作成できませんでした。");
    } finally {
      backupButton.disabled = false;
    }
  });

  restoreButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const confirmed = globalThis.confirm(
      "バックアップから復元すると、現在の全データが削除されます。復元を実行しますか？",
    );
    if (!confirmed) {
      fileInput.value = "";
      return;
    }
    restoreButton.disabled = true;
    try {
      const json = await file.text();
      const restored = await importAllData(json);
      const total = Object.values(restored).reduce((sum, count) => sum + count, 0);
      await renderStoreSettingsPage(container, {
        type: "success",
        message: `バックアップから10ストア・${total}件を復元しました。`,
      });
    } catch (error) {
      showAlert(messageRegion, error.message || "バックアップを復元できませんでした。");
      restoreButton.disabled = false;
      fileInput.value = "";
    }
  });

  actions.append(persistButton, backupButton, restoreButton, fileInput);
  section.append(header, messageRegion, statusGrid, actions);
  void updateStorageStatus(persistedValue, estimateValue);
  return section;
}

function normalizedSkillValue(definition, setting) {
  const options = skillLevelChoices(definition.code);
  const stored = String(setting?.minimum_level ?? options[0].value);
  return options.find((item) => String(item.value) === stored)?.value ?? options[0].value;
}

function createSkillTable(settings, controls) {
  const wrapper = element("div", "app-table-wrap settings-skill-table-wrap");
  const table = element("table", "app-table settings-skill-table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["スキル", "最低能力", "必要人数", "優先度"]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);
  const body = element("tbody");

  for (const definition of SKILL_DEFINITIONS) {
    const setting = settings.skills?.[definition.code] ?? {};
    const row = element("tr");
    const nameCell = element("td", "settings-skill-name");
    nameCell.append(
      element("span", "settings-skill-name__label", definition.label),
      element("span", "settings-skill-name__code", definition.code),
    );

    const levelCell = element("td");
    const level = createSelect({
      label: `${definition.label}の最低能力`,
      name: `skill_level_${definition.code}`,
      options: skillLevelChoices(definition.code),
      value: normalizedSkillValue(definition, setting),
    });
    level.wrapper.classList.add("visually-labeled-control");
    levelCell.append(level.wrapper);

    const countCell = element("td");
    const count = createField({
      label: `${definition.label}の必要人数`,
      name: `skill_count_${definition.code}`,
      type: "number",
      value: Number(setting.required_count ?? 0),
      min: 0,
      max: 20,
      inputMode: "numeric",
    });
    count.wrapper.classList.add("visually-labeled-control", "settings-count-field");
    countCell.append(count.wrapper);

    const priorityCell = element("td");
    const priority = createSelect({
      label: `${definition.label}の優先度`,
      name: `skill_priority_${definition.code}`,
      options: PRIORITY_OPTIONS,
      value: setting.priority === "hard" ? "hard" : "soft",
    });
    priority.wrapper.classList.add("visually-labeled-control");
    priorityCell.append(priority.wrapper);

    controls.skills.set(definition.code, {
      minimum_level: level.input,
      required_count: count.input,
      priority: priority.input,
    });
    row.append(nameCell, levelCell, countCell, priorityCell);
    body.append(row);
  }

  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function createSettingsForm(settings, container) {
  const form = element("form", "crud-form settings-form");
  form.noValidate = true;
  const header = element("div", "crud-form__header");
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", "crud-form__title", "店舗運営条件"),
    element("p", "crud-form__caption", "必要人数を0人にすると、そのスキル条件は無効になります。"),
  );
  header.append(titleGroup);
  const messageRegion = element("div", "form-message-region");
  const controls = { skills: new Map() };

  const basics = element("div", "form-section");
  basics.append(element("h3", "form-section__title", "基本設定"));
  const basicGrid = element("div", "form-grid form-grid--four");
  const storeName = createField({
    label: "店舗名",
    name: "store_name",
    value: settings.store_name ?? "店舗A",
  });
  const businessHours = createField({
    label: "標準営業時間",
    name: "business_hours",
    value: settings.business_hours ?? "10:00-21:00",
    placeholder: "10:00-21:00",
  });
  const weekdayRequired = createField({
    label: "平日必要人数（標準）",
    name: "weekday_required",
    type: "number",
    value: Number(settings.weekday_required ?? 0),
    min: 0,
    max: 99,
    inputMode: "numeric",
  });
  const weekendRequired = createField({
    label: "土日祝必要人数（標準）",
    name: "weekend_required",
    type: "number",
    value: Number(settings.weekend_required ?? 0),
    min: 0,
    max: 99,
    inputMode: "numeric",
  });
  Object.assign(controls, {
    store_name: storeName.input,
    business_hours: businessHours.input,
    weekday_required: weekdayRequired.input,
    weekend_required: weekendRequired.input,
  });
  basicGrid.append(
    storeName.wrapper,
    businessHours.wrapper,
    weekdayRequired.wrapper,
    weekendRequired.wrapper,
  );
  basics.append(basicGrid);

  const modes = element("div", "settings-mode-grid");
  const restaurantMode = createCheckbox({
    label: "飲食店向け条件を有効にする",
    name: "restaurant_mode",
    checked: settings.restaurant_mode,
  });
  const englishPerShift = createCheckbox({
    label: "英語対応は勤務区分ごとに必要",
    name: "require_english_per_shift",
    checked: settings.require_english_per_shift,
  });
  restaurantMode.wrapper.classList.add("settings-mode-card");
  englishPerShift.wrapper.classList.add("settings-mode-card");
  controls.restaurant_mode = restaurantMode.input;
  controls.require_english_per_shift = englishPerShift.input;
  const englishCard = element("div", "settings-mode-card-wrap");
  englishCard.append(
    englishPerShift.wrapper,
    element("span", "form-field__help", "英語対応人数を、日全体ではなく勤務区分ごとに判定します。"),
  );
  modes.append(restaurantMode.wrapper, englishCard);
  basics.append(modes);

  const skillsSection = element("section", "settings-skills-section");
  const skillsHeader = element("div", "settings-skills-header");
  skillsHeader.append(
    element("h3", "form-section__title", "スキル別の必須・推奨条件"),
    element("span", "count-badge", `${SKILL_DEFINITIONS.length}スキル`),
  );
  skillsSection.append(skillsHeader, createSkillTable(settings, controls));

  const actions = element("div", "form-actions");
  const saveButton = createButton("店舗設定を保存", { variant: "primary" });
  saveButton.type = "submit";
  saveButton.dataset.action = "save-store-settings";
  actions.append(saveButton);
  form.append(header, messageRegion, basics, skillsSection, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errors = [];
    const integerFields = [
      [controls.weekday_required, "平日必要人数（標準）", 99],
      [controls.weekend_required, "土日祝必要人数（標準）", 99],
    ];
    for (const [input, label, maximum] of integerFields) {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0 || value > maximum) {
        errors.push(`${label}は0〜${maximum}の整数で入力してください。`);
      }
    }

    const skills = {};
    for (const definition of SKILL_DEFINITIONS) {
      const skill = controls.skills.get(definition.code);
      const requiredCount = Number(skill.required_count.value);
      if (!Number.isInteger(requiredCount) || requiredCount < 0 || requiredCount > 20) {
        errors.push(`${definition.label}の必要人数は0〜20の整数で入力してください。`);
      }
      skills[definition.code] = {
        minimum_level: skill.minimum_level.value,
        required_count: requiredCount,
        priority: skill.priority.value,
      };
    }
    if (errors.length) {
      showAlert(messageRegion, errors);
      return;
    }

    saveButton.disabled = true;
    try {
      await saveSettings({
        store_name: controls.store_name.value,
        business_hours: controls.business_hours.value,
        weekday_required: Number(controls.weekday_required.value),
        weekend_required: Number(controls.weekend_required.value),
        restaurant_mode: controls.restaurant_mode.checked,
        require_english_per_shift: controls.require_english_per_shift.checked,
        skills,
      });
      await renderStoreSettingsPage(container, {
        type: "success",
        message: "店舗設定を保存しました。",
      });
    } catch (error) {
      saveButton.disabled = false;
      showAlert(messageRegion, error.message || "店舗設定を保存できませんでした。");
    }
  });
  return form;
}

export async function renderStoreSettingsPage(container, notice = null) {
  const version = ++renderVersion;
  container.replaceChildren(createLoading("店舗設定を読み込んでいます…"));
  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    if (version !== renderVersion) return;
    container.replaceChildren(createAlert(error.message || "店舗設定を読み込めませんでした。"));
    return;
  }
  if (version !== renderVersion || container.dataset.page !== "settings") return;

  const page = element("section", "crud-page settings-page");
  const noticeRegion = element("div", "page-notice-region");
  page.append(
    createPageHeading(
      "店舗設定",
      "飲食店向け制約の有効化と、店舗運営上の標準条件を設定します。",
    ),
    noticeRegion,
  );
  if (notice) noticeRegion.append(createAlert(notice.message, notice.type));
  page.append(createSettingsForm(settings, container), createDataManagementSection(container));
  container.replaceChildren(page);
}
