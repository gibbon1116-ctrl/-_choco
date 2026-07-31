from __future__ import annotations

import json
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from ortools.sat.python import cp_model

from . import db
from .calendar_utils import is_weekend, month_dates
from .reports import build_summary, request_violations
from .restaurant import (CATEGORY_SKILL_COLUMNS, SKILL_DEFINITIONS, campaigns_for_day,
                         employee_has_role, employee_has_skill, english_level_rank,
                         restaurant_warnings)
from .validators import blocking_issues, diagnose_infeasibility, precheck

ROOT = Path(__file__).resolve().parents[1]


def _rules() -> dict:
    with (ROOT / "config" / "rules.json").open(encoding="utf-8") as handle:
        return json.load(handle)


def _penalty(rules: dict, name: str, fallback: int) -> int:
    return int(rules.get("penalties", {}).get(name, rules.get(name, fallback)))


def generate_schedule(target_month: str, time_limit_seconds: int = 60,
                      db_path: str | Path | None = None) -> dict:
    started_issues = precheck(target_month, db_path)
    blockers = blocking_issues(started_issues)
    if blockers:
        return {"status": "error", "assignments": [], "summary": {}, "violations": blockers,
                "diagnostics": [issue for issue in started_issues if issue["severity"] == "error"],
                "objective_value": None, "solver_wall_time": 0.0}
    try:
        employees = [e for e in db.fetch_all("employees", db_path) if e["active"]]
        employee_map = {e["employee_id"]: e for e in employees}
        shifts = db.fetch_all("shift_types", db_path)
        work_shifts = [s for s in shifts if s["is_work"]]
        shift_codes = [s["shift_code"] for s in work_shifts]
        days = [d.isoformat() for d in month_dates(target_month)]
        requirements = db.fetch_all("requirements", db_path, where="target_month=?", params=(target_month,))
        requests = db.fetch_all("requests", db_path, where="target_month=?", params=(target_month,))
        settings = db.get_store_settings(db_path)
        restaurant_mode = bool(settings.get("restaurant_mode"))
        role_requirements = db.fetch_all("role_requirements", db_path, where="target_month=?", params=(target_month,))
        relations = [r for r in db.fetch_all("staff_relations", db_path) if r["active"]]
        business_days = {r["date"]: r for r in db.fetch_all(
            "business_days", db_path, where="target_month=?", params=(target_month,))}
        campaigns = db.fetch_all("product_campaigns", db_path)
        rules = _rules()

        model = cp_model.CpModel()
        x = {(e["employee_id"], day, code): model.new_bool_var(f"x_{e['employee_id']}_{day}_{code}")
             for e in employees for day in days for code in shift_codes}

        for employee in employees:
            eid = employee["employee_id"]
            for day in days:
                model.add(sum(x[eid, day, code] for code in shift_codes) <= 1)
                if not employee["night_allowed"] and "N" in shift_codes:
                    model.add(x[eid, day, "N"] == 0)

        req_map = {(r["date"], r["shift_code"]): int(r["required_count"]) for r in requirements}
        req_totals = defaultdict(int)
        for row in requirements:
            req_totals[row["date"]] += int(row["required_count"])
        for day in days:
            for code in shift_codes:
                model.add(sum(x[e["employee_id"], day, code] for e in employees) == req_map.get((day, code), 0))

        work_totals, night_totals, weekend_totals = {}, {}, {}
        shift_totals = {}
        for employee in employees:
            eid = employee["employee_id"]
            work_totals[eid] = model.new_int_var(0, len(days), f"work_total_{eid}")
            model.add(work_totals[eid] == sum(x[eid, day, code] for day in days for code in shift_codes))
            model.add(work_totals[eid] >= int(employee["min_work_days"]))
            model.add(work_totals[eid] <= min(int(employee["max_work_days"]), len(days)))
            max_consecutive = max(1, int(employee["max_consecutive_days"]))
            for start in range(0, len(days) - max_consecutive):
                window = days[start:start + max_consecutive + 1]
                model.add(sum(x[eid, day, code] for day in window for code in shift_codes) <= max_consecutive)
            night_totals[eid] = model.new_int_var(0, len(days), f"night_total_{eid}")
            model.add(night_totals[eid] == (sum(x[eid, day, "N"] for day in days) if "N" in shift_codes else 0))
            weekend_totals[eid] = model.new_int_var(0, len(days), f"weekend_total_{eid}")
            model.add(weekend_totals[eid] == sum(x[eid, day, code] for day in days if is_weekend(day) for code in shift_codes))
            for code in shift_codes:
                shift_totals[eid, code] = model.new_int_var(0, len(days), f"shift_total_{eid}_{code}")
                model.add(shift_totals[eid, code] == sum(x[eid, day, code] for day in days))

        rest_codes = [s["shift_code"] for s in work_shifts if s["requires_rest_next_day"]]
        for employee in employees:
            eid = employee["employee_id"]
            for index, day in enumerate(days[:-1]):
                for rest_code in rest_codes:
                    model.add(sum(x[eid, days[index + 1], code] for code in shift_codes) <= 1 - x[eid, day, rest_code])

        penalties = []
        for request in requests:
            eid, day = request["employee_id"], request["date"]
            if eid not in work_totals or day not in days:
                continue
            code = request.get("shift_code") or "O"
            daily_work = sum(x[eid, day, c] for c in shift_codes)
            if request["priority"] == "hard":
                if request["request_type"] == "off" or code == "O":
                    model.add(daily_work == 0)
                elif request["request_type"] == "fixed" and code in shift_codes:
                    model.add(x[eid, day, code] == 1)
                continue
            if request["request_type"] == "off":
                penalties.append(daily_work * _penalty(rules, "soft_request_off_violation", 100))
            elif request["request_type"] == "avoid" and code in shift_codes:
                penalties.append(x[eid, day, code] * _penalty(rules, "avoid_shift_assigned", 50))
            elif request["request_type"] in {"prefer", "fixed"} and code in shift_codes:
                penalties.append((1 - x[eid, day, code]) * _penalty(rules, "prefer_request_not_satisfied", 20))

        def add_minimum(expr, needed: int, priority: str, name: str, weight: int) -> None:
            if needed <= 0:
                return
            if priority == "hard":
                model.add(expr >= needed)
            else:
                shortfall = model.new_int_var(0, needed, f"shortfall_{name}")
                model.add(expr + shortfall >= needed)
                penalties.append(shortfall * weight)

        def together_var(v1, v2, name: str):
            both = model.new_bool_var(name)
            model.add(both <= v1)
            model.add(both <= v2)
            model.add(both >= v1 + v2 - 1)
            return both

        if restaurant_mode:
            open_days = [day for day in days if req_totals.get(day, 0) > 0 and business_days.get(day, {}).get("is_open", 1)]
            skill_requirements = {row["skill_code"]: row for row in db.get_store_skill_requirements(db_path)}
            english_level = english_level_rank(settings.get("required_english_level", "basic"))
            english_employees = [e for e in employees if employee_has_role(
                e, "english_support", skill_level=english_level)]
            allergy_employees = [e for e in employees if employee_has_role(e, "allergy_support")]
            peak_employees = [e for e in employees if employee_has_role(e, "peak_support")]

            if settings.get("require_english"):
                needed = max(1, int(settings.get("required_english_count", 1)))
                priority = settings.get("english_priority", "hard")
                for day in open_days:
                    if settings.get("require_english_per_shift"):
                        for code in shift_codes:
                            if req_map.get((day, code), 0):
                                add_minimum(sum(x[e["employee_id"], day, code] for e in english_employees), needed,
                                            priority, f"english_{day}_{code}", _penalty(rules, "english_missing", 1000))
                    else:
                        add_minimum(sum(x[e["employee_id"], day, code] for e in english_employees for code in shift_codes),
                                    needed, priority, f"english_{day}", _penalty(rules, "english_missing", 1000))

            for day in open_days:
                if settings.get("require_allergy"):
                    add_minimum(sum(x[e["employee_id"], day, code] for e in allergy_employees for code in shift_codes),
                                max(1, int(settings.get("required_allergy_count", 1))),
                                settings.get("allergy_priority", "soft"), f"allergy_{day}",
                                _penalty(rules, "allergy_support_missing", 300))
                info = business_days.get(day, {})
                active_campaigns = campaigns_for_day(day, campaigns)
                if active_campaigns or info.get("new_product_active"):
                    configured_new_level = int(skill_requirements.get("new_product", {}).get("minimum_level", 1))
                    required_level = max(([int(c.get("required_skill_level", 2)) for c in active_campaigns] or [1])
                                         + [configured_new_level])
                    skilled = [e for e in employees if int(e.get("new_product_skill", 0)) >= required_level]
                    priority = settings.get("new_product_priority", "soft") if settings.get("require_new_product") else "soft"
                    add_minimum(sum(x[e["employee_id"], day, code] for e in skilled for code in shift_codes),
                                max(1, int(settings.get("required_new_product_count", 1))),
                                priority, f"new_product_{day}", _penalty(rules, "new_product_missing", 800))
                    for campaign in active_campaigns:
                        skill_column = CATEGORY_SKILL_COLUMNS.get(campaign.get("category"))
                        if skill_column:
                            category_staff = [e for e in employees if int(e.get(skill_column, 0)) >= int(campaign["required_skill_level"])]
                            add_minimum(sum(x[e["employee_id"], day, code] for e in category_staff for code in shift_codes),
                                        1, "soft", f"category_{campaign['id']}_{day}",
                                        _penalty(rules, "category_skill_missing", 200))
                        start = date.fromisoformat(str(campaign["start_date"]))
                        if campaign.get("require_leader_first_week") and date.fromisoformat(day) < start + timedelta(days=7):
                            leaders = [e for e in employees if int(e.get("new_product_skill", 0)) >= 3]
                            add_minimum(sum(x[e["employee_id"], day, code] for e in leaders for code in shift_codes),
                                        1, "soft", f"product_leader_{campaign['id']}_{day}",
                                        _penalty(rules, "new_product_leader_missing", 300))

            # The remaining skills are configured in one common table so the
            # store settings screen and employee master use the same skill code.
            for definition in SKILL_DEFINITIONS:
                skill_code = definition["code"]
                if skill_code in {"english_support", "new_product", "allergy_support"}:
                    continue
                setting = skill_requirements.get(skill_code, {})
                needed = int(setting.get("required_count", 0))
                if needed <= 0:
                    continue
                qualified = [e for e in employees if employee_has_skill(
                    e, skill_code, setting.get("minimum_level", 1))]
                for day in open_days:
                    add_minimum(sum(x[e["employee_id"], day, code] for e in qualified for code in shift_codes),
                                needed, setting.get("priority", "soft"), f"skill_{skill_code}_{day}",
                                _penalty(rules, "role_requirement_missing", 500))

            for req in role_requirements:
                if req["date"] not in days or req["shift_code"] not in shift_codes:
                    continue
                qualified = [e for e in employees if employee_has_role(e, req["role_code"])]
                add_minimum(sum(x[e["employee_id"], req["date"], req["shift_code"]] for e in qualified),
                            int(req["required_count"]), req["priority"],
                            f"role_{req['id']}", _penalty(rules, "role_requirement_missing", 500))

            experienced = [e for e in employees if not e.get("is_new_staff")]
            newcomers = [e for e in employees if e.get("is_new_staff")]
            for day in days:
                for code in shift_codes:
                    if req_map.get((day, code), 0) and newcomers:
                        model.add(sum(x[e["employee_id"], day, code] for e in newcomers) <=
                                  len(newcomers) * sum(x[e["employee_id"], day, code] for e in experienced))
            if "E" in shift_codes:
                openers = [e for e in employees if employee_has_role(e, "opener")]
                for day in days:
                    if req_map.get((day, "E"), 0):
                        add_minimum(sum(x[e["employee_id"], day, "E"] for e in openers), 1, "hard",
                                    f"opener_{day}", 0)
            if "L" in shift_codes:
                closers = [e for e in employees if employee_has_role(e, "closer")]
                for day in days:
                    if req_map.get((day, "L"), 0):
                        add_minimum(sum(x[e["employee_id"], day, "L"] for e in closers), 1, "hard",
                                    f"closer_{day}", 0)
            if "L" in shift_codes and "E" in shift_codes:
                for employee in employees:
                    eid = employee["employee_id"]
                    for index in range(len(days) - 1):
                        both = together_var(x[eid, days[index], "L"], x[eid, days[index + 1], "E"],
                                            f"close_open_{eid}_{index}")
                        penalties.append(both * _penalty(rules, "close_to_open", 200))

            high_days = {d for d, info in business_days.items() if info.get("demand_level") in {"high", "very_high"}}
            for relation in relations:
                e1, e2 = relation["employee_id_1"], relation["employee_id_2"]
                if e1 not in employee_map or e2 not in employee_map:
                    continue
                rule = relation["relation_type"]
                if rule in {"prefer_together", "mentor_pair", "prefer_peak_pair"}:
                    for day in days:
                        if rule == "prefer_peak_pair" and day not in high_days:
                            continue
                        work1 = sum(x[e1, day, code] for code in shift_codes)
                        work2 = sum(x[e2, day, code] for code in shift_codes)
                        mismatch = model.new_bool_var(f"pair_day_mismatch_{relation['id']}_{day}")
                        model.add(mismatch >= work1 - work2)
                        model.add(mismatch >= work2 - work1)
                        penalties.append(mismatch * int(relation["weight"]))
                    continue
                codes = ["L"] if rule == "avoid_closing_pair" and "L" in shift_codes else shift_codes
                for day in days:
                    if rule == "prefer_peak_pair" and day not in high_days:
                        continue
                    for code in codes:
                        v1, v2 = x[e1, day, code], x[e2, day, code]
                        if rule == "never_together" and relation["priority"] == "hard":
                            model.add(v1 + v2 <= 1)
                        elif rule in {"avoid_together", "never_together", "avoid_closing_pair"}:
                            penalties.append(together_var(v1, v2, f"avoid_pair_{relation['id']}_{day}_{code}") * int(relation["weight"]))

        def add_spread(values: list, name: str, weight: int) -> None:
            if len(values) < 2:
                return
            highest = model.new_int_var(0, len(days), f"{name}_max")
            lowest = model.new_int_var(0, len(days), f"{name}_min")
            model.add_max_equality(highest, values)
            model.add_min_equality(lowest, values)
            penalties.append((highest - lowest) * weight)

        def add_target_deviation(values: list, total: int, name: str, weight: int) -> None:
            if len(values) < 2 or total <= 0 or weight <= 0:
                return
            target_low = total // len(values)
            target_high = (total + len(values) - 1) // len(values)
            for index, value in enumerate(values):
                # Make concentration increasingly expensive.  A simple linear
                # penalty can still prefer satisfying many soft shift requests
                # for one person.  Incremental penalties behave like squared
                # deviation and quickly push assignments back toward the group.
                for extra in range(1, len(days) + 1):
                    high_threshold = target_high + extra
                    if high_threshold <= len(days):
                        over = model.new_bool_var(f"{name}_over_{index}_{extra}")
                        model.add(value < high_threshold).only_enforce_if(over.Not())
                        penalties.append(over * weight * (2 * extra - 1))

                    low_threshold = target_low - extra
                    if low_threshold >= 0:
                        under = model.new_bool_var(f"{name}_under_{index}_{extra}")
                        model.add(value > low_threshold).only_enforce_if(under.Not())
                        penalties.append(under * weight * (2 * extra - 1))

        total_required_work = sum(max(0, int(count)) for count in req_map.values())
        add_target_deviation(list(work_totals.values()), total_required_work, "work_target",
                             _penalty(rules, "workday_target_deviation", 25))
        add_spread(list(work_totals.values()), "work", _penalty(rules, "workday_imbalance", 10))
        add_spread([night_totals[e["employee_id"]] for e in employees if e["night_allowed"]],
                   "night", _penalty(rules, "night_shift_imbalance", 20))
        add_spread(list(weekend_totals.values()), "weekend", _penalty(rules, "weekend_shift_imbalance", 15))

        def balance_candidates_for_shift(code: str) -> list[dict]:
            candidates = []
            max_required_for_code = max((req_map.get((day, code), 0) for day in days), default=0)
            english_needed = max(1, int(settings.get("required_english_count", 1)))
            for employee in employees:
                if code == "N" and not employee["night_allowed"]:
                    continue
                if restaurant_mode:
                    if code == "E" and not employee_has_role(employee, "opener"):
                        continue
                    if code == "L" and not employee_has_role(employee, "closer"):
                        continue
                    if employee.get("is_new_staff") and max_required_for_code <= 1:
                        continue
                    if (settings.get("require_english") and settings.get("english_priority") == "hard"
                            and settings.get("require_english_per_shift")
                            and max_required_for_code <= english_needed):
                        required_level = english_level_rank(settings.get("required_english_level", "basic"))
                        if not employee_has_role(employee, "english_support", skill_level=required_level):
                            continue
                candidates.append(employee)
            return candidates or employees

        for code in shift_codes:
            total_required_for_code = sum(max(0, req_map.get((day, code), 0)) for day in days)
            if total_required_for_code <= 0:
                continue
            eligible = balance_candidates_for_shift(code)
            code_values = [shift_totals[e["employee_id"], code] for e in eligible]
            add_target_deviation(code_values, total_required_for_code, f"shift_target_{code}",
                                 _penalty(rules, "shift_type_target_deviation", 18))
            add_spread(code_values, f"shift_{code}", _penalty(rules, "shift_type_imbalance", 8))

        same_shift_streak_weight = _penalty(rules, "same_shift_streak", 25)
        if same_shift_streak_weight > 0:
            for employee in employees:
                eid = employee["employee_id"]
                for index in range(len(days) - 1):
                    for code in shift_codes:
                        same_shift = together_var(x[eid, days[index], code], x[eid, days[index + 1], code],
                                                  f"same_shift_{eid}_{index}_{code}")
                        penalties.append(same_shift * same_shift_streak_weight)

        random_weight = _penalty(rules, "random_assignment_tiebreaker", 1)
        if random_weight > 0:
            rng = random.SystemRandom()
            for employee in employees:
                eid = employee["employee_id"]
                for day in days:
                    for code in shift_codes:
                        penalties.append(x[eid, day, code] * rng.randint(0, random_weight))

        model.minimize(sum(penalties))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(1, int(time_limit_seconds))
        solver.parameters.num_search_workers = int(rules.get("solver_workers", 8))
        solver.parameters.randomize_search = True
        solver.parameters.random_seed = random.SystemRandom().randint(1, 2_147_483_647)
        status = solver.solve(model)
        wall_time = float(solver.wall_time)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            diagnostics = diagnose_infeasibility(target_month, db_path)
            causes = [item["message"] for item in diagnostics]
            db.save_schedule(target_month, "infeasible", [], None, wall_time, "\n".join(causes), db_path)
            return {"status": "infeasible", "assignments": [], "summary": {}, "violations": causes,
                    "diagnostics": diagnostics,
                    "objective_value": None, "solver_wall_time": wall_time}

        assignments = []
        for employee in employees:
            eid = employee["employee_id"]
            for day in days:
                assigned = next((code for code in shift_codes if solver.value(x[eid, day, code])), "O")
                assignments.append({"employee_id": eid, "date": day, "shift_code": assigned})
        violations = request_violations(target_month, assignments, db_path)
        warnings = restaurant_warnings(target_month, assignments, db_path)
        objective = float(solver.objective_value)
        schedule_id = db.save_schedule(target_month, "success", assignments, objective, wall_time, "", db_path)
        summary = build_summary(assignments, db_path)
        summary["schedule_id"] = schedule_id
        summary["restaurant_warning_count"] = len(warnings)
        return {"status": "success", "assignments": assignments, "summary": summary,
                "violations": violations, "restaurant_warnings": warnings,
                "diagnostics": [],
                "objective_value": objective, "solver_wall_time": wall_time}
    except Exception as exc:
        return {"status": "error", "assignments": [], "summary": {},
                "violations": [f"処理中にエラーが発生しました: {exc}"],
                "diagnostics": [{"severity": "error", "date": None, "condition": "処理エラー",
                                 "message": f"処理中にエラーが発生しました: {exc}"}],
                "objective_value": None, "solver_wall_time": 0.0}
