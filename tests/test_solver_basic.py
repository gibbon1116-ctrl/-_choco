from src import db
from src.solver import generate_schedule
from src.validators import diagnose_infeasibility


def test_solver_creates_basic_schedule(tmp_path):
    database = tmp_path / "test.sqlite"
    db.init_db(database)
    for employee_id, name in (("E001", "山田"), ("E002", "佐藤")):
        db.upsert_employee({"employee_id": employee_id, "name": name, "active": True,
                            "night_allowed": True, "max_consecutive_days": 5,
                            "min_work_days": 0, "max_work_days": 22}, database)
    db.replace_requirements("2026-08", [{"date": "2026-08-01", "shift_code": "D", "required_count": 1}], database)
    result = generate_schedule("2026-08", 10, database)
    assert result["status"] == "success"
    assert sum(a["shift_code"] == "D" and a["date"] == "2026-08-01" for a in result["assignments"]) == 1
    assert all(a["shift_code"] == "O" for a in result["assignments"] if a["date"] != "2026-08-01")


def test_precheck_blocks_night_without_eligible_staff(tmp_path):
    database = tmp_path / "night.sqlite"
    db.init_db(database)
    db.upsert_employee({"employee_id": "E001", "name": "夜勤不可", "active": True,
                        "night_allowed": False, "max_consecutive_days": 5,
                        "min_work_days": 0, "max_work_days": 22}, database)
    db.replace_requirements("2026-08", [{"date": "2026-08-01", "shift_code": "N", "required_count": 1}], database)
    result = generate_schedule("2026-08", 5, database)
    assert result["status"] == "error"
    assert any("割当可能候補" in message for message in result["violations"])


def test_infeasible_result_reports_date_and_condition(tmp_path):
    database = tmp_path / "infeasible_detail.sqlite"
    db.init_db(database)
    db.upsert_employee({"employee_id": "E001", "name": "指定職員", "active": True,
                        "night_allowed": True, "max_consecutive_days": 5,
                        "min_work_days": 0, "max_work_days": 22}, database)
    db.replace_requirements("2026-08", [{"date": "2026-08-01", "shift_code": "D", "required_count": 0}], database)
    db.add_request({"target_month": "2026-08", "employee_id": "E001", "date": "2026-08-01",
                    "request_type": "fixed", "shift_code": "D", "priority": "hard", "note": ""}, database)

    result = generate_schedule("2026-08", 5, database)

    assert result["status"] == "infeasible"
    assert any(item["date"] == "2026-08-01" and item["condition"] == "hard勤務指定と必要人数"
               for item in result["diagnostics"])


def test_diagnose_infeasibility_works_in_restaurant_mode(tmp_path):
    database = tmp_path / "restaurant_infeasible_detail.sqlite"
    db.init_db(database)
    db.upsert_employee({"employee_id": "E001", "name": "店舗スタッフ", "active": True,
                        "night_allowed": True, "max_consecutive_days": 5,
                        "min_work_days": 0, "max_work_days": 22}, database)
    db.replace_requirements("2026-08", [{"date": "2026-08-01", "shift_code": "D", "required_count": 1}], database)
    settings = db.get_store_settings(database)
    settings.update({"restaurant_mode": True, "require_english": False,
                     "require_new_product": False, "require_allergy": False})
    db.save_store_settings(settings, database)

    diagnostics = diagnose_infeasibility("2026-08", database)

    assert diagnostics


def test_solver_balances_workdays_and_shift_types(tmp_path):
    database = tmp_path / "balanced_schedule.sqlite"
    db.init_db(database)
    for employee_id, name in (("E001", "山田"), ("E002", "佐藤"), ("E003", "鈴木")):
        db.upsert_employee({"employee_id": employee_id, "name": name, "active": True,
                            "night_allowed": True, "max_consecutive_days": 31,
                            "min_work_days": 0, "max_work_days": 31}, database)
    requirements = []
    for day in ("2026-08-01", "2026-08-02", "2026-08-03"):
        for code in ("E", "D", "L"):
            requirements.append({"date": day, "shift_code": code, "required_count": 1})
    db.replace_requirements("2026-08", requirements, database)

    result = generate_schedule("2026-08", 10, database)

    assert result["status"] == "success"
    by_employee = {employee_id: {"work": 0, "E": 0, "D": 0, "L": 0}
                   for employee_id in ("E001", "E002", "E003")}
    for assignment in result["assignments"]:
        if assignment["shift_code"] in {"E", "D", "L"}:
            totals = by_employee[assignment["employee_id"]]
            totals["work"] += 1
            totals[assignment["shift_code"]] += 1

    assert {totals["work"] for totals in by_employee.values()} == {3}
    assert all(totals["E"] == 1 and totals["D"] == 1 and totals["L"] == 1
               for totals in by_employee.values())
