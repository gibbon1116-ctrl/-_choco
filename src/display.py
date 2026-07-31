from __future__ import annotations

from datetime import date, datetime
from typing import Iterable, Mapping

import pandas as pd

from .color_palette import color_name


REQUEST_TYPE_LABELS = {
    "off": "希望休",
    "avoid": "避けたい勤務",
    "prefer": "希望勤務",
    "fixed": "勤務指定",
}

PRIORITY_LABELS = {
    "soft": "できる限り",
    "hard": "必須",
}


def japanese_date(value: str | date | datetime) -> str:
    """Return a compact Japanese date label while tolerating unknown values."""
    try:
        parsed = value if isinstance(value, (date, datetime)) else date.fromisoformat(str(value))
        return f"{parsed.year}年{parsed.month}月{parsed.day}日"
    except (TypeError, ValueError):
        return str(value)


def yes_no(value: object) -> str:
    return "はい" if bool(value) else "いいえ"


def target_status(value: object) -> str:
    return "対象" if bool(value) else "対象外"


def availability(value: object) -> str:
    return "可" if bool(value) else "不可"


def employee_display_frame(employees: Iterable[Mapping]) -> pd.DataFrame:
    rows = [
        {
            "職員名": employee.get("name", ""),
            "職員番号": employee.get("employee_id", ""),
            "役職・区分": employee.get("role", ""),
            "保有スキル": employee.get("skills", ""),
            "勤務表作成対象": target_status(employee.get("active")),
            "夜勤可能": availability(employee.get("night_allowed")),
            "最大連続勤務日数": employee.get("max_consecutive_days", ""),
            "月間最低勤務日数": employee.get("min_work_days", ""),
            "月間最大勤務日数": employee.get("max_work_days", ""),
            "備考": employee.get("note", ""),
        }
        for employee in employees
    ]
    return pd.DataFrame(rows)


def shift_display_frame(shifts: Iterable[Mapping]) -> pd.DataFrame:
    rows = [
        {
            "勤務区分": shift.get("shift_name", ""),
            "勤務扱い": target_status(shift.get("is_work")),
            "開始時刻": shift.get("start_time", ""),
            "終了時刻": shift.get("end_time", ""),
            "翌日休み": target_status(shift.get("requires_rest_next_day")),
            "表示色": color_name(shift.get("color")),
            "備考": shift.get("note", ""),
        }
        for shift in shifts
    ]
    return pd.DataFrame(rows)


def request_display_frame(
    requests: Iterable[Mapping], employees: Iterable[Mapping], shifts: Iterable[Mapping]
) -> pd.DataFrame:
    employee_names = {employee["employee_id"]: employee["name"] for employee in employees}
    shift_names = {shift["shift_code"]: shift["shift_name"] for shift in shifts}
    rows = [
        {
            "職員名": employee_names.get(request.get("employee_id"), "不明な職員"),
            "対象日": japanese_date(request.get("date", "")),
            "希望種別": REQUEST_TYPE_LABELS.get(request.get("request_type"), "不明"),
            "勤務区分": shift_names.get(request.get("shift_code"), "指定なし"),
            "優先度": PRIORITY_LABELS.get(request.get("priority"), "不明"),
            "備考": request.get("note", ""),
        }
        for request in requests
    ]
    return pd.DataFrame(rows)


def violation_display_frame(
    violations: Iterable[Mapping], employees: Iterable[Mapping], shifts: Iterable[Mapping]
) -> pd.DataFrame:
    employee_names = {employee["employee_id"]: employee["name"] for employee in employees}
    shift_names = {shift["shift_code"]: shift["shift_name"] for shift in shifts}
    rows = [
        {
            "職員名": employee_names.get(item.get("employee_id"), "不明な職員"),
            "対象日": japanese_date(item.get("date", "")),
            "希望種別": REQUEST_TYPE_LABELS.get(item.get("request_type"), "不明"),
            "優先度": PRIORITY_LABELS.get(item.get("priority"), "不明"),
            "希望した勤務": shift_names.get(item.get("requested_shift"), "指定なし"),
            "実際の勤務": shift_names.get(item.get("actual_shift"), "指定なし"),
            "備考": item.get("note", ""),
        }
        for item in violations
    ]
    return pd.DataFrame(rows)
