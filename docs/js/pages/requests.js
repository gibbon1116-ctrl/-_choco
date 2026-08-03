import {
  addRequest,
  addRequestRange,
  deleteRequest,
  deleteRequestBatch,
  deleteRequests,
  getActiveEmployees,
  getAllShiftTypes,
  getRequests,
  updateRequests,
} from "../db/index.js";
import { getState } from "../state.js";
import { monthLabel } from "../components/monthSelector.js";
import { displayDate, monthDates } from "../utils/calendar.js";
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
let sortState = { key: "date", direction: "asc" };

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

function groupRequests(requests) {
  const sorted = [...requests].sort((left, right) =>
    left.date.localeCompare(right.date) || Number(left.id) - Number(right.id),
  );
  const grouped = new Map();

  for (const request of sorted) {
    const batchId = request.batch_id ?? "";
    const key = batchId ? `batch:${batchId}` : `request:${request.id}`;
    if (!grouped.has(key)) grouped.set(key, { batchId, requests: [] });
    grouped.get(key).requests.push(request);
  }

  return [...grouped.values()].map((group) => ({
    ...group,
    first: group.requests[0].date,
    last: group.requests.at(-1).date,
    count: group.requests.length,
  }));
}

function sortGroups(groups, employeeNames) {
  const requestTypeOrder = new Map(REQUEST_TYPES.map((item, index) => [item.value, index]));
  const priorityOrder = new Map(PRIORITIES.map((item, index) => [item.value, index]));

  return [...groups].sort((left, right) => {
    const leftRequest = left.requests[0];
    const rightRequest = right.requests[0];
    let comparison = 0;

    if (sortState.key === "date") {
      comparison = left.first.localeCompare(right.first);
    } else if (sortState.key === "employee") {
      const leftName = employeeNames.get(leftRequest.employee_id) ?? leftRequest.employee_id;
      const rightName = employeeNames.get(rightRequest.employee_id) ?? rightRequest.employee_id;
      comparison = String(leftName).localeCompare(String(rightName), "ja");
    } else if (sortState.key === "request_type") {
      comparison = (requestTypeOrder.get(leftRequest.request_type) ?? -1)
        - (requestTypeOrder.get(rightRequest.request_type) ?? -1);
    } else if (sortState.key === "shift_code") {
      comparison = String(leftRequest.shift_code ?? "").localeCompare(
        String(rightRequest.shift_code ?? ""),
      );
    } else if (sortState.key === "priority") {
      comparison = (priorityOrder.get(leftRequest.priority) ?? -1)
        - (priorityOrder.get(rightRequest.priority) ?? -1);
    }

    if (comparison) {
      return sortState.direction === "desc" ? -comparison : comparison;
    }
    return left.first.localeCompare(right.first)
      || Number(leftRequest.id) - Number(rightRequest.id);
  });
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

function createRequestsTable(requests, employees, shifts, container, noticeRegion, targetMonth) {
  if (!requests.length) {
    return element("p", "empty-state", "希望はまだ登録されていません。");
  }
  const employeeNames = new Map(employees.map((item) => [item.employee_id, item.name]));
  const shiftNames = new Map(shifts.map((item) => [item.shift_code, item.shift_name]));
  const groups = groupRequests(requests);
  const selectedIds = new Set();
  const expandedBatchIds = new Set();
  const allIds = requests.map((request) => Number(request.id));
  const host = element("div");
  const editorHost = element("div", "editor-host");
  const bulkBar = element("div", "request-bulk-bar");
  const bulkCount = element("span", "request-bulk-bar__count");
  const bulkActions = element("div", "table-actions__inner");
  const bulkEditButton = createButton("まとめて編集", { variant: "secondary" });
  bulkEditButton.dataset.action = "bulk-edit-requests";
  const bulkDeleteButton = createButton("まとめて削除", { variant: "danger" });
  bulkDeleteButton.dataset.action = "bulk-delete-requests";
  bulkActions.append(bulkEditButton, bulkDeleteButton);
  bulkBar.append(bulkCount, bulkActions);
  const wrapper = element("div", "app-table-wrap");
  const table = element("table", "app-table request-table");
  const selectionControls = [];
  let selectAllInput;

  const requestValues = (request) => {
    const shiftLabel = shiftNames.get(request.shift_code) ?? request.shift_code ?? "—";
    return [
      employeeNames.get(request.employee_id) ?? request.employee_id,
      REQUEST_TYPE_LABELS[request.request_type] ?? "不明",
      request.shift_code ? `${shiftLabel}（${request.shift_code}）` : "—",
      PRIORITY_LABELS[request.priority] ?? request.priority,
      request.note || "—",
    ];
  };

  const updateSelectionUi = () => {
    const selectedCount = selectedIds.size;
    bulkCount.textContent = selectedCount
      ? `${selectedCount}件を選択中`
      : "希望を選択すると一括操作できます。";
    bulkEditButton.disabled = selectedCount === 0;
    bulkDeleteButton.disabled = selectedCount === 0;

    if (selectAllInput) {
      selectAllInput.checked = selectedCount === allIds.length;
      selectAllInput.indeterminate = selectedCount > 0 && selectedCount < allIds.length;
    }
    for (const { input, ids } of selectionControls) {
      const count = ids.filter((id) => selectedIds.has(id)).length;
      input.checked = count === ids.length;
      input.indeterminate = count > 0 && count < ids.length;
    }
  };

  const addSelectionCheckbox = (cell, ids, ariaLabel) => {
    const checkbox = createCheckbox({ label: "", name: "request_selection" });
    checkbox.input.setAttribute("aria-label", ariaLabel);
    checkbox.input.addEventListener("change", () => {
      for (const id of ids) {
        if (checkbox.input.checked) selectedIds.add(id);
        else selectedIds.delete(id);
      }
      updateSelectionUi();
    });
    selectionControls.push({ input: checkbox.input, ids });
    cell.append(checkbox.wrapper);
  };

  const createDeleteButton = (request) => {
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
    return deleteButton;
  };

  const renderTable = () => {
    selectionControls.length = 0;
    const head = element("thead");
    const headerRow = element("tr");
    const selectionHeader = element("th", "request-table__select");
    const selectAll = createCheckbox({ label: "", name: "request_select_all" });
    selectAllInput = selectAll.input;
    selectAllInput.setAttribute("aria-label", "すべて選択");
    selectAllInput.addEventListener("change", () => {
      for (const id of allIds) {
        if (selectAllInput.checked) selectedIds.add(id);
        else selectedIds.delete(id);
      }
      updateSelectionUi();
    });
    selectionHeader.append(selectAll.wrapper);
    headerRow.append(selectionHeader);

    const headers = [
      { label: "日付", key: "date" },
      { label: "職員", key: "employee" },
      { label: "希望種別", key: "request_type" },
      { label: "勤務区分", key: "shift_code" },
      { label: "優先度", key: "priority" },
    ];
    for (const { label, key } of headers) {
      const header = element("th");
      const active = sortState.key === key;
      header.setAttribute(
        "aria-sort",
        active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none",
      );
      const symbol = active ? (sortState.direction === "asc" ? "▲" : "▼") : "";
      const sortButton = element("button", "app-table__sort", `${label}${symbol ? ` ${symbol}` : ""}`);
      sortButton.type = "button";
      sortButton.dataset.sortKey = key;
      sortButton.addEventListener("click", () => {
        sortState = sortState.key === key
          ? { key, direction: sortState.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "asc" };
        renderTable();
      });
      header.append(sortButton);
      headerRow.append(header);
    }
    headerRow.append(element("th", "", "備考"), element("th", "", "操作"));
    head.append(headerRow);

    const body = element("tbody");
    for (const group of sortGroups(groups, employeeNames)) {
      const firstRequest = group.requests[0];
      const groupIds = group.requests.map((request) => Number(request.id));

      if (group.count === 1) {
        const row = element("tr");
        const selectionCell = element("td", "request-table__select");
        addSelectionCheckbox(
          selectionCell,
          groupIds,
          `${displayDate(firstRequest.date)}の希望を選択`,
        );
        row.append(selectionCell, element("td", "table-key", displayDate(firstRequest.date)));
        for (const value of requestValues(firstRequest)) row.append(element("td", "", String(value)));
        const actionCell = element("td", "table-actions");
        actionCell.append(createDeleteButton(firstRequest));
        row.append(actionCell);
        body.append(row);
        continue;
      }

      const row = element("tr", "request-table__group");
      const selectionCell = element("td", "request-table__select");
      addSelectionCheckbox(
        selectionCell,
        groupIds,
        `${displayDate(group.first)} 〜 ${displayDate(group.last)} の希望${group.count}件を選択`,
      );
      row.append(selectionCell);
      const dateCell = element("td", "table-key");
      dateCell.append(
        element("span", "", `${displayDate(group.first)} 〜 ${displayDate(group.last)}`),
        element("span", "count-badge", `${group.count}日`),
      );
      row.append(dateCell);
      for (const value of requestValues(firstRequest)) row.append(element("td", "", String(value)));

      const actionCell = element("td", "table-actions");
      const actionInner = element("div", "table-actions__inner");
      const isExpanded = expandedBatchIds.has(group.batchId);
      const toggleButton = createButton(isExpanded ? "折りたたむ" : "展開", {
        variant: "secondary",
        className: "app-button--small",
      });
      toggleButton.dataset.action = "toggle-request-group";
      toggleButton.setAttribute("aria-expanded", String(isExpanded));
      const batchDeleteButton = createButton("削除", {
        variant: "danger",
        className: "app-button--small",
      });
      batchDeleteButton.dataset.action = "delete-request-batch";
      const childRows = [];
      toggleButton.addEventListener("click", () => {
        const expanded = !expandedBatchIds.has(group.batchId);
        if (expanded) expandedBatchIds.add(group.batchId);
        else expandedBatchIds.delete(group.batchId);
        for (const childRow of childRows) childRow.hidden = !expanded;
        toggleButton.textContent = expanded ? "折りたたむ" : "展開";
        toggleButton.setAttribute("aria-expanded", String(expanded));
      });
      batchDeleteButton.addEventListener("click", async () => {
        const confirmed = globalThis.confirm?.(
          `${displayDate(group.first)} 〜 ${displayDate(group.last)} の希望${group.count}件をまとめて削除しますか？`,
        ) ?? true;
        if (!confirmed) return;
        batchDeleteButton.disabled = true;
        try {
          await deleteRequestBatch(targetMonth, group.batchId);
          await renderRequestsPage(container, {
            type: "success",
            message: "希望をまとめて削除しました。",
          });
        } catch (error) {
          batchDeleteButton.disabled = false;
          showAlert(noticeRegion, error.message || "希望をまとめて削除できませんでした。");
        }
      });
      actionInner.append(toggleButton, batchDeleteButton);
      actionCell.append(actionInner);
      row.append(actionCell);
      body.append(row);

      for (const request of group.requests) {
        const childRow = element("tr", "request-table__child");
        childRow.hidden = !isExpanded;
        const childSelectionCell = element("td", "request-table__select");
        addSelectionCheckbox(
          childSelectionCell,
          [Number(request.id)],
          `${displayDate(request.date)}の希望を選択`,
        );
        childRow.append(
          childSelectionCell,
          element("td", "table-key", displayDate(request.date)),
        );
        for (let index = 0; index < 5; index += 1) childRow.append(element("td"));
        const childActionCell = element("td", "table-actions");
        childActionCell.append(createDeleteButton(request));
        childRow.append(childActionCell);
        childRows.push(childRow);
        body.append(childRow);
      }
    }
    table.replaceChildren(head, body);
    updateSelectionUi();
  };

  const showBulkEditForm = () => {
    const ids = [...selectedIds];
    const count = ids.length;
    const form = element("form", "crud-form request-bulk-form");
    form.noValidate = true;
    const header = element("div", "crud-form__header");
    const titleGroup = element("div");
    titleGroup.append(
      element("h2", "crud-form__title", `選択した${count}件をまとめて編集`),
      element(
        "p",
        "crud-form__caption",
        "変更したい項目だけを選びます。「変更しない」のままの項目はそのまま残ります。",
      ),
    );
    header.append(titleGroup);
    const messageRegion = element("div", "form-message-region");
    const grid = element("div", "form-grid form-grid--three");
    const noChangeOption = { value: "", label: "（変更しない）" };
    const requestType = createSelect({
      label: "希望種別",
      name: "bulk_request_type",
      options: [noChangeOption, ...REQUEST_TYPES],
      value: "",
    });
    const shift = createSelect({
      label: "勤務区分",
      name: "bulk_shift_code",
      options: [
        noChangeOption,
        ...selectOptions(shifts, "shift_code", (item) => `${item.shift_name}（${item.shift_code}）`),
      ],
      value: "",
    });
    const priority = createSelect({
      label: "優先度",
      name: "bulk_priority",
      options: [noChangeOption, ...PRIORITIES],
      value: "",
    });
    const noteToggle = createCheckbox({
      label: "備考を変更する",
      name: "bulk_change_note",
    });
    const note = createTextArea({
      label: "備考",
      name: "bulk_note",
      value: "",
      rows: 2,
      wide: true,
    });
    note.input.disabled = true;
    noteToggle.input.addEventListener("change", () => {
      note.input.disabled = !noteToggle.input.checked;
    });

    let editableShift = "";
    shift.input.addEventListener("change", () => {
      if (!shift.input.disabled) editableShift = shift.input.value;
    });
    const syncShiftControl = () => {
      const isOff = requestType.input.value === "off";
      if (isOff) {
        if (!shift.input.disabled) editableShift = shift.input.value;
        shift.input.value = "O";
      } else if (shift.input.disabled) {
        shift.input.value = editableShift;
      }
      shift.input.disabled = isOff;
    };
    requestType.input.addEventListener("change", syncShiftControl);
    syncShiftControl();

    grid.append(
      requestType.wrapper,
      shift.wrapper,
      priority.wrapper,
      noteToggle.wrapper,
      note.wrapper,
    );
    const actions = element("div", "form-actions");
    const applyButton = createButton(`選択した${count}件に適用`, { variant: "primary" });
    applyButton.type = "submit";
    const cancelButton = createButton("キャンセル", { variant: "secondary" });
    cancelButton.addEventListener("click", () => editorHost.replaceChildren());
    actions.append(applyButton, cancelButton);
    form.append(header, messageRegion, grid, actions);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const changes = {};
      if (requestType.input.value) changes.request_type = requestType.input.value;
      if (requestType.input.value === "off") changes.shift_code = "O";
      else if (shift.input.value) changes.shift_code = shift.input.value;
      if (priority.input.value) changes.priority = priority.input.value;
      if (noteToggle.input.checked) changes.note = note.input.value;
      if (!Object.keys(changes).length) {
        showAlert(messageRegion, "変更する項目を1つ以上選んでください。");
        return;
      }

      applyButton.disabled = true;
      try {
        await updateRequests(ids, changes);
        await renderRequestsPage(container, {
          type: "success",
          message: "選択した希望を更新しました。",
        });
      } catch (error) {
        applyButton.disabled = false;
        showAlert(messageRegion, error.message || "選択した希望を更新できませんでした。");
      }
    });

    editorHost.replaceChildren(form);
    editorHost.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  bulkEditButton.addEventListener("click", showBulkEditForm);
  bulkDeleteButton.addEventListener("click", async () => {
    const count = selectedIds.size;
    const confirmed = globalThis.confirm?.(`選択した${count}件の希望を削除しますか？`) ?? true;
    if (!confirmed) return;
    bulkDeleteButton.disabled = true;
    try {
      await deleteRequests([...selectedIds]);
      await renderRequestsPage(container, {
        type: "success",
        message: "選択した希望を削除しました。",
      });
    } catch (error) {
      bulkDeleteButton.disabled = false;
      showAlert(noticeRegion, error.message || "選択した希望を削除できませんでした。");
    }
  });

  renderTable();
  wrapper.append(table);
  host.append(editorHost, bulkBar, wrapper);
  return host;
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
  listSection.append(
    listHeader,
    createRequestsTable(requests, employees, shifts, container, noticeRegion, targetMonth),
  );

  const forms = element("div", "request-form-grid");
  forms.append(
    createRequestForm({ mode: "single", employees, shifts, targetMonth, container }),
    createRequestForm({ mode: "range", employees, shifts, targetMonth, container }),
  );
  page.append(listSection, forms);
  container.replaceChildren(page);
}
