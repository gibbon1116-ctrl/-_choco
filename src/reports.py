from __future__ import annotations

from pathlib import Path

import pandas as pd

from . import db
from .calendar_utils import is_weekend


def assignment_frame(assignments: list[dict], db_path: str | Path | None = None) -> pd.DataFrame:
    frame = pd.DataFrame(assignments, columns=["employee_id", "date", "shift_code"])
    if frame.empty:
        return frame
    names = pd.DataFrame(db.fetch_all("employees", db_path))[["employee_id", "name"]]
    return frame.merge(names, on="employee_id", how="left")


def schedule_matrix(assignments: list[dict], db_path: str | Path | None = None) -> pd.DataFrame:
    frame = assignment_frame(assignments, db_path)
    if frame.empty:
        return pd.DataFrame()
    matrix = frame.pivot(index="name", columns="date", values="shift_code").fillna("O")
    matrix.index.name = "職員名"
    return matrix


def employee_summary(assignments: list[dict], db_path: str | Path | None = None) -> pd.DataFrame:
    frame = assignment_frame(assignments, db_path)
    if frame.empty:
        return pd.DataFrame(columns=["職員名", "勤務日数", "夜勤回数", "土日勤務"])
    frame["is_work"] = frame["shift_code"] != "O"
    frame["is_night"] = frame["shift_code"] == "N"
    frame["is_weekend_work"] = frame.apply(lambda r: bool(r["is_work"] and is_weekend(r["date"])), axis=1)
    result = frame.groupby(["employee_id", "name"], as_index=False).agg(
        勤務日数=("is_work", "sum"), 夜勤回数=("is_night", "sum"), 土日勤務=("is_weekend_work", "sum"))
    return result.rename(columns={"name": "職員名"})[["employee_id", "職員名", "勤務日数", "夜勤回数", "土日勤務"]]


def shift_summary(assignments: list[dict], db_path: str | Path | None = None) -> pd.DataFrame:
    frame = assignment_frame(assignments, db_path)
    if frame.empty:
        return pd.DataFrame(columns=["勤務区分", "回数"])
    shifts = pd.DataFrame(db.fetch_all("shift_types", db_path))[["shift_code", "shift_name"]]
    result = frame.groupby("shift_code").size().rename("回数").reset_index().merge(shifts, on="shift_code", how="left")
    return result.rename(columns={"shift_code": "コード", "shift_name": "勤務区分"})[["コード", "勤務区分", "回数"]]


def request_violations(target_month: str, assignments: list[dict], db_path: str | Path | None = None) -> list[dict]:
    assigned = {(a["employee_id"], a["date"]): a["shift_code"] for a in assignments}
    violations = []
    for request in db.fetch_all("requests", db_path, where="target_month=?", params=(target_month,)):
        actual = assigned.get((request["employee_id"], request["date"]), "O")
        expected = request.get("shift_code") or "O"
        violated = ((request["request_type"] == "off" and actual != "O") or
                    (request["request_type"] == "avoid" and actual == expected) or
                    (request["request_type"] in {"prefer", "fixed"} and actual != expected))
        if violated:
            violations.append({"employee_id": request["employee_id"], "date": request["date"],
                "request_type": request["request_type"], "priority": request["priority"],
                "requested_shift": expected, "actual_shift": actual, "note": request.get("note", "")})
    return violations


def build_summary(assignments: list[dict], db_path: str | Path | None = None) -> dict:
    staff = employee_summary(assignments, db_path)
    return {"employee_count": int(len(staff)), "total_work_days": int(staff["勤務日数"].sum()) if not staff.empty else 0,
            "total_nights": int(staff["夜勤回数"].sum()) if not staff.empty else 0,
            "total_weekend_work": int(staff["土日勤務"].sum()) if not staff.empty else 0}

