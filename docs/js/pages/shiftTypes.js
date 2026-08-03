import {
  countShiftTypeUsage,
  deleteShiftType,
  getAllShiftTypes,
  upsertShiftType,
} from "../db/index.js";
import {
  SHIFT_COLOR_PALETTE,
  colorName,
  colorOptionLabel,
  normalizeColor,
} from "../utils/colorPalette.js";
import { validateShiftType } from "../validation/shiftTypeValidation.js";
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
  yesNo,
} from "./pageUtils.js";

const DEFAULT_SHIFT_TYPE = Object.freeze({
  shift_code: "",
  shift_name: "",
  is_work: true,
  start_time: "",
  end_time: "",
  requires_rest_next_day: false,
  color: "FFFFFF",
  note: "",
});

let renderVersion = 0;

function addCell(row, value, className = "") {
  row.append(element("td", className, String(value ?? "")));
}

function createColorCell(shiftType) {
  const cell = element("td");
  const color = normalizeColor(shiftType.color);
  const content = element("span", "color-value");
  const swatch = element("span", "color-swatch");
  swatch.style.backgroundColor = `#${color}`;
  swatch.setAttribute("aria-hidden", "true");
  content.append(swatch, element("span", "", `${colorName(color)}（#${color}）`));
  cell.append(content);
  return cell;
}

function createShiftTable(shiftTypes, editorHost, container, noticeRegion) {
  const wrapper = element("div", "app-table-wrap");
  const table = element("table", "app-table crud-table shift-table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of [
    "コード",
    "勤務区分名",
    "勤務扱い",
    "時間",
    "翌日休み",
    "表示色",
    "操作",
  ]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);

  const body = element("tbody");
  for (const shiftType of shiftTypes) {
    const row = element("tr");
    addCell(row, shiftType.shift_code, "table-key");
    addCell(row, shiftType.shift_name);
    addCell(row, yesNo(shiftType.is_work));
    const time = shiftType.start_time || shiftType.end_time
      ? `${shiftType.start_time || "—"}〜${shiftType.end_time || "—"}`
      : "—";
    addCell(row, time);
    addCell(row, yesNo(shiftType.requires_rest_next_day));
    row.append(createColorCell(shiftType));

    const actions = element("td", "table-actions");
    const actionButtons = element("div", "table-actions__inner");
    const editButton = createButton("編集", { className: "app-button--small" });
    editButton.dataset.action = "edit-shift";
    editButton.dataset.shiftCode = shiftType.shift_code;
    editButton.addEventListener("click", () => {
      showShiftForm(editorHost, shiftType, container);
    });

    const deleteButton = createButton("削除", {
      variant: "danger",
      className: "app-button--small",
    });
    deleteButton.dataset.action = "delete-shift";
    deleteButton.dataset.shiftCode = shiftType.shift_code;
    if (String(shiftType.shift_code).trim().toUpperCase() === "O") {
      deleteButton.disabled = true;
      deleteButton.title = "休み区分 O は削除できません。";
    }
    deleteButton.addEventListener("click", async () => {
      deleteButton.disabled = true;
      try {
        const usage = await countShiftTypeUsage(shiftType.shift_code);
        const usageLines = [
          [usage.requirements, "必要人数"],
          [usage.roleRequirements, "役割別必要人数"],
          [usage.requests, "希望休・勤務希望"],
          [
            usage.scheduleAssignments,
            "作成済み勤務表の割り当て",
            "（休みに変更されます）",
          ],
        ]
          .filter(([count]) => count > 0)
          .map(([count, label, note = ""]) => `・${label} ${count}件${note}`);
        const confirmationMessage = usage.total === 0
          ? `${shiftType.shift_name}（${shiftType.shift_code}）を削除しますか？`
          : `${shiftType.shift_name}（${shiftType.shift_code}）は次のデータで使用中です。\n\n${usageLines.join("\n")}\n\n勤務区分を削除すると、これらもまとめて削除・変更されます。\n元に戻せません。削除しますか？`;
        const confirmed = globalThis.confirm?.(confirmationMessage) ?? true;
        if (!confirmed) {
          deleteButton.disabled = false;
          return;
        }

        if (usage.total === 0) {
          await deleteShiftType(shiftType.shift_code);
        } else {
          await deleteShiftType(shiftType.shift_code, { cascade: true });
        }
        await renderShiftTypesPage(container, {
          type: "success",
          message: usage.total === 0
            ? "勤務区分を削除しました。"
            : `勤務区分を削除し、関連する${usage.total}件のデータを整理しました。`,
        });
      } catch (error) {
        deleteButton.disabled = false;
        showAlert(noticeRegion, error.message || "勤務区分を削除できませんでした。");
      }
    });
    actionButtons.append(editButton, deleteButton);
    actions.append(actionButtons);
    row.append(actions);
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function showShiftForm(editorHost, existingShiftType, container) {
  const shiftType = { ...DEFAULT_SHIFT_TYPE, ...(existingShiftType ?? {}) };
  const isEditing = Boolean(existingShiftType);
  const currentColor = normalizeColor(shiftType.color);
  const paletteValues = Object.values(SHIFT_COLOR_PALETTE);
  const form = element("form", "crud-form");
  form.noValidate = true;
  form.dataset.form = "shift-type";
  const controls = {};

  const formHeader = element("div", "crud-form__header");
  const headerCopy = element("div");
  headerCopy.append(
    element("h2", "crud-form__title", isEditing ? "勤務区分を編集" : "勤務区分を新規登録"),
    element(
      "p",
      "crud-form__caption",
      isEditing ? "勤務区分コードは変更できません。" : "勤務区分コードと名称は必須です。",
    ),
  );
  const closeButton = createButton("閉じる", { className: "app-button--small" });
  closeButton.addEventListener("click", () => editorHost.replaceChildren());
  formHeader.append(headerCopy, closeButton);
  form.append(formHeader);

  const messageRegion = element("div", "form-message-region");
  form.append(messageRegion);

  const grid = element("div", "form-grid form-grid--three");
  const addField = (options) => {
    const field = createField(options);
    controls[options.name] = field.input;
    grid.append(field.wrapper);
  };
  const addCheckbox = (options) => {
    const field = createCheckbox(options);
    controls[options.name] = field.input;
    return field.wrapper;
  };

  addField({
    label: "勤務区分コード *",
    name: "shift_code",
    value: shiftType.shift_code,
    readOnly: isEditing,
    help: "勤務表の保存・計算に使う短い記号です。",
  });
  addField({
    label: "勤務区分名 *",
    name: "shift_name",
    value: shiftType.shift_name,
  });
  const workChecks = element("div", "check-grid");
  workChecks.append(
    addCheckbox({ label: "勤務扱い", name: "is_work", checked: shiftType.is_work }),
    addCheckbox({
      label: "翌日休みが必要",
      name: "requires_rest_next_day",
      checked: shiftType.requires_rest_next_day,
    }),
  );
  grid.append(workChecks);
  addField({
    label: "開始時刻",
    name: "start_time",
    value: shiftType.start_time,
    placeholder: "09:00",
  });
  addField({
    label: "終了時刻",
    name: "end_time",
    value: shiftType.end_time,
    placeholder: "18:00",
  });

  const palette = createSelect({
    label: "色パレット",
    name: "color_palette",
    value: paletteValues.includes(currentColor) ? currentColor : "__custom__",
    options: [
      {
        value: "__custom__",
        label: paletteValues.includes(currentColor)
          ? "任意の色を入力"
          : colorOptionLabel(currentColor),
      },
      ...Object.entries(SHIFT_COLOR_PALETTE).map(([name, value]) => ({
        value,
        label: `${name}（#${value}）`,
      })),
    ],
    help: "20色のパレットから選択できます。",
  });
  controls.color_palette = palette.input;
  grid.append(palette.wrapper);

  addField({
    label: "背景色（6桁hex）",
    name: "color",
    value: currentColor,
    placeholder: "FFFFFF",
    maxLength: 7,
    inputMode: "text",
  });
  const previewField = element("div", "form-field color-preview-field");
  previewField.append(element("span", "form-field__label", "色の確認"));
  const preview = element("span", "color-preview", `#${currentColor}`);
  preview.style.backgroundColor = `#${currentColor}`;
  previewField.append(preview);
  grid.append(previewField);

  const note = createTextArea({
    label: "備考",
    name: "note",
    value: shiftType.note,
    wide: true,
  });
  controls.note = note.input;
  grid.append(note.wrapper);
  form.append(grid);

  const updatePreview = () => {
    const color = normalizeColor(controls.color.value);
    preview.textContent = `#${color}`;
    preview.style.backgroundColor = /^[0-9A-F]{6}$/.test(color)
      ? `#${color}`
      : "transparent";
  };
  controls.color_palette.addEventListener("change", () => {
    if (controls.color_palette.value !== "__custom__") {
      controls.color.value = controls.color_palette.value;
      updatePreview();
    }
  });
  controls.color.addEventListener("input", updatePreview);

  const actions = element("div", "form-actions");
  const cancelButton = createButton("キャンセル");
  cancelButton.addEventListener("click", () => editorHost.replaceChildren());
  const saveButton = createButton("保存", { variant: "primary" });
  saveButton.type = "submit";
  actions.append(cancelButton, saveButton);
  form.append(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = {
      shift_code: controls.shift_code.value,
      shift_name: controls.shift_name.value,
      is_work: controls.is_work.checked,
      start_time: controls.start_time.value,
      end_time: controls.end_time.value,
      requires_rest_next_day: controls.requires_rest_next_day.checked,
      color: controls.color.value,
      note: controls.note.value,
    };
    const errors = validateShiftType(data);
    if (errors.length) {
      showAlert(messageRegion, errors);
      return;
    }

    saveButton.disabled = true;
    try {
      await upsertShiftType(data);
      await renderShiftTypesPage(container, {
        type: "success",
        message: "勤務区分を保存しました。",
      });
    } catch (error) {
      saveButton.disabled = false;
      showAlert(messageRegion, error.message || "勤務区分を保存できませんでした。");
    }
  });

  editorHost.replaceChildren(form);
  editorHost.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

export async function renderShiftTypesPage(container, notice = null) {
  const version = ++renderVersion;
  container.replaceChildren(createLoading("勤務区分を読み込んでいます…"));

  let shiftTypes;
  try {
    shiftTypes = await getAllShiftTypes();
  } catch (error) {
    if (version !== renderVersion) return;
    container.replaceChildren(createAlert(error.message || "勤務区分を読み込めませんでした。"));
    return;
  }
  if (version !== renderVersion || container.dataset.page !== "shifts") return;

  const page = element("section", "crud-page");
  const editorHost = element("div", "editor-host");
  const noticeRegion = element("div", "page-notice-region");
  const newButton = createButton("勤務区分を追加", { variant: "primary" });
  newButton.dataset.action = "new-shift";
  newButton.addEventListener("click", () => {
    showShiftForm(editorHost, null, container);
  });

  page.append(
    createPageHeading(
      "勤務区分マスタ",
      "勤務時間、夜勤明け休み、勤務表とExcelの表示色を管理します。",
      newButton,
    ),
    noticeRegion,
  );
  if (notice) {
    noticeRegion.append(createAlert(notice.message, notice.type));
  }

  const listSection = element("section", "crud-card");
  const listHeader = element("div", "crud-card__header");
  listHeader.append(
    element("h2", "crud-card__title", "登録済み勤務区分"),
    element("span", "count-badge", `${shiftTypes.length}件`),
  );
  listSection.append(
    listHeader,
    createShiftTable(shiftTypes, editorHost, container, noticeRegion),
  );
  page.append(listSection, editorHost);
  container.replaceChildren(page);
}
