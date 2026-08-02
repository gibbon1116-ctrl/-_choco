export const ENGLISH_LEVEL_RANKS = Object.freeze({
  none: 0,
  basic: 1,
  conversational: 2,
  fluent: 3,
});

export const ENGLISH_LEVEL_LABELS = Object.freeze({
  none: "対応不要・対応不可",
  basic: "簡単な接客英語",
  conversational: "通常接客可能",
  fluent: "複雑な説明も可能",
});

export const SKILL_LEVEL_LABELS = Object.freeze({
  0: "未経験",
  1: "補助できる",
  2: "一人で対応できる",
  3: "指導できる",
});

export const ENGLISH_LEVEL_OPTIONS = Object.freeze([
  "none",
  "basic",
  "conversational",
  "fluent",
]);

export const SKILL_LEVEL_OPTIONS = Object.freeze([1, 2, 3]);

export const SKILL_DEFINITIONS = Object.freeze([
  { code: "english_support", label: "英語対応", kind: "english", field: "english_level" },
  { code: "cashier", label: "レジ対応", kind: "binary", field: "can_cashier" },
  { code: "opener", label: "開店作業", kind: "binary", field: "can_open" },
  { code: "closer", label: "閉店作業", kind: "binary", field: "can_close" },
  { code: "product_skill_ice", label: "アイス対応", kind: "level", field: "product_skill_ice" },
  { code: "product_skill_chocolate", label: "チョコ対応", kind: "level", field: "product_skill_chocolate" },
  { code: "product_skill_cookie", label: "クッキー対応", kind: "level", field: "product_skill_cookie" },
  { code: "new_product", label: "新商品対応", kind: "level", field: "new_product_skill" },
  { code: "allergy_support", label: "アレルギー説明", kind: "binary", field: "can_explain_allergy" },
  { code: "complaint_support", label: "クレーム対応", kind: "binary", field: "can_handle_complaints" },
  { code: "new_staff", label: "新人スタッフ（属性）", kind: "attribute", field: "is_new_staff" },
  { code: "trainer", label: "新人教育", kind: "binary", field: "can_train_new_staff" },
  { code: "cash_manager", label: "現金管理", kind: "binary", field: "can_manage_cash" },
  { code: "hygiene_checker", label: "衛生確認", kind: "binary", field: "can_hygiene_check" },
  { code: "peak_support", label: "ピーク対応", kind: "level", field: "peak_support_level" },
].map(Object.freeze));

export const RELATION_LABELS = Object.freeze({
  prefer_together: "同時配置を優先",
  avoid_together: "同時配置を避ける",
  never_together: "同時配置を避ける",
  mentor_pair: "教育係として組み合わせる",
  avoid_closing_pair: "閉店作業で組ませない",
  prefer_peak_pair: "繁忙時に組ませたい",
});

export const SELECTABLE_RELATION_TYPES = Object.freeze(
  Object.keys(RELATION_LABELS).filter((type) => type !== "never_together"),
);

export function normalizeRelationType(type) {
  return type === "never_together" ? "avoid_together" : type;
}

export const ROLE_LABELS = Object.freeze({
  manager: "店長・責任者",
  shift_leader: "時間帯責任者",
  leader: "責任者・リーダー",
  cashier: "レジ",
  product_staff: "商品提供",
  kitchen_prep: "仕込み・準備",
  stock_staff: "補充・在庫対応",
  opener: "開店",
  closer: "閉店",
  trainer: "新人教育",
  english_support: "英語対応",
  complaint_support: "クレーム対応",
  hygiene_checker: "衛生確認",
  new_product: "新商品対応",
  allergy_support: "アレルギー説明",
  cash_manager: "レジ締め・現金管理",
  peak_support: "ピーク対応",
});

export const CATEGORY_SKILL_FIELDS = Object.freeze({
  ice: "product_skill_ice",
  chocolate: "product_skill_chocolate",
  cookie: "product_skill_cookie",
});

export function englishLevelRank(level) {
  return ENGLISH_LEVEL_RANKS[String(level ?? "none")] ?? 0;
}

export function skillDefinition(code) {
  const definition = SKILL_DEFINITIONS.find((item) => item.code === code);
  if (!definition) {
    throw new Error(`不明なスキルコードです: ${code}`);
  }
  return definition;
}

export function skillLevelOptions(code) {
  const definition = skillDefinition(code);
  if (definition.kind === "english") {
    return ["basic", "conversational", "fluent"];
  }
  if (definition.kind === "level") {
    return [...SKILL_LEVEL_OPTIONS];
  }
  return [1];
}

export function skillLevelLabel(code, level) {
  const definition = skillDefinition(code);
  if (definition.kind === "english") {
    return ENGLISH_LEVEL_LABELS[String(level)] ?? ENGLISH_LEVEL_LABELS.basic;
  }
  if (definition.kind === "binary") return "対応可能";
  if (definition.kind === "attribute") return "該当する";
  return SKILL_LEVEL_LABELS[Number(level)] ?? SKILL_LEVEL_LABELS[1];
}

export function skillLevelChoices(code) {
  return skillLevelOptions(code).map((value) => ({
    value,
    label: skillLevelLabel(code, value),
  }));
}

export function employeeHasSkill(employee, skillCode, minimumLevel = 1) {
  const definition = skillDefinition(skillCode);
  if (definition.kind === "english") {
    const minimumText = String(minimumLevel);
    const threshold = /^\d+$/.test(minimumText)
      ? Number(minimumText)
      : englishLevelRank(minimumText);
    return englishLevelRank(employee?.[definition.field]) >= threshold;
  }
  if (definition.kind === "binary" || definition.kind === "attribute") {
    return Boolean(employee?.[definition.field]);
  }
  return Number(employee?.[definition.field] ?? 0) >= Number(minimumLevel);
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function employeeHasRole(employee, roleCode, { skillLevel = 1 } = {}) {
  const roleText = String(employee?.role ?? "");
  const skillsText = String(employee?.skills ?? "");
  const mapping = {
    english_support: employeeHasSkill(employee, "english_support", skillLevel),
    manager: includesAny(roleText, ["店長", "責任者", "manager"]),
    shift_leader: includesAny(roleText, ["店長", "責任者", "リーダー", "leader"]),
    leader: includesAny(roleText, ["店長", "責任者", "リーダー", "manager", "leader"]),
    cashier: employeeHasSkill(employee, "cashier"),
    product_staff: Math.max(
      Number(employee?.product_skill_ice ?? 0),
      Number(employee?.product_skill_chocolate ?? 0),
      Number(employee?.product_skill_cookie ?? 0),
    ) >= skillLevel,
    kitchen_prep: includesAny(skillsText, ["仕込み", "調理", "準備"]),
    stock_staff: includesAny(skillsText, ["補充", "在庫"]),
    opener: employeeHasSkill(employee, "opener"),
    closer: employeeHasSkill(employee, "closer"),
    new_product: employeeHasSkill(employee, "new_product", skillLevel),
    allergy_support: employeeHasSkill(employee, "allergy_support"),
    complaint_support: employeeHasSkill(employee, "complaint_support"),
    trainer: employeeHasSkill(employee, "trainer"),
    hygiene_checker: employeeHasSkill(employee, "hygiene_checker"),
    cash_manager: employeeHasSkill(employee, "cash_manager"),
    peak_support: employeeHasSkill(employee, "peak_support", 2),
  };
  return Boolean(mapping[roleCode] ?? false);
}
