import {
  deleteStaffRelation,
  getActiveEmployees,
  getAllStaffRelations,
  upsertStaffRelation,
} from "../db/index.js";
import { RELATION_LABELS } from "../utils/restaurantSkills.js";
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

const PRIORITY_LABELS = Object.freeze({ hard: "必須", soft: "できる限り" });
const RELATION_OPTIONS = Object.freeze(
  Object.entries(RELATION_LABELS).map(([value, label]) => ({ value, label })),
);
const PRIORITY_OPTIONS = Object.freeze(
  Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })),
);

let renderVersion = 0;

function employeeOptions(employees) {
  return employees.map((employee) => ({
    value: employee.employee_id,
    label: `${employee.name}（${employee.employee_id}）`,
  }));
}

function addCell(row, value, className = "") {
  row.append(element("td", className, String(value ?? "")));
}

function createRelationsTable(relations, employees, editorHost, container, noticeRegion) {
  if (!relations.length) {
    return element("p", "empty-state", "スタッフ配置条件はまだ登録されていません。");
  }
  const names = new Map(employees.map((employee) => [employee.employee_id, employee.name]));
  const wrapper = element("div", "app-table-wrap");
  const table = element("table", "app-table relation-table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["スタッフ1", "スタッフ2", "配置ルール", "優先度", "重み", "状態", "管理者メモ", "操作"]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);
  const body = element("tbody");

  for (const relation of relations) {
    const row = element("tr");
    addCell(row, names.get(relation.employee_id_1) ?? relation.employee_id_1, "table-key");
    addCell(row, names.get(relation.employee_id_2) ?? relation.employee_id_2);
    addCell(row, RELATION_LABELS[relation.relation_type] ?? relation.relation_type);
    addCell(row, PRIORITY_LABELS[relation.priority] ?? relation.priority);
    addCell(row, relation.weight);
    addCell(row, relation.active ? "有効" : "無効");
    addCell(row, relation.note || "—");

    const actionCell = element("td", "table-actions");
    const buttons = element("div", "table-actions__inner");
    const editButton = createButton("編集", { className: "app-button--small" });
    editButton.dataset.action = "edit-staff-relation";
    editButton.dataset.relationId = String(relation.id);
    editButton.addEventListener("click", () => {
      showRelationForm(editorHost, employees, relation, container);
    });
    const deleteButton = createButton("削除", {
      variant: "danger",
      className: "app-button--small",
    });
    deleteButton.dataset.action = "delete-staff-relation";
    deleteButton.dataset.relationId = String(relation.id);
    deleteButton.addEventListener("click", async () => {
      const confirmed = globalThis.confirm?.(
        `${names.get(relation.employee_id_1) ?? relation.employee_id_1}と${names.get(relation.employee_id_2) ?? relation.employee_id_2}の配置条件を削除しますか？`,
      ) ?? true;
      if (!confirmed) return;
      deleteButton.disabled = true;
      try {
        await deleteStaffRelation(relation.id);
        await renderStaffRelationsPage(container, {
          type: "success",
          message: "配置条件を削除しました。",
        });
      } catch (error) {
        deleteButton.disabled = false;
        showAlert(noticeRegion, error.message || "配置条件を削除できませんでした。");
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

function showRelationForm(editorHost, employees, relation, container) {
  const current = relation ?? {
    employee_id_1: employees[0]?.employee_id ?? "",
    employee_id_2: employees[1]?.employee_id ?? "",
    relation_type: "prefer_together",
    priority: "hard",
    weight: 50,
    active: true,
    note: "",
  };
  const form = element("form", "crud-form relation-form");
  form.noValidate = true;
  const header = element("div", "crud-form__header");
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", "crud-form__title", relation ? "配置条件を編集" : "配置条件を追加"),
    element("p", "crud-form__caption", "同じスタッフを両方に指定することはできません。"),
  );
  header.append(titleGroup);
  const messageRegion = element("div", "form-message-region");
  const section = element("div", "form-section");
  const grid = element("div", "form-grid form-grid--three");
  const e1 = createSelect({
    label: "スタッフ1",
    name: "employee_id_1",
    options: employeeOptions(employees),
    value: current.employee_id_1,
  });
  const e2 = createSelect({
    label: "スタッフ2",
    name: "employee_id_2",
    options: employeeOptions(employees),
    value: current.employee_id_2,
  });
  const relationType = createSelect({
    label: "配置ルール",
    name: "relation_type",
    options: RELATION_OPTIONS,
    value: current.relation_type,
  });
  const priority = createSelect({
    label: "優先度",
    name: "priority",
    options: PRIORITY_OPTIONS,
    value: current.priority === "soft" ? "soft" : "hard",
  });
  const weight = createField({
    label: "重み",
    name: "weight",
    type: "number",
    value: Number(current.weight ?? 50),
    min: 1,
    max: 5000,
    inputMode: "numeric",
    help: "値が大きいほど、できる限り条件を強く評価します。",
  });
  const active = createCheckbox({
    label: "この配置条件を有効にする",
    name: "active",
    checked: current.active,
  });
  const activeWrap = element("div", "check-field-wrap");
  activeWrap.append(active.wrapper);
  grid.append(
    e1.wrapper,
    e2.wrapper,
    relationType.wrapper,
    priority.wrapper,
    weight.wrapper,
    activeWrap,
  );
  const note = createTextArea({
    label: "管理者メモ",
    name: "note",
    value: current.note ?? "",
    rows: 2,
    wide: true,
  });
  grid.append(note.wrapper);
  section.append(grid);

  const actions = element("div", "form-actions");
  const cancelButton = createButton("キャンセル");
  cancelButton.addEventListener("click", () => editorHost.replaceChildren());
  const saveButton = createButton(relation ? "変更を保存" : "配置条件を追加", { variant: "primary" });
  saveButton.type = "submit";
  saveButton.dataset.action = "save-staff-relation";
  actions.append(cancelButton, saveButton);
  form.append(header, messageRegion, section, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (e1.input.value === e2.input.value) {
      showAlert(messageRegion, "同じスタッフ同士は登録できません。");
      return;
    }
    const weightValue = Number(weight.input.value);
    if (!Number.isInteger(weightValue) || weightValue < 1 || weightValue > 5000) {
      showAlert(messageRegion, "重みは1〜5000の整数で入力してください。");
      return;
    }

    saveButton.disabled = true;
    try {
      await upsertStaffRelation({
        ...(relation?.id ? { id: relation.id } : {}),
        employee_id_1: e1.input.value,
        employee_id_2: e2.input.value,
        relation_type: relationType.input.value,
        priority: priority.input.value,
        weight: weightValue,
        active: active.input.checked,
        note: note.input.value,
      });
      await renderStaffRelationsPage(container, {
        type: "success",
        message: relation ? "配置条件を更新しました。" : "配置条件を追加しました。",
      });
    } catch (error) {
      saveButton.disabled = false;
      showAlert(messageRegion, error.message || "配置条件を保存できませんでした。");
    }
  });

  editorHost.replaceChildren(form);
  editorHost.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

export async function renderStaffRelationsPage(container, notice = null) {
  const version = ++renderVersion;
  container.replaceChildren(createLoading("スタッフ配置条件を読み込んでいます…"));
  let employees;
  let relations;
  try {
    [employees, relations] = await Promise.all([
      getActiveEmployees(),
      getAllStaffRelations(),
    ]);
  } catch (error) {
    if (version !== renderVersion) return;
    container.replaceChildren(createAlert(error.message || "スタッフ配置条件を読み込めませんでした。"));
    return;
  }
  if (version !== renderVersion || container.dataset.page !== "relations") return;

  const page = element("section", "crud-page relations-page");
  const noticeRegion = element("div", "page-notice-region");
  const editorHost = element("div", "editor-host");
  const addButton = createButton("配置条件を追加", { variant: "primary" });
  addButton.dataset.action = "new-staff-relation";
  addButton.disabled = employees.length < 2;
  addButton.addEventListener("click", () => showRelationForm(editorHost, employees, null, container));
  page.append(
    createPageHeading(
      "スタッフ配置相性設定",
      "管理者向け情報です。通常配布用の勤務表には出力されません。",
      addButton,
    ),
    noticeRegion,
  );
  if (notice) noticeRegion.append(createAlert(notice.message, notice.type));
  if (employees.length < 2) {
    noticeRegion.append(createAlert("先に勤務対象の職員を2人以上登録してください。", "error"));
  }

  const listSection = element("section", "crud-card");
  const listHeader = element("div", "crud-card__header");
  listHeader.append(
    element("h2", "crud-card__title", "登録済みの配置条件"),
    element("span", "count-badge", `${relations.length}件`),
  );
  listSection.append(
    listHeader,
    createRelationsTable(relations, employees, editorHost, container, noticeRegion),
  );
  page.append(listSection, editorHost);
  container.replaceChildren(page);
}
