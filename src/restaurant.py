from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from . import db

ENGLISH_LEVEL_RANKS = {"none": 0, "basic": 1, "conversational": 2, "fluent": 3}
ENGLISH_LEVELS = {"basic", "conversational", "fluent"}
ENGLISH_LEVEL_LABELS = {
    "none": "対応不要・対応不可",
    "basic": "簡単な接客英語",
    "conversational": "通常接客可能",
    "fluent": "複雑な説明も可能",
}
SKILL_LEVEL_LABELS = {
    0: "未経験",
    1: "補助できる",
    2: "一人で対応できる",
    3: "指導できる",
}
SKILL_LEVEL_OPTIONS = (1, 2, 3)
SKILL_DEFINITIONS = [
    {"code": "english_support", "label": "英語対応", "kind": "english", "field": "english_level"},
    {"code": "cashier", "label": "レジ対応", "kind": "binary", "field": "can_cashier"},
    {"code": "opener", "label": "開店作業", "kind": "binary", "field": "can_open"},
    {"code": "closer", "label": "閉店作業", "kind": "binary", "field": "can_close"},
    {"code": "product_skill_ice", "label": "アイス対応", "kind": "level", "field": "product_skill_ice"},
    {"code": "product_skill_chocolate", "label": "チョコ対応", "kind": "level", "field": "product_skill_chocolate"},
    {"code": "product_skill_cookie", "label": "クッキー対応", "kind": "level", "field": "product_skill_cookie"},
    {"code": "new_product", "label": "新商品対応", "kind": "level", "field": "new_product_skill"},
    {"code": "allergy_support", "label": "アレルギー説明", "kind": "binary", "field": "can_explain_allergy"},
    {"code": "complaint_support", "label": "クレーム対応", "kind": "binary", "field": "can_handle_complaints"},
    {"code": "new_staff", "label": "新人スタッフ（属性）", "kind": "attribute", "field": "is_new_staff"},
    {"code": "trainer", "label": "新人教育", "kind": "binary", "field": "can_train_new_staff"},
    {"code": "cash_manager", "label": "現金管理", "kind": "binary", "field": "can_manage_cash"},
    {"code": "hygiene_checker", "label": "衛生確認", "kind": "binary", "field": "can_hygiene_check"},
    {"code": "peak_support", "label": "ピーク対応", "kind": "level", "field": "peak_support_level"},
]
RELATION_LABELS = {
    "prefer_together": "同時配置を優先",
    "avoid_together": "同時配置を避ける",
    "never_together": "同時配置禁止",
    "mentor_pair": "教育係として組み合わせる",
    "avoid_closing_pair": "閉店作業で組ませない",
    "prefer_peak_pair": "繁忙時に組ませたい",
}
ROLE_LABELS = {
    "manager": "店長・責任者",
    "shift_leader": "時間帯責任者",
    "leader": "責任者・リーダー",
    "cashier": "レジ",
    "product_staff": "商品提供",
    "kitchen_prep": "仕込み・準備",
    "stock_staff": "補充・在庫対応",
    "opener": "開店",
    "closer": "閉店",
    "trainer": "新人教育",
    "english_support": "英語対応",
    "complaint_support": "クレーム対応",
    "hygiene_checker": "衛生確認",
    "new_product": "新商品対応",
    "allergy_support": "アレルギー説明",
    "cash_manager": "レジ締め・現金管理",
    "peak_support": "ピーク対応",
}
CATEGORY_SKILL_COLUMNS = {
    "ice": "product_skill_ice",
    "chocolate": "product_skill_chocolate",
    "cookie": "product_skill_cookie",
}


def english_level_rank(level: str | None) -> int:
    return ENGLISH_LEVEL_RANKS.get(str(level or "none"), 0)


def skill_definition(code: str) -> dict:
    return next(item for item in SKILL_DEFINITIONS if item["code"] == code)


def skill_level_options(code: str) -> list:
    definition = skill_definition(code)
    if definition["kind"] == "english":
        return ["basic", "conversational", "fluent"]
    if definition["kind"] == "level":
        return list(SKILL_LEVEL_OPTIONS)
    return [1]


def skill_level_label(code: str, level) -> str:
    definition = skill_definition(code)
    if definition["kind"] == "english":
        return ENGLISH_LEVEL_LABELS.get(str(level), ENGLISH_LEVEL_LABELS["basic"])
    if definition["kind"] == "binary":
        return "対応可能"
    if definition["kind"] == "attribute":
        return "該当する"
    try:
        return SKILL_LEVEL_LABELS[int(level)]
    except (TypeError, ValueError, KeyError):
        return SKILL_LEVEL_LABELS[1]


def employee_has_skill(employee: dict, skill_code: str, minimum_level=1) -> bool:
    definition = skill_definition(skill_code)
    if definition["kind"] == "english":
        threshold = int(minimum_level) if str(minimum_level).isdigit() else english_level_rank(str(minimum_level))
        return english_level_rank(employee.get(definition["field"])) >= threshold
    if definition["kind"] in {"binary", "attribute"}:
        return bool(employee.get(definition["field"]))
    return int(employee.get(definition["field"], 0)) >= int(minimum_level)


def employee_has_role(employee: dict, role_code: str, *, skill_level: int = 1) -> bool:
    role_text = str(employee.get("role", ""))
    mapping = {
        "english_support": employee_has_skill(employee, "english_support", skill_level),
        "manager": any(word in role_text for word in ("店長", "責任者", "manager")),
        "shift_leader": any(word in role_text for word in ("店長", "責任者", "リーダー", "leader")),
        "leader": any(word in role_text for word in ("店長", "責任者", "リーダー", "manager", "leader")),
        "cashier": employee_has_skill(employee, "cashier"),
        "product_staff": max(int(employee.get("product_skill_ice", 0)),
                             int(employee.get("product_skill_chocolate", 0)),
                             int(employee.get("product_skill_cookie", 0))) >= skill_level,
        "kitchen_prep": any(word in str(employee.get("skills", "")) for word in ("仕込み", "調理", "準備")),
        "stock_staff": any(word in str(employee.get("skills", "")) for word in ("補充", "在庫")),
        "opener": employee_has_skill(employee, "opener"),
        "closer": employee_has_skill(employee, "closer"),
        "new_product": employee_has_skill(employee, "new_product", skill_level),
        "allergy_support": employee_has_skill(employee, "allergy_support"),
        "complaint_support": employee_has_skill(employee, "complaint_support"),
        "trainer": employee_has_skill(employee, "trainer"),
        "hygiene_checker": employee_has_skill(employee, "hygiene_checker"),
        "cash_manager": employee_has_skill(employee, "cash_manager"),
        "peak_support": employee_has_skill(employee, "peak_support", 2),
    }
    return bool(mapping.get(role_code, False))


def campaigns_for_day(day: str, campaigns: list[dict]) -> list[dict]:
    return [c for c in campaigns if str(c["start_date"]) <= day <= str(c["end_date"])]


def restaurant_condition_checks(target_month: str, assignments: list[dict],
                                db_path: str | Path | None = None) -> list[dict]:
    settings = db.get_store_settings(db_path)
    if not settings.get("restaurant_mode"):
        return []
    employees = {e["employee_id"]: e for e in db.fetch_all("employees", db_path) if e["active"]}
    business_days = {r["date"]: r for r in db.fetch_all(
        "business_days", db_path, where="target_month=?", params=(target_month,))}
    campaigns = db.fetch_all("product_campaigns", db_path)
    role_requirements = db.fetch_all(
        "role_requirements", db_path, where="target_month=?", params=(target_month,))
    skill_requirements = {row["skill_code"]: row for row in db.get_store_skill_requirements(db_path)}
    relations = [r for r in db.fetch_all("staff_relations", db_path) if r["active"]]
    requirements = db.fetch_all("requirements", db_path, where="target_month=?", params=(target_month,))
    req_total = defaultdict(int)
    for row in requirements:
        req_total[row["date"]] += int(row["required_count"])

    assigned_by_day = defaultdict(list)
    assigned_by_shift = defaultdict(list)
    shift_for = {}
    for item in assignments:
        shift_for[item["employee_id"], item["date"]] = item["shift_code"]
        if item["shift_code"] != "O":
            assigned_by_day[item["date"]].append(item["employee_id"])
            assigned_by_shift[item["date"], item["shift_code"]].append(item["employee_id"])

    rows: list[dict] = []

    def add(day: str, category: str, passed: bool, detail: str, priority: str = "soft") -> None:
        rows.append({"日付": day, "確認項目": category, "結果": "充足" if passed else "要確認",
                     "優先度": "必須" if priority == "hard" else "できる限り", "内容": detail})

    all_days = sorted({a["date"] for a in assignments})
    for day in all_days:
        info = business_days.get(day, {})
        if info and not info.get("is_open", 1):
            continue
        if req_total.get(day, 0) <= 0 and not info:
            continue
        workers = [employees[eid] for eid in assigned_by_day.get(day, []) if eid in employees]
        english_setting = skill_requirements.get("english_support", {})
        if int(english_setting.get("required_count", 0)) > 0:
            needed = int(english_setting["required_count"])
            count = sum(employee_has_skill(e, "english_support", english_setting.get("minimum_level", "basic")) for e in workers)
            add(day, "英語対応", count >= needed, f"英語対応者 {count}/{needed}人",
                english_setting.get("priority", "hard"))
        allergy_setting = skill_requirements.get("allergy_support", {})
        if int(allergy_setting.get("required_count", 0)) > 0:
            needed = int(allergy_setting["required_count"])
            count = sum(employee_has_skill(e, "allergy_support") for e in workers)
            add(day, "アレルギー説明", count >= needed, f"説明対応者 {count}/{needed}人",
                allergy_setting.get("priority", "soft"))
        active_campaigns = campaigns_for_day(day, campaigns)
        if active_campaigns or info.get("new_product_active"):
            new_product_setting = skill_requirements.get("new_product", {})
            configured_level = int(new_product_setting.get("minimum_level", 1))
            required = max(([int(c.get("required_skill_level", 2)) for c in active_campaigns] or [1])
                           + [configured_level])
            needed = int(new_product_setting.get("required_count", 0))
            count = sum(int(e.get("new_product_skill", 0)) >= required for e in workers)
            names = "、".join(c["product_name"] for c in active_campaigns) or "新商品"
            if needed > 0:
                add(day, "新商品対応", count >= needed, f"{names}: 対応者 {count}/{needed}人",
                    new_product_setting.get("priority", "soft"))
            for campaign in active_campaigns:
                start = date.fromisoformat(str(campaign["start_date"]))
                current = date.fromisoformat(day)
                if campaign.get("require_leader_first_week") and current < start + timedelta(days=7):
                    leader_count = sum(int(e.get("new_product_skill", 0)) >= 3 for e in workers)
                    add(day, "新商品初週", leader_count >= 1,
                        f"{campaign['product_name']}: 指導可能者 {leader_count}/1人", "soft")
                skill_column = CATEGORY_SKILL_COLUMNS.get(campaign.get("category"))
                if skill_column:
                    category_count = sum(int(e.get(skill_column, 0)) >= required for e in workers)
                    add(day, "商品カテゴリ", category_count >= 1,
                        f"{campaign['product_name']}: カテゴリ対応者 {category_count}/1人", "soft")
        for definition in SKILL_DEFINITIONS:
            skill_code = definition["code"]
            if skill_code in {"english_support", "new_product", "allergy_support"}:
                continue
            setting = skill_requirements.get(skill_code, {})
            needed = int(setting.get("required_count", 0))
            if needed <= 0:
                continue
            count = sum(employee_has_skill(e, skill_code, setting.get("minimum_level", 1)) for e in workers)
            add(day, definition["label"], count >= needed, f"対応者 {count}/{needed}人",
                setting.get("priority", "soft"))

    for req in role_requirements:
        members = [employees[eid] for eid in assigned_by_shift.get((req["date"], req["shift_code"]), []) if eid in employees]
        count = sum(employee_has_role(e, req["role_code"]) for e in members)
        needed = int(req["required_count"])
        add(req["date"], "役割配置", count >= needed,
            f"{req['shift_code']}・{ROLE_LABELS.get(req['role_code'], req['role_code'])} {count}/{needed}人",
            req["priority"])

    for (day, shift), ids in sorted(assigned_by_shift.items()):
        if ids and all(bool(employees[eid].get("is_new_staff")) for eid in ids if eid in employees):
            add(day, "新人フォロー", False, f"{shift} が新人スタッフのみです。", "hard")
        if shift == "E":
            count = sum(employee_has_role(employees[eid], "opener") for eid in ids if eid in employees)
            add(day, "開店対応", count >= 1, f"{shift}・開店対応者 {count}/1人", "hard")
        if shift == "L":
            count = sum(employee_has_role(employees[eid], "closer") for eid in ids if eid in employees)
            add(day, "閉店対応", count >= 1, f"{shift}・閉店対応者 {count}/1人", "hard")

    high_days = {d for d, info in business_days.items() if info.get("demand_level") in {"high", "very_high"}}
    for relation in relations:
        e1, e2 = relation["employee_id_1"], relation["employee_id_2"]
        for day in all_days:
            s1, s2 = shift_for.get((e1, day), "O"), shift_for.get((e2, day), "O")
            same = s1 == s2 and s1 != "O"
            both_work = s1 != "O" and s2 != "O"
            either_work = s1 != "O" or s2 != "O"
            rule = relation["relation_type"]
            violated = ((rule in {"avoid_together", "never_together"} and same) or
                        (rule == "avoid_closing_pair" and same and s1 == "L") or
                        (rule in {"prefer_together", "mentor_pair"} and either_work and not both_work) or
                        (rule == "prefer_peak_pair" and day in high_days and either_work and not both_work))
            if violated:
                add(day, "スタッフ配置条件", False,
                    f"{RELATION_LABELS.get(rule, rule)}（{e1}・{e2}）", relation["priority"])
    return rows


def restaurant_warnings(target_month: str, assignments: list[dict],
                        db_path: str | Path | None = None) -> list[str]:
    return [f"{r['日付']}：{r['確認項目']} — {r['内容']}"
            for r in restaurant_condition_checks(target_month, assignments, db_path)
            if r["結果"] == "要確認" and r["優先度"] == "必須"]
