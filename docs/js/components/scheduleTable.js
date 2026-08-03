import { element } from "../pages/pageUtils.js";

function weekendClass(date) {
  if (date.is_saturday) return "schedule-col--saturday";
  if (date.is_sunday) return "schedule-col--sunday";
  return "";
}

function requestText(cell) {
  const type = cell.request_type;
  if (!type) return "";
  if (type === "off") return cell.request_violated ? "希望休違反" : "希望休";
  if (type === "fixed") return cell.request_violated ? "固定違反" : "固定";
  if (type === "prefer") return cell.request_violated ? "希望違反" : "希望";
  if (type === "avoid" && cell.request_violated) return "避けたい（違反）";
  return "";
}

function createShiftCell(cell, date, {
  showRequests,
  showSkillBadges,
  employeeId,
  staffName,
  shiftOptions,
  onEditCell,
}) {
  const tableCell = element("td", `schedule-shift-cell ${weekendClass(date)}`.trim());
  const renderContents = () => {
    tableCell.replaceChildren();
    const requestLabel = showRequests ? requestText(cell) : "";

    if (!cell.is_work) {
      if (requestLabel) {
        const badge = element(
          "div",
          `schedule-shift-badge schedule-request-badge${cell.request_violated ? " is-violated" : ""}`,
        );
        badge.append(element("span", "schedule-shift-name", requestLabel));
        tableCell.append(badge);
      } else {
        tableCell.append(element("span", "schedule-rest", "―"));
      }
      return;
    }

    const badge = element(
      "div",
      `schedule-shift-badge${showRequests && cell.request_violated ? " is-violated" : ""}`,
    );
    badge.style.backgroundColor = cell.color;
    badge.append(element("span", "schedule-shift-name", cell.shift_name || cell.shift_code));
    if (cell.start_time && cell.end_time) {
      badge.append(element(
        "span",
        "schedule-shift-time",
        `${cell.start_time}-${cell.end_time}`,
      ));
    }
    if (requestLabel) {
      badge.append(element(
        "span",
        `schedule-request-label${cell.request_violated ? " is-violated" : ""}`,
        requestLabel,
      ));
    }
    if (showSkillBadges && cell.skill_badges?.length) {
      const skills = element("span", "schedule-skill-badges");
      for (const label of cell.skill_badges) {
        skills.append(element("span", "schedule-skill-badge", label));
      }
      badge.append(skills);
    }
    tableCell.append(badge);
  };

  renderContents();
  if (typeof onEditCell !== "function") return tableCell;

  tableCell.classList.add("schedule-shift-cell--editable");
  tableCell.tabIndex = 0;
  tableCell.title = "ダブルクリックで勤務区分を変更";
  tableCell.setAttribute(
    "aria-label",
    `${date.date} ${staffName} ${cell.shift_name || cell.shift_code}（ダブルクリックで勤務区分を変更）`,
  );

  const startEditing = () => {
    if (tableCell.querySelector(".schedule-cell-editor")) return;
    const originalShiftCode = String(cell.shift_code);
    const select = element("select", "schedule-cell-editor");
    for (const shift of shiftOptions) {
      const option = element("option", "", shift.label);
      option.value = shift.value;
      select.append(option);
    }
    select.value = originalShiftCode;
    tableCell.replaceChildren(select);
    select.focus();

    let committing = false;
    let finished = false;
    const cancel = () => {
      if (committing || finished) return;
      finished = true;
      renderContents();
      tableCell.focus();
    };
    const commit = async () => {
      if (committing || finished) return;
      if (select.value === originalShiftCode) {
        cancel();
        return;
      }
      committing = true;
      select.disabled = true;
      try {
        await onEditCell({
          employee_id: employeeId,
          date: date.date,
          shift_code: select.value,
        });
        finished = true;
      } catch {
        committing = false;
        finished = true;
        renderContents();
        tableCell.focus();
      }
    };

    select.addEventListener("change", () => { void commit(); });
    select.addEventListener("blur", () => {
      if (select.value === originalShiftCode) cancel();
      else void commit();
    });
    select.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    });
  };

  tableCell.addEventListener("dblclick", startEditing);
  tableCell.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    startEditing();
  });
  return tableCell;
}

function createSummaryRow(label, dates, values, rowClass, { diff = false } = {}) {
  const row = element("tr", `schedule-summary-row ${rowClass}`);
  row.append(element("th", "schedule-staff-column", label));
  for (const date of dates) {
    const value = Number(values[date.date] ?? 0);
    const classNames = [weekendClass(date)];
    let text = String(value);
    if (diff) {
      classNames.push(value < 0 ? "is-shortage" : (value > 0 ? "is-surplus" : "is-balanced"));
      if (value > 0) text = `+${value}`;
    }
    row.append(element("td", classNames.filter(Boolean).join(" "), text));
  }
  return row;
}

export function createScheduleTable(viewModel, {
  visibleDates = null,
  showRequired = true,
  showAssigned = true,
  showRequests = true,
  showSkillBadges = true,
  filteredStaffIds = null,
  ariaLabel = "勤務表",
  onEditCell = null,
} = {}) {
  const dates = visibleDates ?? viewModel.dates;
  const shiftOptions = Object.values(viewModel.shift_map).map((shift) => ({
    value: shift.shift_code,
    label: shift.shift_name,
  }));
  if (!shiftOptions.some((shift) => shift.value === "O")) {
    shiftOptions.push({ value: "O", label: "休み" });
  }
  const staffRows = filteredStaffIds
    ? viewModel.staff_rows.filter((row) => filteredStaffIds.has(row.employee_id))
    : viewModel.staff_rows;
  const container = element("div", "schedule-table-container");
  container.tabIndex = 0;
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", ariaLabel);
  const table = element("table", "schedule-table");

  const head = element("thead");
  const headerRow = element("tr");
  const staffHeader = element("th", "schedule-staff-column", "スタッフ名");
  staffHeader.scope = "col";
  headerRow.append(staffHeader);
  for (const date of dates) {
    const header = element(
      "th",
      `schedule-date-header ${weekendClass(date)}`.trim(),
    );
    header.scope = "col";
    header.append(
      element("span", "schedule-date-day", String(date.day)),
      element("span", "schedule-date-weekday", date.weekday),
    );
    if (date.is_event) {
      const event = element("span", "schedule-date-event", "★");
      event.title = date.event_label;
      event.setAttribute("aria-label", date.event_label);
      header.append(event);
    }
    headerRow.append(header);
  }
  head.append(headerRow);

  const body = element("tbody");
  if (showRequired) {
    body.append(createSummaryRow(
      "必要人数",
      dates,
      viewModel.summary.required,
      "schedule-summary-row--required",
    ));
  }
  if (showAssigned) {
    body.append(createSummaryRow(
      "配置人数",
      dates,
      viewModel.summary.assigned,
      "schedule-summary-row--assigned",
    ));
  }
  if (showRequired || showAssigned) {
    body.append(createSummaryRow(
      "過不足",
      dates,
      viewModel.summary.diff,
      "schedule-summary-row--diff",
      { diff: true },
    ));
  }

  for (const staff of staffRows) {
    const row = element("tr", "schedule-staff-row");
    const nameCell = element("th", "schedule-staff-column");
    nameCell.scope = "row";
    nameCell.append(
      element("span", "schedule-staff-name", staff.name),
      element("span", "schedule-staff-role", staff.role),
    );
    row.append(nameCell);
    for (const date of dates) {
      row.append(createShiftCell(
        staff.cells[date.date] ?? {
          shift_code: "O",
          is_work: false,
          request_violated: false,
          skill_badges: [],
        },
        date,
        {
          showRequests,
          showSkillBadges,
          employeeId: staff.employee_id,
          staffName: staff.name,
          shiftOptions,
          onEditCell,
        },
      ));
    }
    body.append(row);
  }

  table.append(head, body);
  container.append(table);
  return container;
}

export function createShiftLegend(shiftMap) {
  const legend = element("div", "schedule-legend");
  legend.setAttribute("aria-label", "勤務区分の凡例");
  for (const shift of Object.values(shiftMap)) {
    const item = element("span", "schedule-legend-item", shift.shift_name);
    item.style.backgroundColor = shift.color;
    legend.append(item);
  }
  const note = element("span", "schedule-legend-note");
  note.append(
    element("span", "is-shortage", "不足"),
    document.createTextNode("・"),
    element("span", "is-surplus", "超過"),
    document.createTextNode("・"),
    element("span", "schedule-request-legend", "希望違反"),
  );
  legend.append(note);
  return legend;
}
