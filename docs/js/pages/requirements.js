import {
  getAllShiftTypes,
  getRequirements,
  replaceRequirements,
} from "../db/index.js";
import {
  displayDate,
  isWeekend,
  monthDates,
  weekdayLabel,
} from "../utils/calendar.js";
import { getState } from "../state.js";
import { monthLabel } from "../components/monthSelector.js";
import {
  createAlert,
  createButton,
  createField,
  createLoading,
  createPageHeading,
  element,
  showAlert,
} from "./pageUtils.js";

let renderVersion = 0;

function createTemplateEditor(shifts, targetMonth, container, gridHost, version) {
  const section = element("section", "crud-card requirements-template");
  const header = element("div", "crud-card__header");
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", "crud-card__title", "平日・土日テンプレートを一括適用"),
    element(
      "p",
      "crud-form__caption",
      "勤務区分ごとの基準人数を、対象月の全日へまとめて設定します。",
    ),
  );
  header.append(titleGroup);

  const messageRegion = element("div", "form-message-region");
  const controls = new Map();
  const grid = element("div", "template-grid");

  for (const shift of shifts) {
    const group = element("fieldset", "template-shift");
    const legend = element("legend", "template-shift__title", `${shift.shift_name}（${shift.shift_code}）`);
    const weekday = createField({
      label: "平日",
      name: `weekday_${shift.shift_code}`,
      type: "number",
      value: shift.shift_code === "D" ? 4 : 1,
      min: 0,
      max: 99,
      inputMode: "numeric",
    });
    const weekend = createField({
      label: "土日",
      name: `weekend_${shift.shift_code}`,
      type: "number",
      value: shift.shift_code === "D" ? 2 : (shift.shift_code === "N" ? 1 : 0),
      min: 0,
      max: 99,
      inputMode: "numeric",
    });
    controls.set(shift.shift_code, {
      weekday: weekday.input,
      weekend: weekend.input,
    });
    group.append(legend, weekday.wrapper, weekend.wrapper);
    grid.append(group);
  }

  const actions = element("div", "form-actions");
  const applyButton = createButton("テンプレートを適用", { variant: "primary" });
  applyButton.dataset.action = "apply-requirements-template";
  applyButton.addEventListener("click", async () => {
    const errors = [];
    for (const shift of shifts) {
      const values = controls.get(shift.shift_code);
      for (const [kind, input] of [["平日", values.weekday], ["土日", values.weekend]]) {
        const value = Number(input.value);
        if (!Number.isInteger(value) || value < 0 || value > 99) {
          errors.push(`${kind}・${shift.shift_name}は0〜99の整数で入力してください。`);
        }
      }
    }
    if (errors.length) {
      showAlert(messageRegion, errors);
      return;
    }

    const rows = monthDates(targetMonth).flatMap((date) =>
      shifts.map((shift) => {
        const values = controls.get(shift.shift_code);
        return {
          date,
          shift_code: shift.shift_code,
          required_count: Number(isWeekend(date) ? values.weekend.value : values.weekday.value),
        };
      }),
    );

    applyButton.disabled = true;
    try {
      await replaceRequirements(targetMonth, rows);
      if (version !== renderVersion || container.dataset.page !== "requirements") return;
      const requirements = await getRequirements(targetMonth);
      if (version !== renderVersion || container.dataset.page !== "requirements") return;
      gridHost.replaceChildren(createRequirementsGrid(shifts, requirements, targetMonth, container));
      showAlert(messageRegion, "テンプレートを適用しました。", "success");
    } catch (error) {
      showAlert(messageRegion, error.message || "テンプレートを適用できませんでした。");
    } finally {
      applyButton.disabled = false;
    }
  });
  actions.append(applyButton);
  section.append(header, messageRegion, grid, actions);
  return section;
}

function createRequirementsGrid(shifts, requirements, targetMonth, container) {
  const existing = new Map(
    requirements.map((row) => [`${row.date}\u0000${row.shift_code}`, row.required_count]),
  );
  const section = element("section", "crud-card requirements-editor");
  const header = element("div", "crud-card__header");
  header.append(
    element("h2", "crud-card__title", `${monthLabel(targetMonth)}の必要人数`),
    element("span", "count-badge", `${monthDates(targetMonth).length}日分`),
  );
  const messageRegion = element("div", "form-message-region");
  const wrapper = element("div", "app-table-wrap requirements-table-wrap");
  const table = element("table", "app-table requirements-table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["日付", "曜日", ...shifts.map((shift) => shift.shift_name)]) {
    headerRow.append(element("th", "", label));
  }
  head.append(headerRow);

  const body = element("tbody");
  for (const date of monthDates(targetMonth)) {
    const dayLabel = weekdayLabel(date);
    const row = element(
      "tr",
      dayLabel === "土" ? "is-saturday" : (dayLabel === "日" ? "is-sunday" : ""),
    );
    row.append(
      element("td", "requirements-table__date", displayDate(date).split(" ")[0]),
      element("td", "requirements-table__weekday", dayLabel),
    );

    for (const shift of shifts) {
      const cell = element("td", "requirements-table__value");
      const input = element("input", "app-input requirements-count-input");
      input.type = "number";
      input.min = "0";
      input.max = "99";
      input.inputMode = "numeric";
      input.value = String(existing.get(`${date}\u0000${shift.shift_code}`) ?? 0);
      input.dataset.date = date;
      input.dataset.shiftCode = shift.shift_code;
      input.setAttribute("aria-label", `${displayDate(date)} ${shift.shift_name}の必要人数`);
      cell.append(input);
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);

  const actions = element("div", "form-actions");
  const saveButton = createButton("必要人数を保存", { variant: "primary" });
  saveButton.dataset.action = "save-requirements";
  saveButton.addEventListener("click", async () => {
    const rows = [];
    const errors = [];
    for (const input of table.querySelectorAll(".requirements-count-input")) {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0 || value > 99) {
        errors.push(`${input.getAttribute("aria-label")}は0〜99の整数で入力してください。`);
      } else {
        rows.push({
          date: input.dataset.date,
          shift_code: input.dataset.shiftCode,
          required_count: value,
        });
      }
    }
    if (errors.length) {
      showAlert(messageRegion, errors);
      return;
    }

    saveButton.disabled = true;
    try {
      await replaceRequirements(targetMonth, rows);
      await renderRequirementsPage(container, {
        type: "success",
        message: "必要人数を保存しました。",
      });
    } catch (error) {
      saveButton.disabled = false;
      showAlert(messageRegion, error.message || "必要人数を保存できませんでした。");
    }
  });
  actions.append(saveButton);
  section.append(header, messageRegion, wrapper, actions);
  return section;
}

export async function renderRequirementsPage(container, notice = null) {
  const version = ++renderVersion;
  const targetMonth = getState().targetMonth;
  container.replaceChildren(createLoading("必要人数を読み込んでいます…"));

  let shifts;
  let requirements;
  try {
    [shifts, requirements] = await Promise.all([
      getAllShiftTypes(),
      getRequirements(targetMonth),
    ]);
  } catch (error) {
    if (version !== renderVersion) return;
    container.replaceChildren(createAlert(error.message || "必要人数を読み込めませんでした。"));
    return;
  }
  if (version !== renderVersion || container.dataset.page !== "requirements") return;

  const workShifts = shifts.filter((shift) => Boolean(shift.is_work));
  const page = element("section", "crud-page requirements-page");
  const noticeRegion = element("div", "page-notice-region");
  page.append(
    createPageHeading(
      "必要人数設定",
      "日付・勤務区分ごとの必要人数を入力します。対象年月は画面右上で切り替えられます。",
    ),
    noticeRegion,
  );
  if (notice) noticeRegion.append(createAlert(notice.message, notice.type));

  if (!workShifts.length) {
    page.append(element("p", "empty-state", "勤務扱いの勤務区分が登録されていません。"));
  } else {
    const gridHost = element("div");
    gridHost.append(createRequirementsGrid(workShifts, requirements, targetMonth, container));
    page.append(
      createTemplateEditor(workShifts, targetMonth, container, gridHost, version),
      gridHost,
    );
  }
  container.replaceChildren(page);
}
