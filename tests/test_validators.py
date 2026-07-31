from src import db
from src.color_palette import SHIFT_COLOR_PALETTE, color_name
from src.display import shift_display_frame
from src.validators import precheck, validate_employee, validate_shift_type


def test_employee_requires_id_and_name():
    errors = validate_employee({"employee_id": "", "name": ""})
    assert any("職員ID" in error for error in errors)
    assert any("職員名" in error for error in errors)


def test_employee_rejects_invalid_day_range():
    errors = validate_employee({"employee_id": "E001", "name": "テスト",
                                "max_consecutive_days": 0, "min_work_days": 20, "max_work_days": 10})
    assert len(errors) == 2


def test_shift_color_must_be_hex():
    assert validate_shift_type({"shift_code": "D", "shift_name": "日勤", "color": "DCE9FF"}) == []
    assert validate_shift_type({"shift_code": "D", "shift_name": "日勤", "color": "blue"})


def test_shift_colors_use_japanese_palette_labels():
    assert len(SHIFT_COLOR_PALETTE) == 20
    assert len(set(SHIFT_COLOR_PALETTE.values())) == 20
    assert color_name("#DCE9FF") == "薄い青"
    frame = shift_display_frame([
        {"color": "DDF4E4"},
        {"color": "123456"},
    ])
    assert frame["表示色"].tolist() == ["薄い緑", "その他"]


def test_precheck_rejects_conflicting_hard_requests(tmp_path):
    database = tmp_path / "conflict.sqlite"
    db.init_db(database)
    db.upsert_employee({"employee_id": "E001", "name": "テスト", "active": True,
                        "night_allowed": True, "max_consecutive_days": 5,
                        "min_work_days": 0, "max_work_days": 22}, database)
    db.replace_requirements("2026-08", [{"date": "2026-08-01", "shift_code": "D", "required_count": 0}], database)
    for request_type, shift_code in (("off", "O"), ("fixed", "D")):
        db.add_request({"target_month": "2026-08", "employee_id": "E001", "date": "2026-08-01",
                        "request_type": request_type, "shift_code": shift_code,
                        "priority": "hard", "note": ""}, database)
    messages = [issue["message"] for issue in precheck("2026-08", database)]
    assert any("矛盾する hard 希望" in message for message in messages)
