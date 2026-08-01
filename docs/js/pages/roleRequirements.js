import {
  deleteRoleRequirement,
  getAllShiftTypes,
  getRoleRequirements,
  upsertRoleRequirement,
} from "../db/index.js";
import { getState } from "../state.js";
import { monthLabel } from "../components/monthSelector.js";
import { displayDate, monthDates } from "../utils/calendar.js";
import { ROLE_LABELS } from "../utils/restaurantSkills.js";
import {
  createAlert,
  createButton,
  createField,
  createLoading,
  createPageHeading,
  createSelect,
  element,
  showAlert,
} from "./pageUtils.js";

const PRIORITY_LABELS = Object.freeze({ hard: "必須", soft: "できる限り" });
const ROLE_OPTIONS = Object.freeze(
  Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
);
const PRIORITY_OPTIONS = Object.freeze(
  Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })),
);

let renderVersion = 0;

function shiftOptions(shifts) {
  return shifts.map((shift) => ({
    value: shift.shift_code,
    label: `${shift.shift_name}（${shift.shift_code}）`,
  }));
}

function addCell(row, value, className = "") {
  row.append(element("td", className, String(value ?? "")));
}

function createRoleRequirementsTable(rows, shifts, editorHost, container, noticeRegion) {
  if (!rows.length) {
    return element("p", "empty-state", "役割別必要人数はまだ登録されていません。");
  }
  const shiftNames = new Map(shifts.map((shift) => [shift.shift_code, shift.shift_name]));
  const sorted = [...rows].sort((left, right) =>
    left.date.localeCompare(right.date)
      || left.shift_code.localeCompare(right.shift_code)
      || left.role_code.localeCompare(right.role_code),
  );
  const wrapper = element("div", "app-table-wrap role-requirements-table-wrap");
  const table = element("table", "app-table role-requirements-table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["日付", "勤務区分", "役割", "必要人数", "優先度", "操作"]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);
  const body = element("tbody");

  for (const requirement of sorted) {
    const row = element("tr");
    addCell(row, displayDate(requirement.date), "table-key");
    addCell(row, `${shiftNames.get(requirement.shift_code) ?? requirement.shift_code}（${requirement.shift_code}）`);
    addCell(row, ROLE_LABELS[requirement.role_code] ?? requirement.role_code);
    addCell(row, requirement.required_count);
    addCell(row, PRIORITY_LABELS[requirement.priority] ?? requirement.priority);

    const actionCell = element("td", "table-actions");
    const buttons = element("div", "table-actions__inner");
    const editButton = createButton("編集", { className: "app-button--small" });
    editButton.dataset.action = "edit-role-requirement";
    editButton.dataset.requirementId = String(requirement.id);
    editButton.addEventListener("click", () => {
      showRoleRequirementForm(editorHost, shifts, requirement, container);
    });
    const deleteButton = createButton("削除", {
      variant: "danger",
      className: "app-button--small",
    });
    deleteButton.dataset.action = "delete-role-requirement";
    deleteButton.dataset.requirementId = String(requirement.id);
    deleteButton.addEventListener("click", async () => {
      const confirmed = globalThis.confirm?.(
        `${displayDate(requirement.date)}の${ROLE_LABELS[requirement.role_code] ?? requirement.role_code}条件を削除しますか？`,
      ) ?? true;
      if (!confirmed) return;
      deleteButton.disabled = true;
      try {
        await deleteRoleRequirement(requirement.id);
        await renderRoleRequirementsPage(container, {
          type: "success",
          message: "役割条件を削除しました。",
        });
      } catch (error) {
        deleteButton.disabled = false;
        showAlert(noticeRegion, error.message || "役割条件を削除できませんでした。");
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

function showRoleRequirementForm(editorHost, shifts, requirement, container) {
  const targetMonth = getState().targetMonth;
  const dates = monthDates(targetMonth);
  const current = requirement ?? {
    date: dates[0],
    shift_code: shifts[0]?.shift_code ?? "",
    role_code: Object.keys(ROLE_LABELS)[0],
    required_count: 1,
    priority: "hard",
  };
  const form = element("form", "crud-form role-requirement-form");
  form.noValidate = true;
  const header = element("div", "crud-form__header");
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", "crud-form__title", requirement ? "役割条件を編集" : "役割条件を追加・更新"),
    element("p", "crud-form__caption", "同じ日付・勤務区分・役割を保存すると、既存の条件を更新します。"),
  );
  header.append(titleGroup);
  const messageRegion = element("div", "form-message-region");
  const section = element("div", "form-section");
  const grid = element("div", "form-grid form-grid--three");
  const date = createField({
    label: "日付",
    name: "date",
    type: "date",
    value: current.date,
    min: dates[0],
    max: dates.at(-1),
  });
  const shift = createSelect({
    label: "勤務区分",
    name: "shift_code",
    options: shiftOptions(shifts),
    value: current.shift_code,
  });
  const role = createSelect({
    label: "必要な役割",
    name: "role_code",
    options: ROLE_OPTIONS,
    value: current.role_code,
  });
  const count = createField({
    label: "必要人数",
    name: "required_count",
    type: "number",
    value: Number(current.required_count ?? 1),
    min: 0,
    max: 20,
    inputMode: "numeric",
  });
  const priority = createSelect({
    label: "優先度",
    name: "priority",
    options: PRIORITY_OPTIONS,
    value: current.priority === "soft" ? "soft" : "hard",
  });
  grid.append(date.wrapper, shift.wrapper, role.wrapper, count.wrapper, priority.wrapper);
  section.append(grid);

  const actions = element("div", "form-actions");
  const cancelButton = createButton("キャンセル");
  cancelButton.addEventListener("click", () => editorHost.replaceChildren());
  const saveButton = createButton("役割条件を保存", { variant: "primary" });
  saveButton.type = "submit";
  saveButton.dataset.action = "save-role-requirement";
  actions.append(cancelButton, saveButton);
  form.append(header, messageRegion, section, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!date.input.value.startsWith(`${targetMonth}-`)) {
      showAlert(messageRegion, "日付は対象年月内で指定してください。");
      return;
    }
    const requiredCount = Number(count.input.value);
    if (!Number.isInteger(requiredCount) || requiredCount < 0 || requiredCount > 20) {
      showAlert(messageRegion, "必要人数は0〜20の整数で入力してください。");
      return;
    }
    saveButton.disabled = true;
    try {
      await upsertRoleRequirement({
        target_month: targetMonth,
        date: date.input.value,
        shift_code: shift.input.value,
        role_code: role.input.value,
        required_count: requiredCount,
        priority: priority.input.value,
      });
      await renderRoleRequirementsPage(container, {
        type: "success",
        message: "役割条件を保存しました。",
      });
    } catch (error) {
      saveButton.disabled = false;
      showAlert(messageRegion, error.message || "役割条件を保存できませんでした。");
    }
  });

  editorHost.replaceChildren(form);
  editorHost.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

export async function renderRoleRequirementsPage(container, notice = null) {
  const version = ++renderVersion;
  const targetMonth = getState().targetMonth;
  container.replaceChildren(createLoading("役割別必要人数を読み込んでいます…"));
  let shifts;
  let requirements;
  try {
    [shifts, requirements] = await Promise.all([
      getAllShiftTypes(),
      getRoleRequirements(targetMonth),
    ]);
  } catch (error) {
    if (version !== renderVersion) return;
    container.replaceChildren(createAlert(error.message || "役割別必要人数を読み込めませんでした。"));
    return;
  }
  if (version !== renderVersion || container.dataset.page !== "roles") return;

  const workShifts = shifts.filter((shift) => Boolean(shift.is_work));
  const page = element("section", "crud-page role-requirements-page");
  const noticeRegion = element("div", "page-notice-region");
  const editorHost = element("div", "editor-host");
  const addButton = createButton("役割条件を追加", { variant: "primary" });
  addButton.dataset.action = "new-role-requirement";
  addButton.disabled = !workShifts.length;
  addButton.addEventListener("click", () => showRoleRequirementForm(editorHost, workShifts, null, container));
  page.append(
    createPageHeading(
      "役割別必要人数",
      "日付・勤務区分ごとに、英語・レジ・開店・閉店などの必要人数を設定します。",
      addButton,
    ),
    noticeRegion,
  );
  if (notice) noticeRegion.append(createAlert(notice.message, notice.type));
  if (!workShifts.length) {
    noticeRegion.append(createAlert("勤務扱いの勤務区分が登録されていません。", "error"));
  }

  const listSection = element("section", "crud-card");
  const listHeader = element("div", "crud-card__header");
  listHeader.append(
    element("h2", "crud-card__title", `${monthLabel(targetMonth)}の役割条件`),
    element("span", "count-badge", `${requirements.length}件`),
  );
  listSection.append(
    listHeader,
    createRoleRequirementsTable(requirements, workShifts, editorHost, container, noticeRegion),
  );
  page.append(listSection, editorHost);
  container.replaceChildren(page);
}
