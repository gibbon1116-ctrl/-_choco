import { getState, setState, subscribe } from "../state.js";

export const DEFAULT_TARGET_MONTH = "2026-08";
export const TARGET_MONTH_STORAGE_KEY = "shiftScheduler.targetMonth";

const MONTH_OPTIONS = Object.freeze(
  Array.from({ length: 4 }, (_, yearOffset) => 2025 + yearOffset)
    .flatMap((year) =>
      Array.from(
        { length: 12 },
        (_, monthOffset) => `${year}-${String(monthOffset + 1).padStart(2, "0")}`,
      ),
    ),
);

export function monthOptions() {
  return [...MONTH_OPTIONS];
}

export function monthLabel(targetMonth) {
  const [year, month] = String(targetMonth).split("-");
  return `${year}年${Number(month)}月`;
}

function isAvailableMonth(targetMonth) {
  return MONTH_OPTIONS.includes(targetMonth);
}

function readStoredMonth() {
  try {
    const stored = localStorage.getItem(TARGET_MONTH_STORAGE_KEY);
    return isAvailableMonth(stored) ? stored : DEFAULT_TARGET_MONTH;
  } catch {
    return DEFAULT_TARGET_MONTH;
  }
}

function storeMonth(targetMonth) {
  try {
    localStorage.setItem(TARGET_MONTH_STORAGE_KEY, targetMonth);
  } catch {
    // The state still works for this tab when storage is unavailable.
  }
}

export function initializeTargetMonth() {
  const targetMonth = readStoredMonth();
  setState({ targetMonth });
  return targetMonth;
}

export function setTargetMonth(targetMonth) {
  if (!isAvailableMonth(targetMonth)) {
    throw new Error("対象年月は2025-01から2028-12の範囲で指定してください。");
  }
  storeMonth(targetMonth);
  setState({ targetMonth });
  return targetMonth;
}

export function createMonthSelector() {
  const wrapper = document.createElement("label");
  wrapper.className = "month-selector";

  const label = document.createElement("span");
  label.className = "month-selector__label";
  label.textContent = "対象年月";

  const select = document.createElement("select");
  select.className = "month-selector__select";
  select.name = "target_month";
  select.setAttribute("aria-label", "対象年月");

  for (const targetMonth of MONTH_OPTIONS) {
    const option = document.createElement("option");
    option.value = targetMonth;
    option.textContent = monthLabel(targetMonth);
    select.append(option);
  }

  select.value = getState().targetMonth;
  select.addEventListener("change", () => {
    setTargetMonth(select.value);
  });
  subscribe(({ targetMonth }) => {
    if (select.value !== targetMonth) {
      select.value = targetMonth;
    }
  });

  wrapper.append(label, select);
  return wrapper;
}
