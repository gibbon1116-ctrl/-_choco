const TARGET_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_LABELS = Object.freeze(["日", "月", "火", "水", "木", "金", "土"]);

export function parseTargetMonth(targetMonth) {
  const match = TARGET_MONTH_PATTERN.exec(String(targetMonth));
  if (!match) {
    throw new Error("対象年月はYYYY-MM形式で指定してください。");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error("対象年月はYYYY-MM形式で指定してください。");
  }

  return { year, month };
}

export function monthDates(targetMonth) {
  const { year, month } = parseTargetMonth(targetMonth);
  const lastDay = new Date(year, month, 0).getDate();
  return Array.from({ length: lastDay }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${year}-${String(month).padStart(2, "0")}-${day}`;
  });
}

export function parseIsoDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("有効な日付を指定してください。");
    }
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const match = ISO_DATE_PATTERN.exec(String(value));
  if (!match) {
    throw new Error("日付はYYYY-MM-DD形式で指定してください。");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    throw new Error("有効な日付を指定してください。");
  }
  return date;
}

export function isoDate(value) {
  const date = parseIsoDate(value);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isWeekend(value) {
  const date = parseIsoDate(value);
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function weekdayLabel(value) {
  const date = parseIsoDate(value);
  return WEEKDAY_LABELS[date.getDay()];
}

export function displayDate(value) {
  const date = parseIsoDate(value);
  return `${date.getMonth() + 1}/${date.getDate()} (${weekdayLabel(date)})`;
}
