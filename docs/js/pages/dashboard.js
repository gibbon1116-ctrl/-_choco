import {
  getAllEmployees,
  getAllShiftTypes,
  getSettings,
  latestSchedule,
} from "../db/index.js";
import { createScheduleTable, createShiftLegend } from "../components/scheduleTable.js";
import { monthLabel } from "../components/monthSelector.js";
import { getState } from "../state.js";
import { runSolver } from "../solver/runSolver.js";
import { blockingIssues, precheck } from "../validation/precheck.js";
import {
  employeeSummary,
  requestViolations,
  shiftSummary,
} from "../reports/summaries.js";
import { restaurantConditionChecks } from "../reports/restaurantChecks.js";
import { buildScheduleViewModel } from "../reports/viewModel.js";
import {
  createAlert,
  createButton,
  createLoading,
  createPageHeading,
  element,
} from "./pageUtils.js";

const pageState = new Map();

function stateFor(targetMonth) {
  if (!pageState.has(targetMonth)) {
    pageState.set(targetMonth, {
      viewMode: "month",
      start: 0,
      employeeId: "all",
      role: "all",
      showRequests: true,
      showSummary: true,
      showSkills: true,
      activeTab: "employees",
    });
  }
  return pageState.get(targetMonth);
}

function appendIssueBanners(region, issues) {
  region.replaceChildren();
  for (const issue of issues) {
    const type = issue.severity === "error"
      ? "error"
      : (issue.severity === "warning" ? "warning" : "success");
    region.append(createAlert(issue.message, type));
  }
}

function createSelectControl(label, value, options, onChange) {
  const wrapper = element("label", "dashboard-control");
  wrapper.append(element("span", "dashboard-control__label", label));
  const select = element("select", "app-select dashboard-control__select");
  for (const item of options) {
    const option = element("option", "", item.label);
    option.value = item.value;
    select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(select);
  return wrapper;
}

function createToggle(label, checked, onChange) {
  const wrapper = element("label", "dashboard-toggle");
  const input = element("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.append(input, element("span", "", label));
  return wrapper;
}

export function scheduleDateRange(dates, viewMode = "month", start = 0) {
  const span = viewMode === "week" ? 7 : (viewMode === "half" ? 15 : dates.length);
  const lastStart = Math.max(0, dates.length - span);
  const normalizedStart = viewMode === "month"
    ? 0
    : Math.min(Math.max(0, Number(start) || 0), lastStart);
  return {
    dates: dates.slice(normalizedStart, normalizedStart + span),
    span,
    start: normalizedStart,
    lastStart,
  };
}

function visibleDates(viewModel, ui) {
  const range = scheduleDateRange(viewModel.dates, ui.viewMode, ui.start);
  ui.start = range.start;
  return range;
}

function dataTable(headers, rows, emptyMessage) {
  if (!rows.length) return element("p", "empty-state", emptyMessage);
  const wrap = element("div", "app-table-wrap dashboard-detail-table");
  const table = element("table", "app-table");
  const headRow = element("tr");
  headers.forEach(({ label }) => headRow.append(element("th", "", label)));
  const head = element("thead");
  head.append(headRow);
  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr");
    headers.forEach(({ key, render }) => tr.append(element(
      "td",
      "",
      String(render ? render(row) : (row[key] ?? "")),
    )));
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

async function createDetails(targetMonth, assignments, settings, employees, shiftTypes, ui, rerender) {
  const tabs = [
    { id: "employees", label: "職員別集計" },
    { id: "shifts", label: "勤務区分別集計" },
    { id: "requests", label: "希望・ルール確認" },
  ];
  if (settings.restaurant_mode) tabs.push({ id: "restaurant", label: "飲食店条件確認" });
  if (!tabs.some((tab) => tab.id === ui.activeTab)) ui.activeTab = "employees";

  const section = element("section", "dashboard-details");
  section.append(element("h2", "dashboard-section-title", "詳細集計"));
  const tabList = element("div", "dashboard-tabs");
  tabList.setAttribute("role", "tablist");
  for (const tab of tabs) {
    const button = createButton(tab.label, {
      variant: ui.activeTab === tab.id ? "primary" : "secondary",
      className: "dashboard-tab",
    });
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(ui.activeTab === tab.id));
    button.addEventListener("click", () => {
      ui.activeTab = tab.id;
      rerender();
    });
    tabList.append(button);
  }
  section.append(tabList);
  const panel = element("div", "dashboard-tab-panel");
  panel.setAttribute("role", "tabpanel");

  if (ui.activeTab === "employees") {
    const rows = await employeeSummary(assignments, { employees });
    panel.append(dataTable([
      { key: "職員名", label: "職員名" },
      { key: "勤務日数", label: "勤務日数" },
      { key: "夜勤回数", label: "夜勤回数" },
      { key: "土日勤務", label: "土日勤務" },
    ], rows, "職員別集計はありません。"));
  } else if (ui.activeTab === "shifts") {
    const rows = await shiftSummary(assignments, { shiftTypes });
    panel.append(dataTable([
      { key: "コード", label: "コード" },
      { key: "勤務区分", label: "勤務区分" },
      { key: "回数", label: "回数" },
    ], rows, "勤務区分別集計はありません。"));
  } else if (ui.activeTab === "requests") {
    const rows = await requestViolations(targetMonth, assignments);
    const employeeNames = new Map(employees.map((employee) => [String(employee.employee_id), employee.name]));
    panel.append(dataTable([
      { label: "職員", render: (row) => employeeNames.get(String(row.employee_id)) ?? row.employee_id },
      { key: "date", label: "日付" },
      { key: "request_type", label: "希望種別" },
      { key: "priority", label: "優先度" },
      { key: "requested_shift", label: "希望" },
      { key: "actual_shift", label: "実際" },
      { key: "note", label: "備考" },
    ], rows, "希望・ルール違反はありません。"));
  } else {
    const rows = await restaurantConditionChecks(targetMonth, assignments);
    panel.append(dataTable([
      { key: "日付", label: "日付" },
      { key: "確認項目", label: "確認項目" },
      { key: "結果", label: "結果" },
      { key: "優先度", label: "優先度" },
      { key: "内容", label: "内容" },
    ], rows, "確認対象の飲食店条件はありません。"));
  }
  section.append(panel);
  return section;
}

async function renderSchedule(section, targetMonth, schedule, settings, employees, shiftTypes, ui, rerender) {
  const assignments = schedule.assignments ?? [];
  const viewModel = await buildScheduleViewModel(targetMonth, assignments);
  const controls = element("div", "dashboard-schedule-controls");
  const modes = element("div", "dashboard-view-modes");
  for (const [value, label] of [["week", "週表示"], ["half", "半月表示"], ["month", "月表示"]]) {
    const button = createButton(label, { variant: ui.viewMode === value ? "primary" : "secondary" });
    button.addEventListener("click", () => {
      ui.viewMode = value;
      ui.start = 0;
      rerender();
    });
    modes.append(button);
  }
  controls.append(modes);

  const range = visibleDates(viewModel, ui);
  if (ui.viewMode !== "month") {
    const navigation = element("div", "dashboard-range-navigation");
    const previous = createButton("← 前へ", { variant: "secondary" });
    previous.disabled = ui.start === 0;
    previous.addEventListener("click", () => { ui.start -= range.span; rerender(); });
    const next = createButton("次へ →", { variant: "secondary" });
    next.disabled = ui.start >= range.lastStart;
    next.addEventListener("click", () => { ui.start += range.span; rerender(); });
    const label = range.dates.length
      ? `${range.dates[0].date.slice(5).replace("-", "/")}〜${range.dates.at(-1).date.slice(5).replace("-", "/")}`
      : "";
    navigation.append(previous, element("span", "dashboard-range-label", label), next);
    controls.append(navigation);
  }

  const filterRow = element("div", "dashboard-filter-row");
  filterRow.append(createSelectControl(
    "職員",
    ui.employeeId,
    [{ value: "all", label: "全職員" }, ...employees.filter((row) => row.active).map((row) => ({
      value: String(row.employee_id), label: row.name,
    }))],
    (value) => { ui.employeeId = value; rerender(); },
  ));
  if (settings.restaurant_mode) {
    const roles = [...new Set(employees.filter((row) => row.active && row.role).map((row) => row.role))].sort();
    filterRow.append(createSelectControl(
      "役割",
      ui.role,
      [{ value: "all", label: "すべての役割" }, ...roles.map((role) => ({ value: role, label: role }))],
      (value) => { ui.role = value; rerender(); },
    ));
  }
  filterRow.append(
    createToggle("希望表示", ui.showRequests, (value) => { ui.showRequests = value; rerender(); }),
    createToggle("人数集計", ui.showSummary, (value) => { ui.showSummary = value; rerender(); }),
    createToggle("スキル", ui.showSkills, (value) => { ui.showSkills = value; rerender(); }),
  );
  section.append(controls, filterRow);

  let filteredStaffIds = null;
  if (ui.employeeId !== "all") {
    filteredStaffIds = new Set([ui.employeeId]);
  } else if (settings.restaurant_mode && ui.role !== "all") {
    filteredStaffIds = new Set(employees.filter(
      (employee) => employee.active && employee.role === ui.role,
    ).map((employee) => String(employee.employee_id)));
  }
  section.append(
    createScheduleTable(viewModel, {
      visibleDates: range.dates,
      showRequired: ui.showSummary,
      showAssigned: ui.showSummary,
      showRequests: ui.showRequests,
      showSkillBadges: ui.showSkills,
      filteredStaffIds,
    }),
    createShiftLegend(viewModel.shift_map),
  );

  if (settings.restaurant_mode) {
    const restaurantAlerts = (await restaurantConditionChecks(targetMonth, assignments))
      .filter((row) => row.結果 === "要確認");
    if (restaurantAlerts.length) {
      const warningBox = element("details", "dashboard-warning-box");
      warningBox.open = true;
      warningBox.append(element("summary", "", `飲食店向け配置の確認事項 ${restaurantAlerts.length}件`));
      const list = element("ul");
      restaurantAlerts.slice(0, 12).forEach((row) => list.append(element(
        "li",
        "",
        `${row.日付}｜${row.確認項目}：${row.内容}`,
      )));
      warningBox.append(list);
      if (restaurantAlerts.length > 12) {
        warningBox.append(element("p", "small-note", "残りは下部の「飲食店条件確認」タブで確認できます。"));
      }
      section.append(warningBox);
    }
  }
  section.append(await createDetails(
    targetMonth,
    assignments,
    settings,
    employees,
    shiftTypes,
    ui,
    rerender,
  ));
}

export async function renderDashboardPage(container, notice = "") {
  const targetMonth = getState().targetMonth;
  const ui = stateFor(targetMonth);
  const renderToken = Symbol("dashboard-render");
  container._dashboardRenderToken = renderToken;
  container.replaceChildren(createLoading("勤務表を読み込み中…"));

  try {
    const [schedule, settings, employees, shiftTypes] = await Promise.all([
      latestSchedule(targetMonth),
      getSettings(),
      getAllEmployees(),
      getAllShiftTypes(),
    ]);
    if (container._dashboardRenderToken !== renderToken) return;
    const rerender = () => { void renderDashboardPage(container); };
    const createButtonNode = createButton("自動作成", { variant: "primary", className: "solver-run-button" });
    const section = element("section", "dashboard-page");
    section.append(createPageHeading(
      `${monthLabel(targetMonth)}の勤務表`,
      "事前チェック、勤務表の自動作成、結果の確認をこの画面で行います。",
      createButtonNode,
    ));
    const messages = element("div", "dashboard-message-region");
    section.append(messages);
    if (notice) messages.append(createAlert(notice, "success"));

    createButtonNode.addEventListener("click", async () => {
      createButtonNode.disabled = true;
      createButtonNode.replaceChildren(element("span", "solver-spinner"), document.createTextNode(" 自動作成中…"));
      messages.replaceChildren(createAlert("事前チェックを実行しています。", "success"));
      const issues = await precheck(targetMonth);
      const blockers = blockingIssues(issues);
      if (blockers.length) {
        createButtonNode.disabled = false;
        createButtonNode.textContent = "自動作成";
        appendIssueBanners(messages, issues);
        return;
      }
      messages.replaceChildren(createAlert("HiGHSで勤務表を作成しています。しばらくお待ちください。", "success"));
      const result = await runSolver(targetMonth);
      if (result.status === "success") {
        await renderDashboardPage(container, `勤務表を作成しました（目的関数: ${result.objectiveValue ?? 0}）。`);
        return;
      }
      createButtonNode.disabled = false;
      createButtonNode.textContent = "自動作成";
      if (result.status === "infeasible") {
        messages.replaceChildren(createAlert(
          ["条件を満たす勤務表が見つかりませんでした。", ...(result.diagnostics ?? []).map((row) => row.message)],
          "error",
        ));
      } else {
        messages.replaceChildren(createAlert(result.message ?? "自動作成に失敗しました。", "error"));
      }
    });

    if (schedule?.status !== "success" || !schedule?.assignments?.length) {
      const issues = await precheck(targetMonth);
      appendIssueBanners(messages, issues);
      section.append(createAlert("この月の自動作成結果はまだありません。条件を確認して「自動作成」を押してください。", "warning"));
    } else {
      const metadata = element("div", "schedule-metadata");
      metadata.append(
        element("span", "", `作成日時: ${schedule.created_at ?? "-"}`),
        element("span", "", `目的関数: ${schedule.objective_value ?? 0}`),
        element("span", "", `計算時間: ${(Number(schedule.solver_wall_time ?? 0) / 1000).toFixed(2)}秒`),
      );
      section.append(metadata);
      await renderSchedule(section, targetMonth, schedule, settings, employees, shiftTypes, ui, rerender);
    }
    if (container._dashboardRenderToken === renderToken) container.replaceChildren(section);
  } catch (error) {
    if (container._dashboardRenderToken !== renderToken) return;
    container.replaceChildren(createAlert(
      `勤務表画面を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    ));
  }
}
