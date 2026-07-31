from __future__ import annotations

import calendar
from datetime import date, datetime

WEEKDAYS_JA = ("月", "火", "水", "木", "金", "土", "日")


def parse_target_month(target_month: str) -> tuple[int, int]:
    try:
        parsed = datetime.strptime(target_month, "%Y-%m")
    except ValueError as exc:
        raise ValueError("対象年月は YYYY-MM 形式で指定してください。") from exc
    return parsed.year, parsed.month


def month_dates(target_month: str) -> list[date]:
    year, month = parse_target_month(target_month)
    return [date(year, month, day) for day in range(1, calendar.monthrange(year, month)[1] + 1)]


def is_weekend(value: date | str) -> bool:
    if isinstance(value, str):
        value = date.fromisoformat(value)
    return value.weekday() >= 5


def weekday_label(value: date | str) -> str:
    if isinstance(value, str):
        value = date.fromisoformat(value)
    return WEEKDAYS_JA[value.weekday()]


def display_date(value: date | str) -> str:
    if isinstance(value, str):
        value = date.fromisoformat(value)
    return f"{value.month}/{value.day} ({weekday_label(value)})"
