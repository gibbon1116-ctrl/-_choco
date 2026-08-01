import * as databaseApi from "../db/index.js";
import { isWeekend, monthDates, parseTargetMonth } from "../utils/calendar.js";

const SAMPLE_NAMES = Object.freeze([
  "山田 太郎", "佐藤 花子", "鈴木 一郎", "高橋 美咲", "田中 裕子", "伊藤 大輔",
  "渡辺 恵美", "中村 健一", "小林 由香", "加藤 直樹", "吉田 真由美", "山本 翔平",
]);

function sampleEmployees() {
  const english = new Map([
    [1, "fluent"], [2, "conversational"], [3, "basic"], [4, "conversational"],
  ]);
  return SAMPLE_NAMES.map((name, index) => {
    const number = index + 1;
    return {
      employee_id: `E${String(number).padStart(3, "0")}`,
      name,
      role: number === 1 ? "店長" : ([2, 3].includes(number) ? "リーダー" : "スタッフ"),
      skills: "飲食店接客",
      active: true,
      night_allowed: false,
      max_consecutive_days: 5,
      min_work_days: 10,
      max_work_days: 22,
      note: "",
      english_level: english.get(number) ?? "none",
      can_cashier: number <= 8,
      can_open: number <= 6,
      can_close: [1, 2, 4, 5, 6, 7].includes(number),
      can_handle_complaints: [1, 2, 4].includes(number),
      can_explain_allergy: [1, 2, 4, 5].includes(number),
      is_new_staff: [11, 12].includes(number),
      can_train_new_staff: [1, 2, 3].includes(number),
      product_skill_ice: [1, 3].includes(number) ? 3 : (number <= 8 ? 2 : 1),
      product_skill_chocolate: [2, 3].includes(number) ? 3 : (number <= 8 ? 2 : 1),
      product_skill_cookie: [1, 2].includes(number) ? 3 : (number <= 8 ? 2 : 1),
      new_product_skill: [1, 2, 3].includes(number) ? 3 : (number <= 7 ? 2 : 1),
      can_manage_cash: [1, 2, 4].includes(number),
      can_hygiene_check: [1, 6].includes(number),
      peak_support_level: [1, 2].includes(number) ? 3 : (number <= 7 ? 2 : 1),
    };
  });
}

export function createSampleData(targetMonth = "2026-08") {
  parseTargetMonth(targetMonth);
  const requirements = [];
  const roleRequirements = [];
  for (const date of monthDates(targetMonth)) {
    const template = isWeekend(date) ? { E: 2, D: 4, L: 2 } : { E: 2, D: 3, L: 2 };
    for (const [shiftCode, requiredCount] of Object.entries(template)) {
      requirements.push({
        target_month: targetMonth,
        date,
        shift_code: shiftCode,
        required_count: requiredCount,
      });
    }
    roleRequirements.push(
      { target_month: targetMonth, date, shift_code: "E", role_code: "opener", required_count: 1, priority: "hard" },
      { target_month: targetMonth, date, shift_code: "L", role_code: "closer", required_count: 1, priority: "hard" },
      { target_month: targetMonth, date, shift_code: "D", role_code: "cashier", required_count: 1, priority: "soft" },
    );
  }
  return {
    employees: sampleEmployees(),
    requirements,
    requests: [
      { target_month: targetMonth, employee_id: "E001", date: `${targetMonth}-05`, request_type: "off", shift_code: "O", priority: "hard", note: "私用" },
      { target_month: targetMonth, employee_id: "E002", date: `${targetMonth}-10`, request_type: "off", shift_code: "O", priority: "soft", note: "私用" },
      { target_month: targetMonth, employee_id: "E003", date: `${targetMonth}-12`, request_type: "avoid", shift_code: "L", priority: "soft", note: "" },
      { target_month: targetMonth, employee_id: "E004", date: `${targetMonth}-03`, request_type: "fixed", shift_code: "E", priority: "hard", note: "開店研修" },
      { target_month: targetMonth, employee_id: "E005", date: `${targetMonth}-18`, request_type: "prefer", shift_code: "D", priority: "soft", note: "" },
      { target_month: targetMonth, employee_id: "E008", date: `${targetMonth}-22`, request_type: "off", shift_code: "O", priority: "hard", note: "家族行事" },
    ],
    relations: [
      { employee_id_1: "E001", employee_id_2: "E011", relation_type: "mentor_pair", priority: "soft", weight: 150, active: true, note: "新人フォロー" },
      { employee_id_1: "E002", employee_id_2: "E012", relation_type: "mentor_pair", priority: "soft", weight: 150, active: true, note: "新人フォロー" },
      { employee_id_1: "E005", employee_id_2: "E006", relation_type: "avoid_together", priority: "soft", weight: 180, active: true, note: "配置バランス" },
      { employee_id_1: "E007", employee_id_2: "E008", relation_type: "prefer_peak_pair", priority: "soft", weight: 100, active: true, note: "繁忙対応" },
      { employee_id_1: "E009", employee_id_2: "E010", relation_type: "never_together", priority: "hard", weight: 300, active: true, note: "同時配置禁止" },
    ],
    campaigns: [
      { product_name: "季節のアイスサンド", category: "ice", start_date: `${targetMonth}-05`, end_date: `${targetMonth}-12`, required_skill_level: 2, require_leader_first_week: true, note: "夏季新商品" },
      { product_name: "カカオクッキー", category: "cookie", start_date: `${targetMonth}-20`, end_date: `${targetMonth}-27`, required_skill_level: 2, require_leader_first_week: true, note: "重点販売" },
    ],
    roleRequirements,
    businessDays: [
      { day: 5, event_name: "新商品発売", demand_level: "very_high", new_product_active: true },
      { day: 15, event_name: "商店街セール", demand_level: "high", new_product_active: false },
      { day: 22, event_name: "近隣イベント", demand_level: "high", new_product_active: false },
    ].map((event) => {
      const date = `${targetMonth}-${String(event.day).padStart(2, "0")}`;
      return {
        target_month: targetMonth,
        date,
        is_open: true,
        is_weekend: isWeekend(date),
        is_event_day: true,
        event_name: event.event_name,
        demand_level: event.demand_level,
        new_product_active: event.new_product_active,
        note: "サンプル",
      };
    }),
  };
}

export async function loadSampleData(targetMonth = "2026-08", { api = databaseApi } = {}) {
  const sample = createSampleData(targetMonth);
  for (const employee of sample.employees) await api.upsertEmployee(employee);
  await api.replaceRequirements(targetMonth, sample.requirements);

  for (const request of await api.getRequests(targetMonth)) await api.deleteRequest(request.id);
  for (const request of sample.requests) await api.addRequest(request);

  for (const relation of await api.getAllStaffRelations()) await api.deleteStaffRelation(relation.id);
  for (const relation of sample.relations) await api.upsertStaffRelation(relation);

  for (const campaign of await api.getAllProductCampaigns()) await api.deleteProductCampaign(campaign.id);
  for (const campaign of sample.campaigns) await api.upsertProductCampaign(campaign);

  await api.replaceRoleRequirements(targetMonth, sample.roleRequirements);
  const settings = await api.getSettings();
  await api.saveSettings({
    ...settings,
    store_name: "路面店A",
    business_hours: "10:00-21:00",
    weekday_required: 7,
    weekend_required: 8,
    restaurant_mode: true,
    require_english_per_shift: false,
    skills: {
      ...settings.skills,
      english_support: { minimum_level: "basic", required_count: 1, priority: "hard" },
      new_product: { minimum_level: "1", required_count: 1, priority: "soft" },
      allergy_support: { minimum_level: "1", required_count: 1, priority: "soft" },
    },
  });
  for (const businessDay of sample.businessDays) await api.upsertBusinessDay(businessDay);

  return {
    employees: sample.employees.length,
    requirements: sample.requirements.length,
    requests: sample.requests.length,
    relations: sample.relations.length,
    campaigns: sample.campaigns.length,
    role_requirements: sample.roleRequirements.length,
    events: sample.businessDays.length,
  };
}
