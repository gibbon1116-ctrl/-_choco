export const SOLVER_CONFIG = Object.freeze({
  penalties: Object.freeze({
    soft_request_off_violation: 100,
    prefer_request_not_satisfied: 20,
    avoid_shift_assigned: 50,
    workday_imbalance: 10,
    workday_target_deviation: 60,
    shift_type_imbalance: 30,
    shift_type_target_deviation: 100,
    same_shift_streak: 25,
    random_assignment_tiebreaker: 5,
    night_shift_imbalance: 20,
    weekend_shift_imbalance: 15,
    english_missing: 1000,
    new_product_missing: 800,
    new_product_leader_missing: 300,
    category_skill_missing: 200,
    role_requirement_missing: 500,
    close_to_open: 200,
    allergy_support_missing: 300,
  }),
  solver_time_limit_seconds: 30,
});

export function penalty(name) {
  const value = SOLVER_CONFIG.penalties[name];
  if (!Number.isFinite(value)) {
    throw new Error(`未定義のペナルティです: ${name}`);
  }
  return value;
}
