import {
  deleteProductCampaign,
  getAllProductCampaigns,
  getBusinessDays,
  upsertBusinessDay,
  upsertProductCampaign,
} from "../db/index.js";
import { getState } from "../state.js";
import { monthLabel } from "../components/monthSelector.js";
import {
  displayDate,
  isWeekend,
  monthDates,
  weekdayLabel,
} from "../utils/calendar.js";
import { SKILL_LEVEL_LABELS } from "../utils/restaurantSkills.js";
import {
  createAlert,
  createButton,
  createCheckbox,
  createField,
  createLoading,
  createPageHeading,
  createSelect,
  createTextArea,
  element,
  showAlert,
} from "./pageUtils.js";

const CATEGORY_LABELS = Object.freeze({
  ice: "アイス",
  chocolate: "チョコ",
  cookie: "クッキー",
  other: "その他",
});
const DEMAND_LABELS = Object.freeze({
  low: "閑散",
  normal: "通常",
  high: "繁忙",
  very_high: "大繁忙",
});
const CATEGORY_OPTIONS = Object.freeze(
  Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
);
const DEMAND_OPTIONS = Object.freeze(
  Object.entries(DEMAND_LABELS).map(([value, label]) => ({ value, label })),
);
const SKILL_OPTIONS = Object.freeze([1, 2, 3].map((value) => ({
  value,
  label: SKILL_LEVEL_LABELS[value],
})));

let renderVersion = 0;

function addCell(row, value, className = "") {
  row.append(element("td", className, String(value ?? "")));
}

function createCampaignTable(campaigns, editorHost, container, noticeRegion) {
  if (!campaigns.length) {
    return element("p", "empty-state", "新商品キャンペーンはまだ登録されていません。");
  }
  const wrapper = element("div", "app-table-wrap");
  const table = element("table", "app-table campaign-table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["商品名", "カテゴリ", "販売期間", "必要能力", "初週リーダー", "備考", "操作"]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);
  const body = element("tbody");
  const sorted = [...campaigns].sort((left, right) =>
    String(left.start_date).localeCompare(String(right.start_date))
      || String(left.product_name).localeCompare(String(right.product_name), "ja"),
  );

  for (const campaign of sorted) {
    const row = element("tr");
    addCell(row, campaign.product_name, "table-key");
    addCell(row, CATEGORY_LABELS[campaign.category] ?? campaign.category);
    addCell(row, `${campaign.start_date} 〜 ${campaign.end_date}`);
    addCell(row, SKILL_LEVEL_LABELS[campaign.required_skill_level] ?? campaign.required_skill_level);
    addCell(row, campaign.require_leader_first_week ? "必要" : "任意");
    addCell(row, campaign.note || "—");

    const actionCell = element("td", "table-actions");
    const buttons = element("div", "table-actions__inner");
    const editButton = createButton("編集", { className: "app-button--small" });
    editButton.dataset.action = "edit-product-campaign";
    editButton.dataset.campaignId = String(campaign.id);
    editButton.addEventListener("click", () => {
      showCampaignForm(editorHost, campaign, container);
    });
    const deleteButton = createButton("削除", {
      variant: "danger",
      className: "app-button--small",
    });
    deleteButton.dataset.action = "delete-product-campaign";
    deleteButton.dataset.campaignId = String(campaign.id);
    deleteButton.addEventListener("click", async () => {
      const confirmed = globalThis.confirm?.(`${campaign.product_name}を削除しますか？`) ?? true;
      if (!confirmed) return;
      deleteButton.disabled = true;
      try {
        await deleteProductCampaign(campaign.id);
        await renderCampaignsEventsPage(container, {
          type: "success",
          message: "新商品キャンペーンを削除しました。",
        });
      } catch (error) {
        deleteButton.disabled = false;
        showAlert(noticeRegion, error.message || "新商品キャンペーンを削除できませんでした。");
      }
    });
    buttons.append(editButton, deleteButton);
    actionCell.append(buttons);
    row.append(actionCell);
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function showCampaignForm(editorHost, campaign, container) {
  const targetMonth = getState().targetMonth;
  const dates = monthDates(targetMonth);
  const current = campaign ?? {
    product_name: "",
    category: "ice",
    start_date: dates[0],
    end_date: dates.at(-1),
    required_skill_level: 2,
    require_leader_first_week: true,
    note: "",
  };
  const form = element("form", "crud-form campaign-form");
  form.noValidate = true;
  const header = element("div", "crud-form__header");
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", "crud-form__title", campaign ? "新商品キャンペーンを編集" : "新商品キャンペーンを追加"),
    element("p", "crud-form__caption", "販売期間と、配置時に必要とする商品対応レベルを設定します。"),
  );
  header.append(titleGroup);
  const messageRegion = element("div", "form-message-region");
  const section = element("div", "form-section");
  const grid = element("div", "form-grid form-grid--three");
  const productName = createField({
    label: "商品名",
    name: "product_name",
    value: current.product_name,
    wide: true,
  });
  const category = createSelect({
    label: "商品カテゴリ",
    name: "category",
    options: CATEGORY_OPTIONS,
    value: current.category,
  });
  const startDate = createField({
    label: "開始日",
    name: "start_date",
    type: "date",
    value: current.start_date,
  });
  const endDate = createField({
    label: "終了日",
    name: "end_date",
    type: "date",
    value: current.end_date,
  });
  const skillLevel = createSelect({
    label: "必要な能力",
    name: "required_skill_level",
    options: SKILL_OPTIONS,
    value: current.required_skill_level,
    help: "職員に想定する商品対応レベルで指定します。",
  });
  const leader = createCheckbox({
    label: "販売初週は指導可能者を優先",
    name: "require_leader_first_week",
    checked: current.require_leader_first_week,
  });
  const leaderWrap = element("div", "check-field-wrap");
  leaderWrap.append(leader.wrapper);
  const note = createTextArea({
    label: "備考",
    name: "note",
    value: current.note ?? "",
    rows: 2,
    wide: true,
  });
  grid.append(
    productName.wrapper,
    category.wrapper,
    startDate.wrapper,
    endDate.wrapper,
    skillLevel.wrapper,
    leaderWrap,
    note.wrapper,
  );
  section.append(grid);

  const actions = element("div", "form-actions");
  const cancelButton = createButton("キャンセル");
  cancelButton.addEventListener("click", () => editorHost.replaceChildren());
  const saveButton = createButton(campaign ? "変更を保存" : "新商品を登録", { variant: "primary" });
  saveButton.type = "submit";
  saveButton.dataset.action = "save-product-campaign";
  actions.append(cancelButton, saveButton);
  form.append(header, messageRegion, section, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      !productName.input.value.trim()
      || !startDate.input.value
      || !endDate.input.value
      || startDate.input.value > endDate.input.value
    ) {
      showAlert(messageRegion, "商品名と販売期間を確認してください。");
      return;
    }
    saveButton.disabled = true;
    try {
      await upsertProductCampaign({
        ...(campaign?.id ? { id: campaign.id } : {}),
        product_name: productName.input.value.trim(),
        category: category.input.value,
        start_date: startDate.input.value,
        end_date: endDate.input.value,
        required_skill_level: Number(skillLevel.input.value),
        require_leader_first_week: leader.input.checked,
        note: note.input.value,
      });
      await renderCampaignsEventsPage(container, {
        type: "success",
        message: campaign ? "新商品キャンペーンを更新しました。" : "新商品を登録しました。",
      });
    } catch (error) {
      saveButton.disabled = false;
      showAlert(messageRegion, error.message || "新商品キャンペーンを保存できませんでした。");
    }
  });

  editorHost.replaceChildren(form);
  editorHost.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function directCheckbox(label, checked) {
  const input = element("input", "business-grid__checkbox");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.setAttribute("aria-label", label);
  return input;
}

function directTextInput(label, value) {
  const input = element("input", "app-input business-grid__text");
  input.type = "text";
  input.value = value ?? "";
  input.setAttribute("aria-label", label);
  return input;
}

function directDemandSelect(label, value) {
  const select = element("select", "app-select business-grid__select");
  select.setAttribute("aria-label", label);
  for (const optionData of DEMAND_OPTIONS) {
    const option = element("option", "", optionData.label);
    option.value = optionData.value;
    select.append(option);
  }
  select.value = DEMAND_LABELS[value] ? value : "normal";
  return select;
}

function createBusinessDaysEditor(businessDays, targetMonth, container) {
  const section = element("section", "crud-card business-days-card");
  const header = element("div", "crud-card__header");
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", "crud-card__title", `${monthLabel(targetMonth)}の営業日・イベント`),
    element("p", "crud-form__caption", "日ごとの営業状態、イベント、繁忙度、新商品対応日を設定します。"),
  );
  header.append(titleGroup, element("span", "count-badge", `${monthDates(targetMonth).length}日分`));
  const messageRegion = element("div", "form-message-region");
  const existing = new Map(businessDays.map((item) => [item.date, item]));
  const controls = new Map();
  const wrapper = element("div", "app-table-wrap business-grid-wrap");
  const table = element("table", "app-table business-grid");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["日付", "営業", "イベント日", "イベント名", "繁忙度", "新商品対応日", "備考"]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);
  const body = element("tbody");

  for (const date of monthDates(targetMonth)) {
    const item = existing.get(date) ?? {};
    const dayLabel = weekdayLabel(date);
    const row = element("tr", dayLabel === "土" ? "is-saturday" : (dayLabel === "日" ? "is-sunday" : ""));
    const dateCell = element("td", "business-grid__date", displayDate(date));
    const open = directCheckbox(`${displayDate(date)} 営業`, item.is_open ?? true);
    const event = directCheckbox(`${displayDate(date)} イベント日`, item.is_event_day ?? false);
    const eventName = directTextInput(`${displayDate(date)} イベント名`, item.event_name ?? "");
    const demand = directDemandSelect(`${displayDate(date)} 繁忙度`, item.demand_level ?? "normal");
    const newProduct = directCheckbox(`${displayDate(date)} 新商品対応日`, item.new_product_active ?? false);
    const note = directTextInput(`${displayDate(date)} 備考`, item.note ?? "");
    for (const control of [open, event, eventName, demand, newProduct, note]) {
      const cell = element("td", "business-grid__control");
      cell.append(control);
      row.append(cell);
    }
    row.prepend(dateCell);
    controls.set(date, { open, event, eventName, demand, newProduct, note });
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);

  const actions = element("div", "form-actions");
  const saveButton = createButton("営業日・イベントを保存", { variant: "primary" });
  saveButton.dataset.action = "save-business-days";
  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      for (const [date, fields] of controls) {
        await upsertBusinessDay({
          target_month: targetMonth,
          date,
          is_open: fields.open.checked,
          is_weekend: isWeekend(date),
          is_event_day: fields.event.checked,
          event_name: fields.eventName.value,
          demand_level: fields.demand.value,
          new_product_active: fields.newProduct.checked,
          note: fields.note.value,
        });
      }
      await renderCampaignsEventsPage(container, {
        type: "success",
        message: "営業日とイベントを保存しました。",
      });
    } catch (error) {
      saveButton.disabled = false;
      showAlert(messageRegion, error.message || "営業日とイベントを保存できませんでした。");
    }
  });
  actions.append(saveButton);
  section.append(header, messageRegion, wrapper, actions);
  return section;
}

export async function renderCampaignsEventsPage(container, notice = null) {
  const version = ++renderVersion;
  const targetMonth = getState().targetMonth;
  container.replaceChildren(createLoading("新商品・イベント設定を読み込んでいます…"));
  let campaigns;
  let businessDays;
  try {
    [campaigns, businessDays] = await Promise.all([
      getAllProductCampaigns(),
      getBusinessDays(targetMonth),
    ]);
  } catch (error) {
    if (version !== renderVersion) return;
    container.replaceChildren(createAlert(error.message || "新商品・イベント設定を読み込めませんでした。"));
    return;
  }
  if (version !== renderVersion || container.dataset.page !== "campaigns") return;

  const page = element("section", "crud-page campaigns-page");
  const noticeRegion = element("div", "page-notice-region");
  const editorHost = element("div", "editor-host");
  const addButton = createButton("新商品を追加", { variant: "primary" });
  addButton.dataset.action = "new-product-campaign";
  addButton.addEventListener("click", () => showCampaignForm(editorHost, null, container));
  page.append(
    createPageHeading(
      "新商品・イベント設定",
      "新商品の販売期間と、営業日ごとのイベント・繁忙度を管理します。",
      addButton,
    ),
    noticeRegion,
  );
  if (notice) noticeRegion.append(createAlert(notice.message, notice.type));

  const campaignSection = element("section", "crud-card");
  const campaignHeader = element("div", "crud-card__header");
  campaignHeader.append(
    element("h2", "crud-card__title", "新商品キャンペーン"),
    element("span", "count-badge", `${campaigns.length}件`),
  );
  campaignSection.append(
    campaignHeader,
    createCampaignTable(campaigns, editorHost, container, noticeRegion),
  );
  page.append(campaignSection, editorHost, createBusinessDaysEditor(businessDays, targetMonth, container));
  container.replaceChildren(page);
}
