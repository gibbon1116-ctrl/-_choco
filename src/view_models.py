"""View-model builder: DB data → UI display structures.

This module transforms raw DB data into a dictionary structure
optimised for the dashboard HTML table renderer.
No Streamlit imports – pure data transformation only.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from . import db
from .calendar_utils import month_dates, weekday_label, is_weekend
from .reports import request_violations


def build_schedule_view_model(
    target_month: str,
    assignments: list[dict],
    db_path: str | Path | None = None,
) -> dict:
    """Return a dict consumed by *ui_components.render_schedule_table*.

    Keys
    ----
    dates : list[dict]   – per-day metadata
    summary : dict       – required / assigned / diff per date-key
    staff_rows : list[dict] – per-employee row data
    shift_map : dict     – shift_code → {shift_name, start_time, end_time, color, is_work}
    """

    # ── Date metadata ──────────────────────────────────────────────
    all_days = month_dates(target_month)
    business_days = {row["date"]: row for row in db.fetch_all(
        "business_days", db_path, where="target_month=?", params=(target_month,))}
    campaigns = db.fetch_all("product_campaigns", db_path)
    dates: list[dict] = []
    for d in all_days:
        wd = d.weekday()  # 0=Mon … 6=Sun
        day_key = d.isoformat()
        info = business_days.get(day_key, {})
        active_campaigns = [c for c in campaigns if str(c["start_date"]) <= day_key <= str(c["end_date"])]
        event_label = info.get("event_name", "") if info.get("is_event_day") else ""
        if active_campaigns and not event_label:
            event_label = "新商品"
        dates.append({
            "date": day_key,
            "day": d.day,
            "weekday": weekday_label(d),
            "is_saturday": wd == 5,
            "is_sunday": wd == 6,
            "event_label": event_label,
            "is_event": bool(event_label),
        })

    # ── Shift-type look-up ─────────────────────────────────────────
    shifts = db.fetch_all("shift_types", db_path)
    shift_map: dict[str, dict] = {}
    for s in shifts:
        shift_map[s["shift_code"]] = {
            "shift_name": s["shift_name"],
            "start_time": s.get("start_time") or "",
            "end_time": s.get("end_time") or "",
            "color": "#" + (s.get("color") or "FFFFFF").replace("#", ""),
            "is_work": bool(s.get("is_work", 1)),
        }

    # ── Employees ──────────────────────────────────────────────────
    employees = [e for e in db.fetch_all("employees", db_path) if e["active"]]
    employee_map = {e["employee_id"]: e for e in employees}

    # ── Assignment look-up ─────────────────────────────────────────
    assignment_map: dict[tuple[str, str], str] = {
        (a["employee_id"], a["date"]): a["shift_code"] for a in assignments
    }

    # ── Request look-up ────────────────────────────────────────────
    requests = db.fetch_all("requests", db_path,
                            where="target_month=?", params=(target_month,))
    request_map: dict[tuple[str, str], dict] = {
        (r["employee_id"], r["date"]): r for r in requests
    }

    # ── Violations set ─────────────────────────────────────────────
    violations = request_violations(target_month, assignments, db_path)
    violation_set: set[tuple[str, str]] = {
        (v["employee_id"], v["date"]) for v in violations
    }

    # ── Requirements → summary rows ────────────────────────────────
    requirements = db.fetch_all("requirements", db_path,
                                where="target_month=?", params=(target_month,))
    required_totals: dict[str, int] = {}
    for r in requirements:
        required_totals[r["date"]] = required_totals.get(r["date"], 0) + int(r["required_count"])

    assigned_totals: dict[str, int] = {}
    for d_info in dates:
        dk = d_info["date"]
        count = sum(
            1 for e in employees
            if assignment_map.get((e["employee_id"], dk), "O") != "O"
        )
        assigned_totals[dk] = count

    diff_totals: dict[str, int] = {
        dk: assigned_totals.get(dk, 0) - required_totals.get(dk, 0)
        for dk in [d["date"] for d in dates]
    }

    summary = {
        "required": required_totals,
        "assigned": assigned_totals,
        "diff": diff_totals,
    }

    # ── Staff rows ─────────────────────────────────────────────────
    staff_rows: list[dict] = []
    for emp in employees:
        eid = emp["employee_id"]
        cells: dict[str, dict] = {}
        for d_info in dates:
            dk = d_info["date"]
            code = assignment_map.get((eid, dk), "O")
            si = shift_map.get(code, shift_map.get("O", {}))
            req = request_map.get((eid, dk))
            skill_badges = []
            if code != "O":
                if emp.get("english_level") in {"basic", "conversational", "fluent"}: skill_badges.append("EN")
                if int(emp.get("new_product_skill", 0)) >= 2: skill_badges.append("新")
                if emp.get("can_cashier"): skill_badges.append("レジ")
                if emp.get("can_open"): skill_badges.append("開")
                if emp.get("can_close"): skill_badges.append("閉")
                if emp.get("can_train_new_staff"): skill_badges.append("教")
                if emp.get("can_hygiene_check"): skill_badges.append("衛")
                if emp.get("can_explain_allergy"): skill_badges.append("ア")
            cells[dk] = {
                "shift_code": code,
                "shift_name": si.get("shift_name", code),
                "start_time": si.get("start_time", ""),
                "end_time": si.get("end_time", ""),
                "color": si.get("color", "#FFFFFF"),
                "is_work": si.get("is_work", False),
                "request_type": req["request_type"] if req else None,
                "request_priority": req.get("priority") if req else None,
                "request_violated": (eid, dk) in violation_set,
                "skill_badges": skill_badges,
            }
        staff_rows.append({
            "employee_id": eid,
            "name": emp["name"],
            "role": emp.get("role") or "",
            "night_allowed": bool(emp.get("night_allowed", 1)),
            "cells": cells,
        })

    return {
        "dates": dates,
        "summary": summary,
        "staff_rows": staff_rows,
        "shift_map": shift_map,
    }
