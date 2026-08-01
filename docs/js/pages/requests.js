import {
  addRequest,
  addRequestRange,
  deleteRequest,
  getActiveEmployees,
  getAllShiftTypes,
  getRequests,
} from "../db/index.js";
import { getState } from "../state.js";
import { monthLabel } from "../components/monthSelector.js";
import { displayDate, monthDates } from "../utils/calendar.js";
import {
  createAlert,
  createButton,
  createField,
  createLoading,
  createPageHeading,
  createSelect,
  createTextArea,
  element,
  showAlert,
} from "./pageUtils.js";

const REQUEST_TYPES = Object.freeze([
  { value: "off", label: "希望休" },
  { value: "avoid", label: "避けたい勤務" },
  { value: "prefer", label: "希望勤務" },
  { value: "fixed", label: "勤務指定" },
]);

const PRIORITIES = Object.freeze([
  { value: "soft", label: "できる限り" },
  { value: "hard", label: "必須" },
]);

const REQUEST_TYPE_LABELS = Object.freeze(Object.fromEntries(
  REQUEST_TYPES.map(({ value, label }) => [value, label]),
));
const PRIORITY_LABELS = Object.freeze(Object.fromEntries(
  PRIORITIES.map(({ value, label }) => [value, label]),
));

let renderVersion = 0;

function selectOptions(records, valueKey, label) {
  return records.map((record) => ({
    value: record[valueKey],
    label: label(record),
  }));
}

function createRequestControls(employees, shifts, dates, mode) {
  const controls = {};
  const grid = element("div", "form-grid form-grid--three");
  const employee = createSelect({
    label: "職員",
    name: `${mode}_employee_id`,
    options: selectOptions(employees, "employee_id", (item) => `${item.name}（${item.employee_id}）`),
    value: employees[0]?.employee_id ?? "",
  });
  controls.employee_id = employee.input;
  grid.append(employee.wrapper);

  const start = createField({
    label: mode === "single" ? "日付" : "開始日",
    name: `${mode}_start_date`,
    type: "date",
    value: dates[0],
    min: dates[0],
    max: dates.at(-1),
  });
  controls.start_date = start.input;
  grid.append(start.wrapper);

  if (mode === "range") {
    const end = createField({
      label: "終了日",
      name: `${mode}_end_date`,
      type: "date",
      value: dates[0],
      min: dates[0],
      max: dates.at(-1),
    });
    controls.end_date = end.input;
    grid.append(end.wrapper);
  }

  const requestType = createSelect({
    label: "希望種別",
    name: `${mode}_request_type`,
    options: REQUEST_TYPES,
    value: "off",
  });
  controls.request_type = requestType.input;
  grid.append(requestType.wrapper);

  const shift = createSelect({
    label: "勤務区分",
    name: `${mode}_shift_code`,
    options: selectOptions(shifts, "shift_code", (item) => `${item.shift_name}（${item.shift_code}）`),
    value: shifts.some((item) => item.shift_code === "O") ? "O" : shifts[0]?.shift_code ?? "",
    help: "希望休を選ぶと、休み区分 O として登録されます。",
  });
  controls.shift_code = shift.input;
  grid.append(shift.wrapper);

  const priority = createSelect({
    label: "優先度",
    name: `${mode}_priority`,
    options: PRIORITIES,
    value: "soft",
  });
  controls.priority = priority.input;
  grid.append(priority.wrapper);

  const note = createTextArea({
    label: "備考",
    name: `${mode}_note`,
    value: "",
    rows: 2,
    wide: true,
  });
  controls.note = note.input;
  grid.append(note.wrapper);

  const syncShiftControl = () => {
    const isOff = controls.request_type.value === "off";
    if (isOff && shifts.some((item) => item.shift_code === "O")) {
      controls.shift_code.value = "O";
    }
    controls.shift_code.disabled = isOff;
  };
  controls.request_type.addEventListener("change", syncShiftControl);
  syncShiftControl();

  return { controls, grid };
}

function requestData(controls, targetMonth) {
  return {
    target_month: targetMonth,
    employee_id: controls.employee_id.value,
    request_type: controls.request_type.value,
    shift_code: controls.request_type.value === "off" ? "O" : controls.shift_code.value,
    priority: controls.priority.value,
    note: controls.note.value,
  };
}

function createRequestForm({ mode, employees, shifts, targetMonth, container }) {
  const isRange = mode === "range";
  const form = element("form", "crud-form request-form");
  form.noValidate = true;
  const header = element("div", "crud-form__header");
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", "crud-form__title", isRange ? "期間で一括追加" : "1日分を追加"),
    element(
      "p",
      "crud-form__caption",
      isRange
        ? "開始日と終了日の両方を含む、期間内の各日へ希望を追加します。"
        : "指定した日付へ希望を1件追加します。",
    ),
  );
  header.append(titleGroup);
  const messageRegion = element("div", "form-message-region");
  const dates = monthDates(targetMonth);
  const { controls, grid } = createRequestControls(employees, shifts, dates, mode);
  const actions = element("div", "form-actions");
  const submitButton = createButton(isRange ? "期間の希望を追加" : "希望を1件追加", {
    variant: "primary",
  });
  submitButton.type = "submit";
  submitButton.dataset.action = isRange ? "add-request-range" : "add-request";
  submitButton.disabled = !employees.length || !shifts.length;
  actions.append(submitButton);
  form.append(header, messageRegion, grid, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!controls.employee_id.value) {
      showAlert(messageRegion, "勤務対象の職員を選択してください。");
      return;
    }
    if (!controls.start_date.value) {
      showAlert(messageRegion, isRange ? "開始日を指定してください。" : "日付を指定してください。");
      return;
    }
    const data = requestData(controls, targetMonth);
    submitButton.disabled = true;
    try {
      let count = 1;
      if (isRange) {
        if (!controls.end_date.value) {
          showAlert(messageRegion, "終了日を指定してください。");
          submitButton.disabled = false;
          return;
        }
        count = await addRequestRange(data, controls.start_date.value, controls.end_date.value);
      } else {
        if (!controls.start_date.value.startsWith(`${targetMonth}-`)) {
          throw new Error("日付は対象年月内で指定してください。");
        }
        await addRequest({ ...data, date: controls.start_date.value });
      }
      await renderRequestsPage(container, {
        type: "success",
        message: `希望を${count}件追加しました。`,
      });
    } catch (error) {
      submitButton.disabled = false;
      showAlert(messageRegion, error.message || "希望を追加できませんでした。");
    }
  });

  return form;
}

function createRequestsTable(requests, employees, shifts, container, noticeRegion) {
  if (!requests.length) {
    return element("p", "empty-state", "希望はまだ登録されていません。");
  }
  const employeeNames = new Map(employees.map((item) => [item.employee_id, item.name]));
  const shiftNames = new Map(shifts.map((item) => [item.shift_code, item.shift_name]));
  const sorted = [...requests].sort((left, right) =>
    left.date.localeCompare(right.date) || Number(left.id) - Number(right.id),
  );
  const wrapper = element("div", "app-table-wrap");
  const table = element("table", "app-table request-table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["日付", "職員", "希望種別", "勤務区分", "優先度", "備考", "操作"]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);
  const body = element("tbody");

  for (const request of sorted) {
    const row = element("tr");
    const shiftLabel = shiftNames.get(request.shift_code) ?? request.shift_code ?? "—";
    const values = [
      displayDate(request.date),
      employeeNames.get(request.employee_id) ?? request.employee_id,
      REQUEST_TYPE_LABELS[request.request_type] ?? "不明",
      request.shift_code ? `${shiftLabel}（${request.shift_code}）` : "—",
      PRIORITY_LABELS[request.priority] ?? request.priority,
      request.note || "—",
    ];
    values.forEach((value, index) => row.append(element("td", index === 0 ? "table-key" : "", String(value))));

    const actionCell = element("td", "table-actions");
    const deleteButton = createButton("削除", { variant: "danger", className: "app-button--small" });
    deleteButton.dataset.action = "delete-request";
    deleteButton.dataset.requestId = String(request.id);
    deleteButton.addEventListener("click", async () => {
      const confirmed = globalThis.confirm?.(
        `${displayDate(request.date)}の希望を削除しますか？`,
      ) ?? true;
      if (!confirmed) return;
      deleteButton.disabled = true;
      try {
        await deleteRequest(request.id);
        await renderRequestsPage(container, { type: "success", message: "希望を削除しました。" });
      } catch (error) {
        deleteButton.disabled = false;
        showAlert(noticeRegion, error.message || "希望を削除できませんでした。");
      }
    });
    actionCell.append(deleteButton);
    row.append(actionCell);
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

export async function renderRequestsPage(container, notice = null) {
  const version = ++renderVersion;
  const targetMonth = getState().targetMonth;
  container.replaceChildren(createLoading("希望を読み込んでいます…"));

  let requests;
  let employees;
  let shifts;
  try {
    [requests, employees, shifts] = await Promise.all([
      getRequests(targetMonth),
      getActiveEmployees(),
      getAllShiftTypes(),
    ]);
  } catch (error) {
    if (version !== renderVersion) return;
    container.replaceChildren(createAlert(error.message || "希望を読み込めませんでした。"));
    return;
  }
  if (version !== renderVersion || container.dataset.page !== "requests") return;

  const page = element("section", "crud-page requests-page");
  const noticeRegion = element("div", "page-notice-region");
  page.append(
    createPageHeading(
      "希望休・勤務希望",
      "「必須」は必ず守る条件、「できる限り」は可能な範囲で考慮する条件です。",
    ),
    noticeRegion,
  );
  if (notice) noticeRegion.append(createAlert(notice.message, notice.type));
  if (!employees.length) {
    noticeRegion.append(createAlert("勤務対象の職員が登録されていません。職員マスタで登録してください。", "error"));
  }

  const listSection = element("section", "crud-card");
  const listHeader = element("div", "crud-card__header");
  listHeader.append(
    element("h2", "crud-card__title", `${monthLabel(targetMonth)}の希望一覧`),
    element("span", "count-badge", `${requests.length}件`),
  );
  listSection.append(listHeader, createRequestsTable(requests, employees, shifts, container, noticeRegion));

  const forms = element("div", "request-form-grid");
  forms.append(
    createRequestForm({ mode: "single", employees, shifts, targetMonth, container }),
    createRequestForm({ mode: "range", employees, shifts, targetMonth, container }),
  );
  page.append(listSection, forms);
  container.replaceChildren(page);
}
