from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Mapping

from . import db
from .calendar_utils import month_dates
from .restaurant import (SKILL_DEFINITIONS, employee_has_role, employee_has_skill,
                         english_level_rank, skill_level_label)


def validate_employee(data: Mapping) -> list[str]:
    errors: list[str] = []
    if not str(data.get("employee_id", "")).strip():
        errors.append("職員IDを入力してください。")
    if not str(data.get("name", "")).strip():
        errors.append("職員名を入力してください。")
    try:
        consecutive = int(data.get("max_consecutive_days", 5))
        minimum = int(data.get("min_work_days", 0))
        maximum = int(data.get("max_work_days", 31))
        if consecutive < 1:
            errors.append("最大連続勤務日数は1以上にしてください。")
        if minimum < 0 or maximum < minimum:
            errors.append("月間勤務日数の下限・上限を確認してください。")
    except (TypeError, ValueError):
        errors.append("勤務日数の項目は整数で入力してください。")
    if str(data.get("english_level", "none")) not in {"none", "basic", "conversational", "fluent"}:
        errors.append("英語レベルの値を確認してください。")
    for field in ("product_skill_ice", "product_skill_chocolate", "product_skill_cookie",
                  "new_product_skill", "peak_support_level"):
        try:
            if int(data.get(field, 0)) not in range(4):
                errors.append(f"{field} は0〜3で入力してください。")
        except (TypeError, ValueError):
            errors.append(f"{field} は整数で入力してください。")
    return errors


def validate_shift_type(data: Mapping) -> list[str]:
    errors = []
    if not str(data.get("shift_code", "")).strip():
        errors.append("勤務区分コードを入力してください。")
    if not str(data.get("shift_name", "")).strip():
        errors.append("勤務区分名を入力してください。")
    color = str(data.get("color", "FFFFFF")).replace("#", "")
    if len(color) != 6 or any(c not in "0123456789ABCDEFabcdef" for c in color):
        errors.append("背景色は6桁の16進数で入力してください。")
    return errors


def precheck(target_month: str, db_path: str | Path | None = None) -> list[dict]:
    issues: list[dict] = []
    try:
        valid_dates = {d.isoformat() for d in month_dates(target_month)}
    except ValueError as exc:
        return [{"severity": "error", "message": str(exc)}]

    employees = db.fetch_all("employees", db_path)
    active = [e for e in employees if e["active"]]
    shifts = db.fetch_all("shift_types", db_path)
    shift_codes = {s["shift_code"] for s in shifts}
    requirements = db.fetch_all("requirements", db_path, where="target_month=?", params=(target_month,))
    requests = db.fetch_all("requests", db_path, where="target_month=?", params=(target_month,))
    employee_ids = {e["employee_id"] for e in employees}

    if not active:
        issues.append({"severity": "error", "message": "勤務対象の職員が登録されていません。"})
    if not requirements:
        issues.append({"severity": "error", "message": f"{target_month} の必要人数が登録されていません。"})

    for req in requirements:
        if req["date"] not in valid_dates:
            issues.append({"severity": "error", "message": f"必要人数の日付 {req['date']} が対象年月外です。"})
        if req["shift_code"] not in shift_codes:
            issues.append({"severity": "error", "message": f"勤務区分 {req['shift_code']} が勤務区分マスタにありません。"})
        if req["required_count"] < 0:
            issues.append({"severity": "error", "message": f"{req['date']} の必要人数が負の値です。"})

    for request in requests:
        if request["employee_id"] not in employee_ids:
            issues.append({"severity": "error", "message": f"希望の職員ID {request['employee_id']} が職員マスタにありません。"})
        if request["date"] not in valid_dates:
            issues.append({"severity": "error", "message": f"希望の日付 {request['date']} が対象年月外です。"})
        if request.get("shift_code") and request["shift_code"] not in shift_codes:
            issues.append({"severity": "error", "message": f"希望の勤務区分 {request['shift_code']} が勤務区分マスタにありません。"})
        if request["request_type"] not in {"off", "avoid", "prefer", "fixed"}:
            issues.append({"severity": "error", "message": f"希望種別 {request['request_type']} は使用できません。"})
        if request["priority"] not in {"hard", "soft"}:
            issues.append({"severity": "error", "message": f"優先度 {request['priority']} は hard または soft にしてください。"})

    hard_by_person_day: dict[tuple[str, str], set[str]] = defaultdict(set)
    for request in requests:
        if request["priority"] != "hard":
            continue
        key = (request["employee_id"], request["date"])
        requested = "O" if request["request_type"] == "off" else (request.get("shift_code") or "O")
        if request["request_type"] in {"off", "fixed"}:
            hard_by_person_day[key].add(requested)
    for (employee_id, day), codes in hard_by_person_day.items():
        if len(codes) > 1:
            issues.append({"severity": "error", "message":
                f"{employee_id} の {day} に矛盾する hard 希望（{', '.join(sorted(codes))}）があります。"})

    hard_off = {(r["employee_id"], r["date"]) for r in requests
                if r["priority"] == "hard" and r["request_type"] == "off"}
    hard_fixed = {(r["employee_id"], r["date"]): r.get("shift_code") for r in requests
                  if r["priority"] == "hard" and r["request_type"] == "fixed"}
    req_by_date: dict[str, list[dict]] = defaultdict(list)
    for req in requirements:
        if req["required_count"]:
            req_by_date[req["date"]].append(req)

    for day, rows in req_by_date.items():
        total = sum(r["required_count"] for r in rows)
        if total > len(active):
            issues.append({"severity": "error", "message": f"{day} は合計 {total} 人必要ですが、勤務対象者は {len(active)} 人です。"})
        for req in rows:
            eligible = []
            for employee in active:
                key = (employee["employee_id"], day)
                if key in hard_off:
                    continue
                if req["shift_code"] == "N" and not employee["night_allowed"]:
                    continue
                fixed = hard_fixed.get(key)
                if fixed and fixed != req["shift_code"]:
                    continue
                eligible.append(employee)
            if req["required_count"] > len(eligible):
                issues.append({"severity": "error", "message":
                    f"{day} の {req['shift_code']} は {req['required_count']} 人必要ですが、割当可能候補は {len(eligible)} 人です。"})

    total_required = sum(r["required_count"] for r in requirements)
    total_capacity = sum(int(e["max_work_days"]) for e in active)
    if total_required > total_capacity:
        issues.append({"severity": "error", "message":
            f"月間必要勤務数 {total_required} が職員の最大勤務日数合計 {total_capacity} を超えています。"})
    settings = db.get_store_settings(db_path)
    if settings.get("restaurant_mode"):
        role_requirements = db.fetch_all(
            "role_requirements", db_path, where="target_month=?", params=(target_month,))
        relations = [r for r in db.fetch_all("staff_relations", db_path) if r["active"]]
        campaigns = db.fetch_all("product_campaigns", db_path)
        business_days = db.fetch_all(
            "business_days", db_path, where="target_month=?", params=(target_month,))

        required_english_level = english_level_rank(settings.get("required_english_level", "basic"))
        english_staff = [e for e in active if employee_has_role(
            e, "english_support", skill_level=required_english_level)]
        if settings.get("require_english") and not english_staff:
            severity = "error" if settings.get("english_priority") == "hard" else "warning"
            issues.append({"severity": severity, "message":
                "店舗設定の最低英語レベルを満たすスタッフが登録されていません。"})
        if settings.get("require_english") and len(english_staff) < int(settings.get("required_english_count", 1)):
            severity = "error" if settings.get("english_priority") == "hard" else "warning"
            issues.append({"severity": severity, "message":
                f"最低英語レベルを満たす対応者は {settings.get('required_english_count', 1)} 人必要ですが、登録は {len(english_staff)} 人です。"})

        skill_requirements = {row["skill_code"]: row for row in db.get_store_skill_requirements(db_path)}
        for definition in SKILL_DEFINITIONS:
            if definition["code"] in {"english_support", "new_product", "allergy_support"}:
                continue
            setting = skill_requirements.get(definition["code"], {})
            needed = int(setting.get("required_count", 0))
            eligible = [e for e in active if employee_has_skill(
                e, definition["code"], setting.get("minimum_level", 1))]
            if setting.get("priority") == "hard" and needed > len(eligible):
                issues.append({"severity": "error", "message":
                    f"{definition['label']}は{skill_level_label(definition['code'], setting.get('minimum_level', 1))}以上が"
                    f"{needed} 人必要ですが、対応可能者は {len(eligible)} 人です。"})

        openers = [e for e in active if employee_has_role(e, "opener")]
        closers = [e for e in active if employee_has_role(e, "closer")]
        if any(r["shift_code"] == "E" and r["required_count"] > 0 for r in requirements) and not openers:
            issues.append({"severity": "error", "message": "早番が必要ですが、開店作業可能なスタッフがいません。"})
        if any(r["shift_code"] == "L" and r["required_count"] > 0 for r in requirements) and not closers:
            issues.append({"severity": "error", "message": "遅番が必要ですが、閉店作業可能なスタッフがいません。"})
        if active and all(e.get("is_new_staff") for e in active) and any(r["required_count"] > 0 for r in requirements):
            issues.append({"severity": "error", "message": "勤務対象者が全員新人のため、新人だけの勤務を回避できません。"})

        if settings.get("require_allergy") and not any(employee_has_role(e, "allergy_support") for e in active):
            severity = "error" if settings.get("allergy_priority") == "hard" else "warning"
            issues.append({"severity": severity, "message": "アレルギー説明対応可能なスタッフが登録されていません。"})
        if any(r.get("demand_level") in {"high", "very_high"} for r in business_days) and not any(
                employee_has_role(e, "peak_support") for e in active):
            issues.append({"severity": "warning", "message": "繁忙日がありますが、ピーク対応力2以上のスタッフがいません。"})
        totals_by_day = defaultdict(int)
        for requirement in requirements:
            totals_by_day[requirement["date"]] += int(requirement["required_count"])
        for business_day in business_days:
            if business_day.get("demand_level") not in {"high", "very_high"}:
                continue
            day_value = date.fromisoformat(business_day["date"])
            standard = int(settings.get("weekend_required" if day_value.weekday() >= 5 else "weekday_required", 0))
            if standard and totals_by_day.get(business_day["date"], 0) < standard:
                issues.append({"severity": "warning", "message":
                    f"{business_day['date']} は繁忙日ですが、必要人数合計 {totals_by_day.get(business_day['date'], 0)} 人が店舗標準 {standard} 人を下回っています。"})

        for campaign in campaigns:
            if str(campaign["end_date"]) < f"{target_month}-01" or str(campaign["start_date"]) > f"{target_month}-31":
                continue
            skilled = [e for e in active if int(e.get("new_product_skill", 0)) >= int(campaign["required_skill_level"])]
            required_new_product_count = max(1, int(settings.get("required_new_product_count", 1)))
            if len(skilled) < required_new_product_count:
                severity = "error" if (settings.get("require_new_product") and
                                         settings.get("new_product_priority") == "hard") else "warning"
                issues.append({"severity": severity, "message":
                    f"新商品「{campaign['product_name']}」に必要な能力のスタッフが {required_new_product_count} 人必要ですが、登録は {len(skilled)} 人です。"})

        for req in role_requirements:
            if req["date"] not in valid_dates:
                issues.append({"severity": "error", "message": f"役割別必要人数の日付 {req['date']} が対象年月外です。"})
                continue
            if req["shift_code"] not in shift_codes:
                issues.append({"severity": "error", "message": f"役割条件の勤務区分 {req['shift_code']} がマスタにありません。"})
                continue
            eligible = [e for e in active if employee_has_role(e, req["role_code"])]
            if req["priority"] == "hard" and int(req["required_count"]) > len(eligible):
                issues.append({"severity": "error", "message":
                    f"{req['date']} {req['shift_code']} の役割 {req['role_code']} は {req['required_count']} 人必要ですが、対応可能者は {len(eligible)} 人です。"})

        fixed_lookup = {(r["employee_id"], r["date"]): r.get("shift_code") for r in requests
                        if r["priority"] == "hard" and r["request_type"] == "fixed"}
        for relation in relations:
            if relation["employee_id_1"] == relation["employee_id_2"]:
                issues.append({"severity": "error", "message": "スタッフ配置条件に同じスタッフ同士の組み合わせがあります。"})
            if relation["relation_type"] == "never_together" and relation["priority"] == "hard":
                for day in valid_dates:
                    s1 = fixed_lookup.get((relation["employee_id_1"], day))
                    s2 = fixed_lookup.get((relation["employee_id_2"], day))
                    if s1 and s1 == s2:
                        issues.append({"severity": "error", "message":
                            f"{day} の同時配置禁止と必須の勤務指定が矛盾しています（{relation['employee_id_1']}・{relation['employee_id_2']}）。"})
                        break
    if not any(i["severity"] == "error" for i in issues):
        issues.append({"severity": "info", "message": "事前チェックで明らかな矛盾は見つかりませんでした。"})
    return issues


def blocking_issues(issues: list[dict]) -> list[str]:
    return [i["message"] for i in issues if i["severity"] == "error"]


def diagnose_infeasibility(target_month: str, db_path: str | Path | None = None) -> list[dict]:
    """Explain likely date/condition conflicts after the solver reports no solution.

    CP-SAT does not expose a friendly unsat explanation for this model.  Keep the
    existing precheck messages, then add the deterministic conflicts that can
    still slip through precheck (for example a hard fixed shift whose required
    count is zero, or an employee's minimum days being impossible after hard
    days off).
    """
    diagnostics: list[dict] = []
    seen: set[str] = set()

    def add(message: str, *, day: str | None = None, condition: str = "") -> None:
        if message in seen:
            return
        seen.add(message)
        diagnostics.append({"severity": "error", "date": day, "condition": condition, "message": message})

    # Preserve the existing validation details, including messages that already
    # identify a specific date, while giving the UI a consistent shape.
    for issue in precheck(target_month, db_path):
        if issue["severity"] != "error":
            continue
        message = issue["message"]
        day = next((token for token in message.split() if len(token) == 10 and token[4] == "-" and token[7] == "-"), None)
        add(message, day=day, condition="事前チェック")

    try:
        days = [d.isoformat() for d in month_dates(target_month)]
    except ValueError:
        return diagnostics

    active = [e for e in db.fetch_all("employees", db_path) if e["active"]]
    shifts = db.fetch_all("shift_types", db_path)
    work_shifts = [s for s in shifts if s["is_work"]]
    shift_codes = {s["shift_code"] for s in work_shifts}
    rest_codes = {s["shift_code"] for s in work_shifts if s["requires_rest_next_day"]}
    requirements = db.fetch_all("requirements", db_path, where="target_month=?", params=(target_month,))
    requests = db.fetch_all("requests", db_path, where="target_month=?", params=(target_month,))
    req_map = {(r["date"], r["shift_code"]): int(r["required_count"]) for r in requirements}
    hard_off = {(r["employee_id"], r["date"]) for r in requests
                if r["priority"] == "hard" and r["request_type"] == "off"}
    hard_fixed = {(r["employee_id"], r["date"]): r.get("shift_code")
                  for r in requests if r["priority"] == "hard" and r["request_type"] == "fixed"}

    for employee in active:
        eid = employee["employee_id"]
        name = employee.get("name") or eid
        available = len(days) - sum((eid, day) in hard_off for day in days)
        minimum = int(employee.get("min_work_days", 0))
        maximum = min(int(employee.get("max_work_days", len(days))), len(days))
        if minimum > available:
            add(f"{name}（{eid}）は最低 {minimum} 日勤務ですが、hard の休み希望を除くと勤務可能日は {available} 日です。",
                condition="月間最低勤務日数とhard休み希望")
        if minimum > maximum:
            add(f"{name}（{eid}）の最低勤務日数 {minimum} 日が最大勤務日数 {maximum} 日を超えています。",
                condition="月間勤務日数の上下限")

        fixed_days = sorted(day for (fixed_eid, day), code in hard_fixed.items()
                            if fixed_eid == eid and code in shift_codes)
        max_consecutive = max(1, int(employee.get("max_consecutive_days", 1)))
        run_start = run_end = None
        for day in fixed_days + [None]:
            contiguous = run_end and day and date.fromisoformat(day) == date.fromisoformat(run_end) + timedelta(days=1)
            if day and (run_end is None or contiguous):
                run_start = run_start or day
                run_end = day
                continue
            if run_start and run_end and (date.fromisoformat(run_end) - date.fromisoformat(run_start)).days + 1 > max_consecutive:
                add(f"{name}（{eid}）は {run_start}〜{run_end} に hard の勤務指定が連続しており、最大連続勤務 {max_consecutive} 日を超えています。",
                    day=f"{run_start}〜{run_end}", condition="最大連続勤務日数")
            run_start = run_end = day

        for (fixed_eid, day), code in hard_fixed.items():
            if fixed_eid != eid or day not in days or code not in shift_codes:
                continue
            if req_map.get((day, code), 0) == 0:
                add(f"{day} は {code} の必要人数が 0 人ですが、{name}（{eid}）に hard の {code} 勤務指定があります。",
                    day=day, condition="hard勤務指定と必要人数")
            if code == "N" and not employee.get("night_allowed"):
                add(f"{day} は夜勤指定ですが、{name}（{eid}）は夜勤不可に設定されています。",
                    day=day, condition="夜勤可否とhard勤務指定")
            if code in rest_codes:
                next_day = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
                next_code = hard_fixed.get((eid, next_day))
                if next_code and next_code != "O":
                    add(f"{day} の {code} は翌日休みが必要ですが、{next_day} に hard の {next_code} 勤務指定があります。",
                        day=f"{day}・{next_day}", condition="勤務区分の翌日休み")

    total_required = sum(max(0, count) for count in req_map.values())
    total_minimum = sum(max(0, int(e.get("min_work_days", 0))) for e in active)
    if total_minimum > total_required:
        add(f"職員の最低勤務日数合計 {total_minimum} 日に対して、必要勤務数は {total_required} 日です。",
            condition="全職員の最低勤務日数と必要人数")

    settings = db.get_store_settings(db_path)
    if settings.get("restaurant_mode"):
        business_days = {r["date"]: r for r in db.fetch_all(
            "business_days", db_path, where="target_month=?", params=(target_month,))}
        open_days = [day for day in days if sum(req_map.get((day, code), 0) for code in shift_codes) > 0
                     and business_days.get(day, {}).get("is_open", 1)]
        if settings.get("require_english") and settings.get("english_priority") == "hard":
            required_level = english_level_rank(settings.get("required_english_level", "basic"))
            eligible = [e for e in active if employee_has_role(
                e, "english_support", skill_level=required_level)]
            needed = max(1, int(settings.get("required_english_count", 1)))
            for day in open_days:
                if settings.get("require_english_per_shift"):
                    for code in shift_codes:
                        if req_map.get((day, code), 0) and len(eligible) < needed:
                            add(f"{day} の {code} は英語対応者が {needed} 人必要ですが、候補者は {len(eligible)} 人です。",
                                day=day, condition="英語対応者の必要人数")
                elif len(eligible) < needed:
                    add(f"{day} は英語対応者が {needed} 人必要ですが、候補者は {len(eligible)} 人です。",
                        day=day, condition="英語対応者の必要人数")

        role_requirements = db.fetch_all("role_requirements", db_path, where="target_month=?", params=(target_month,))
        role_names = {"opener": "開店作業", "closer": "閉店作業", "english_support": "英語対応",
                      "allergy_support": "アレルギー説明", "peak_support": "ピーク対応"}
        for req in role_requirements:
            if req["priority"] != "hard" or req["date"] not in days or req["shift_code"] not in shift_codes:
                continue
            eligible = [e for e in active if employee_has_role(e, req["role_code"])]
            if int(req["required_count"]) > len(eligible):
                label = role_names.get(req["role_code"], req["role_code"])
                add(f"{req['date']} の {req['shift_code']} は {label} が {req['required_count']} 人必要ですが、候補者は {len(eligible)} 人です。",
                    day=req["date"], condition=f"役割別必要人数（{label}）")

    if not diagnostics:
        add("日付ごとの必要人数、hard希望、勤務日数、役割条件などの組み合わせが解なしになっています。条件を1つずつ緩和して再作成してください。",
            condition="複数条件の組み合わせ")
    return diagnostics


