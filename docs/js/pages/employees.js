import {
  deleteEmployee,
  getAllEmployees,
  upsertEmployee,
} from "../db/index.js";
import {
  ENGLISH_LEVELS,
  LEVEL_SKILL_FIELDS,
  validateEmployee,
} from "../validation/employeeValidation.js";
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

const DEFAULT_EMPLOYEE = Object.freeze({
  employee_id: "",
  name: "",
  role: "",
  skills: "",
  active: true,
  night_allowed: true,
  max_consecutive_days: 5,
  min_work_days: 0,
  max_work_days: 31,
  note: "",
  english_level: "none",
  can_cashier: false,
  can_open: false,
  can_close: false,
  can_handle_complaints: false,
  can_explain_allergy: false,
  is_new_staff: false,
  can_train_new_staff: false,
  product_skill_ice: 0,
  product_skill_chocolate: 0,
  product_skill_cookie: 0,
  new_product_skill: 0,
  can_manage_cash: false,
  can_hygiene_check: false,
  peak_support_level: 0,
});

const ENGLISH_LABELS = Object.freeze({
  none: "対応不要・対応不可",
  basic: "簡単な接客英語",
  conversational: "通常接客可能",
  fluent: "複雑な説明も可能",
});

const SKILL_LEVEL_LABELS = Object.freeze([
  "未経験",
  "補助できる",
  "一人で対応できる",
  "指導できる",
]);

let renderVersion = 0;

function addCell(row, value, className = "") {
  row.append(element("td", className, String(value ?? "")));
}

function createEmployeeTable(employees, editorHost, container, noticeRegion) {
  if (!employees.length) {
    return element("p", "empty-state", "職員が登録されていません。");
  }

  const wrapper = element("div", "app-table-wrap");
  const table = element("table", "app-table crud-table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["職員ID", "氏名", "役割", "在籍", "夜勤可否", "操作"]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);

  const body = element("tbody");
  for (const employee of employees) {
    const row = element("tr");
    addCell(row, employee.employee_id, "table-key");
    addCell(row, employee.name);
    addCell(row, employee.role || "—");
    addCell(row, yesNo(employee.active));
    addCell(row, yesNo(employee.night_allowed));

    const actions = element("td", "table-actions");
    const actionButtons = element("div", "table-actions__inner");
    const editButton = createButton("編集", { className: "app-button--small" });
    editButton.dataset.action = "edit-employee";
    editButton.dataset.employeeId = employee.employee_id;
    editButton.addEventListener("click", () => {
      showEmployeeForm(editorHost, employee, container);
    });

    const deleteButton = createButton("削除", {
      variant: "danger",
      className: "app-button--small",
    });
    deleteButton.dataset.action = "delete-employee";
    deleteButton.dataset.employeeId = employee.employee_id;
    deleteButton.addEventListener("click", async () => {
      const confirmed = globalThis.confirm?.(
        `${employee.name}（${employee.employee_id}）を削除しますか？\n関連する希望と配置相性設定も削除されます。`,
      ) ?? true;
      if (!confirmed) return;
      deleteButton.disabled = true;
      try {
        await deleteEmployee(employee.employee_id);
        await renderEmployeesPage(container, {
          type: "success",
          message: "職員を削除しました。",
        });
      } catch (error) {
        deleteButton.disabled = false;
        showAlert(noticeRegion, error.message || "職員を削除できませんでした。");
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

function showEmployeeForm(editorHost, existingEmployee, container) {
  const employee = { ...DEFAULT_EMPLOYEE, ...(existingEmployee ?? {}) };
  const isEditing = Boolean(existingEmployee);
  const form = element("form", "crud-form");
  form.noValidate = true;
  form.dataset.form = "employee";
  const controls = {};

  const formHeader = element("div", "crud-form__header");
  const headerCopy = element("div");
  headerCopy.append(
    element("h2", "crud-form__title", isEditing ? "職員を編集" : "職員を新規登録"),
    element(
      "p",
      "crud-form__caption",
      isEditing ? "職員IDは変更できません。" : "職員IDと氏名は必須です。",
    ),
  );
  const closeButton = createButton("閉じる", { className: "app-button--small" });
  closeButton.addEventListener("click", () => editorHost.replaceChildren());
  formHeader.append(headerCopy, closeButton);
  form.append(formHeader);

  const messageRegion = element("div", "form-message-region");
  form.append(messageRegion);

  const addField = (grid, options) => {
    const field = createField(options);
    controls[options.name] = field.input;
    grid.append(field.wrapper);
  };
  const addSelect = (grid, options) => {
    const field = createSelect(options);
    controls[options.name] = field.input;
    grid.append(field.wrapper);
  };
  const addCheckbox = (grid, options) => {
    const field = createCheckbox(options);
    controls[options.name] = field.input;
    grid.append(field.wrapper);
  };

  const basicSection = element("section", "form-section");
  basicSection.append(element("h3", "form-section__title", "基本情報・勤務条件"));
  const basicGrid = element("div", "form-grid form-grid--three");
  addField(basicGrid, {
    label: "職員ID *",
    name: "employee_id",
    value: employee.employee_id,
    readOnly: isEditing,
  });
  addField(basicGrid, { label: "職員名 *", name: "name", value: employee.name });
  addField(basicGrid, { label: "役職・区分", name: "role", value: employee.role });
  addField(basicGrid, {
    label: "保有スキル（自由記述）",
    name: "skills",
    value: employee.skills,
    wide: true,
  });
  addField(basicGrid, {
    label: "最大連続勤務日数",
    name: "max_consecutive_days",
    type: "number",
    value: employee.max_consecutive_days,
    min: 0,
    max: 31,
  });
  addField(basicGrid, {
    label: "月間最低勤務日数",
    name: "min_work_days",
    type: "number",
    value: employee.min_work_days,
    min: 0,
    max: 31,
  });
  addField(basicGrid, {
    label: "月間最大勤務日数",
    name: "max_work_days",
    type: "number",
    value: employee.max_work_days,
    min: 0,
    max: 31,
  });
  const basicChecks = element("div", "check-grid form-field--wide");
  addCheckbox(basicChecks, {
    label: "勤務表作成対象",
    name: "active",
    checked: employee.active,
  });
  addCheckbox(basicChecks, {
    label: "夜勤可能",
    name: "night_allowed",
    checked: employee.night_allowed,
  });
  basicGrid.append(basicChecks);
  const note = createTextArea({
    label: "備考",
    name: "note",
    value: employee.note,
    wide: true,
  });
  controls.note = note.input;
  basicGrid.append(note.wrapper);
  basicSection.append(basicGrid);
  form.append(basicSection);

  const restaurantSection = element("section", "form-section");
  restaurantSection.append(element("h3", "form-section__title", "飲食店向けスキル"));
  const skillGrid = element("div", "form-grid form-grid--four");
  addSelect(skillGrid, {
    label: "英語レベル",
    name: "english_level",
    value: employee.english_level,
    options: ENGLISH_LEVELS.map((value) => ({
      value,
      label: ENGLISH_LABELS[value],
    })),
  });

  const skillLabels = {
    product_skill_ice: "アイス対応",
    product_skill_chocolate: "チョコ対応",
    product_skill_cookie: "クッキー対応",
    new_product_skill: "新商品対応",
    peak_support_level: "ピーク対応力",
  };
  for (const fieldName of LEVEL_SKILL_FIELDS) {
    addSelect(skillGrid, {
      label: skillLabels[fieldName],
      name: fieldName,
      value: employee[fieldName],
      options: SKILL_LEVEL_LABELS.map((label, value) => ({ value, label })),
    });
  }

  const restaurantChecks = element("div", "check-grid check-grid--three form-field--wide");
  const booleanSkills = [
    ["can_cashier", "レジ対応可"],
    ["can_open", "開店作業可"],
    ["can_close", "閉店作業可"],
    ["can_handle_complaints", "クレーム対応可"],
    ["can_explain_allergy", "アレルギー説明可"],
    ["is_new_staff", "新人スタッフ"],
    ["can_train_new_staff", "新人教育可"],
    ["can_manage_cash", "現金管理可"],
    ["can_hygiene_check", "衛生確認可"],
  ];
  for (const [name, label] of booleanSkills) {
    addCheckbox(restaurantChecks, {
      label,
      name,
      checked: employee[name],
    });
  }
  skillGrid.append(restaurantChecks);
  restaurantSection.append(skillGrid);
  form.append(restaurantSection);

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
      employee_id: controls.employee_id.value,
      name: controls.name.value,
      role: controls.role.value,
      skills: controls.skills.value,
      active: controls.active.checked,
      night_allowed: controls.night_allowed.checked,
      max_consecutive_days: controls.max_consecutive_days.value,
      min_work_days: controls.min_work_days.value,
      max_work_days: controls.max_work_days.value,
      note: controls.note.value,
      english_level: controls.english_level.value,
      can_cashier: controls.can_cashier.checked,
      can_open: controls.can_open.checked,
      can_close: controls.can_close.checked,
      can_handle_complaints: controls.can_handle_complaints.checked,
      can_explain_allergy: controls.can_explain_allergy.checked,
      is_new_staff: controls.is_new_staff.checked,
      can_train_new_staff: controls.can_train_new_staff.checked,
      product_skill_ice: controls.product_skill_ice.value,
      product_skill_chocolate: controls.product_skill_chocolate.value,
      product_skill_cookie: controls.product_skill_cookie.value,
      new_product_skill: controls.new_product_skill.value,
      can_manage_cash: controls.can_manage_cash.checked,
      can_hygiene_check: controls.can_hygiene_check.checked,
      peak_support_level: controls.peak_support_level.value,
    };
    const errors = validateEmployee(data);
    if (errors.length) {
      showAlert(messageRegion, errors);
      return;
    }

    saveButton.disabled = true;
    try {
      await upsertEmployee(data);
      await renderEmployeesPage(container, {
        type: "success",
        message: "職員情報を保存しました。",
      });
    } catch (error) {
      saveButton.disabled = false;
      showAlert(messageRegion, error.message || "職員情報を保存できませんでした。");
    }
  });

  editorHost.replaceChildren(form);
  editorHost.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

export async function renderEmployeesPage(container, notice = null) {
  const version = ++renderVersion;
  container.replaceChildren(createLoading("職員情報を読み込んでいます…"));

  let employees;
  try {
    employees = await getAllEmployees();
  } catch (error) {
    if (version !== renderVersion) return;
    container.replaceChildren(createAlert(error.message || "職員情報を読み込めませんでした。"));
    return;
  }
  if (version !== renderVersion || container.dataset.page !== "employees") return;

  const page = element("section", "crud-page");
  const editorHost = element("div", "editor-host");
  const noticeRegion = element("div", "page-notice-region");
  const newButton = createButton("職員を追加", { variant: "primary" });
  newButton.dataset.action = "new-employee";
  newButton.addEventListener("click", () => {
    showEmployeeForm(editorHost, null, container);
  });

  page.append(
    createPageHeading(
      "職員マスタ",
      "職員の勤務条件と飲食店向けスキルを登録します。職員IDは重複できません。",
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
    element("h2", "crud-card__title", "登録職員"),
    element("span", "count-badge", `${employees.length}名`),
  );
  listSection.append(
    listHeader,
    createEmployeeTable(employees, editorHost, container, noticeRegion),
  );
  page.append(listSection, editorHost);
  container.replaceChildren(page);
}
