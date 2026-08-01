export const ENGLISH_LEVELS = Object.freeze([
  "none",
  "basic",
  "conversational",
  "fluent",
]);

export const LEVEL_SKILL_FIELDS = Object.freeze([
  "product_skill_ice",
  "product_skill_chocolate",
  "product_skill_cookie",
  "new_product_skill",
  "peak_support_level",
]);

function integerLikePython(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("not an integer");
    }
    return Math.trunc(value);
  }
  if (typeof value === "boolean") {
    return Number(value);
  }
  const text = String(value).trim();
  if (!/^[+-]?\d+$/.test(text)) {
    throw new TypeError("not an integer");
  }
  return Number(text);
}

export function validateEmployee(data) {
  const errors = [];
  if (!String(data.employee_id ?? "").trim()) {
    errors.push("職員IDを入力してください。");
  }
  if (!String(data.name ?? "").trim()) {
    errors.push("職員名を入力してください。");
  }

  try {
    const consecutive = integerLikePython(data.max_consecutive_days ?? 5);
    const minimum = integerLikePython(data.min_work_days ?? 0);
    const maximum = integerLikePython(data.max_work_days ?? 31);
    if (consecutive < 1) {
      errors.push("最大連続勤務日数は1以上にしてください。");
    }
    if (minimum < 0 || maximum < minimum) {
      errors.push("月間勤務日数の下限・上限を確認してください。");
    }
  } catch {
    errors.push("勤務日数の項目は整数で入力してください。");
  }

  if (!ENGLISH_LEVELS.includes(String(data.english_level ?? "none"))) {
    errors.push("英語レベルの値を確認してください。");
  }

  for (const field of LEVEL_SKILL_FIELDS) {
    try {
      const value = integerLikePython(data[field] ?? 0);
      if (value < 0 || value > 3) {
        errors.push(`${field} は0〜3で入力してください。`);
      }
    } catch {
      errors.push(`${field} は整数で入力してください。`);
    }
  }
  return errors;
}
