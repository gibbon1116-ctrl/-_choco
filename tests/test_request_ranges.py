from datetime import date

import pytest

from src import db
from src.validators import precheck


def _request(request_type="fixed", shift_code="D"):
    return {
        "target_month": "2026-08",
        "employee_id": "E001",
        "request_type": request_type,
        "shift_code": shift_code,
        "priority": "hard",
        "note": "連続希望",
    }


def test_add_request_range_includes_both_endpoints(tmp_path):
    database = tmp_path / "range.sqlite"
    db.init_db(database)

    count = db.add_request_range(_request(), date(2026, 8, 1), date(2026, 8, 3), database)

    rows = db.fetch_all("requests", database, where="target_month=?", params=("2026-08",))
    assert count == 3
    assert [row["date"] for row in rows] == ["2026-08-01", "2026-08-02", "2026-08-03"]
    assert {row["shift_code"] for row in rows} == {"D"}
    assert {row["note"] for row in rows} == {"連続希望"}


@pytest.mark.parametrize(("request_type", "shift_code"), [
    ("off", "O"),
    ("prefer", "E"),
    ("fixed", "D"),
    ("avoid", "L"),
])
def test_add_request_range_preserves_request_type_and_shift_code(tmp_path, request_type, shift_code):
    database = tmp_path / "types.sqlite"
    db.init_db(database)

    count = db.add_request_range(_request(request_type, shift_code), date(2026, 8, 31), date(2026, 8, 31), database)

    rows = db.fetch_all("requests", database, where="target_month=?", params=("2026-08",))
    assert count == 1
    assert rows[0]["date"] == "2026-08-31"
    assert rows[0]["request_type"] == request_type
    assert rows[0]["shift_code"] == shift_code


def test_add_request_range_rejects_end_before_start(tmp_path):
    database = tmp_path / "invalid.sqlite"
    db.init_db(database)

    with pytest.raises(ValueError, match="終了日は開始日以降"):
        db.add_request_range(_request(), date(2026, 8, 3), date(2026, 8, 1), database)

    assert db.fetch_all("requests", database, where="target_month=?", params=("2026-08",)) == []


def test_add_request_range_rejects_dates_outside_target_month(tmp_path):
    database = tmp_path / "outside.sqlite"
    db.init_db(database)

    with pytest.raises(ValueError, match="対象年月内"):
        db.add_request_range(_request(), date(2026, 8, 31), date(2026, 9, 1), database)

    assert db.fetch_all("requests", database, where="target_month=?", params=("2026-08",)) == []


def test_add_request_range_keeps_existing_requests_and_precheck_detects_conflict(tmp_path):
    database = tmp_path / "conflict.sqlite"
    db.init_db(database)
    db.upsert_employee({
        "employee_id": "E001",
        "name": "テスト",
        "active": True,
        "night_allowed": True,
        "max_consecutive_days": 5,
        "min_work_days": 0,
        "max_work_days": 22,
    }, database)
    db.replace_requirements("2026-08", [{"date": "2026-08-01", "shift_code": "D", "required_count": 0}], database)
    db.add_request({
        "target_month": "2026-08",
        "employee_id": "E001",
        "date": "2026-08-01",
        "request_type": "off",
        "shift_code": "O",
        "priority": "hard",
        "note": "既存希望",
    }, database)

    db.add_request_range(_request("fixed", "D"), date(2026, 8, 1), date(2026, 8, 2), database)

    rows_on_first = db.fetch_all("requests", database, where="target_month=? AND employee_id=? AND date=?",
                                 params=("2026-08", "E001", "2026-08-01"))
    assert len(rows_on_first) == 2
    messages = [issue["message"] for issue in precheck("2026-08", database)]
    assert any("矛盾する hard 希望" in message for message in messages)