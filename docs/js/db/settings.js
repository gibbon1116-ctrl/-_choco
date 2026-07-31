import {
  STORE_SKILL_CODES,
  createDefaultSettings,
} from "./database.js";
import {
  integerValue,
  requestToPromise,
  runTransaction,
  stringValue,
} from "./helpers.js";

function normalizePriority(priority) {
  return priority === "hard" ? "hard" : "soft";
}

function normalizeSettings(data, current) {
  const defaults = createDefaultSettings();
  const source = current ?? defaults;
  const inputSkills = data.skills ?? {};
  const currentSkills = source.skills ?? defaults.skills;
  const skills = {};

  for (const skillCode of STORE_SKILL_CODES) {
    const defaultSkill = defaults.skills[skillCode];
    const currentSkill = currentSkills[skillCode] ?? defaultSkill;
    const inputSkill = inputSkills[skillCode] ?? {};
    skills[skillCode] = {
      minimum_level: stringValue(
        inputSkill.minimum_level,
        currentSkill.minimum_level,
      ),
      required_count: Math.max(
        0,
        integerValue(inputSkill.required_count, currentSkill.required_count),
      ),
      priority: normalizePriority(inputSkill.priority ?? currentSkill.priority),
    };
  }

  return {
    id: 1,
    store_name: stringValue(data.store_name, source.store_name),
    business_hours: stringValue(data.business_hours, source.business_hours),
    weekday_required: integerValue(
      data.weekday_required,
      source.weekday_required,
    ),
    weekend_required: integerValue(
      data.weekend_required,
      source.weekend_required,
    ),
    restaurant_mode: Boolean(
      data.restaurant_mode ?? source.restaurant_mode,
    ),
    require_english_per_shift: Boolean(
      data.require_english_per_shift ?? source.require_english_per_shift,
    ),
    skills,
  };
}

export async function getSettings() {
  const settings = await runTransaction("settings", "readonly", (transaction) =>
    requestToPromise(transaction.objectStore("settings").get(1)),
  );
  return settings ?? createDefaultSettings();
}

export function saveSettings(data) {
  return runTransaction("settings", "readwrite", async (transaction) => {
    const store = transaction.objectStore("settings");
    const current = await requestToPromise(store.get(1));
    const settings = normalizeSettings(data, current);
    await requestToPromise(store.put(settings));
    return settings;
  });
}
