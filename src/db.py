from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable, Iterator, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / "data" / "shift_scheduler.sqlite"

INITIAL_SHIFTS = [
    ("D", "日勤", 1, "09:00", "18:00", 0, "DCE9FF", ""),
    ("E", "早番", 1, "07:00", "16:00", 0, "DDF4E4", ""),
    ("L", "遅番", 1, "12:00", "21:00", 0, "FFE8CC", ""),
    ("N", "夜勤", 1, "21:00", "07:00", 1, "E8DDF8", "翌日は休み"),
    ("O", "休み", 0, "", "", 0, "E9ECEF", ""),
]

EMPLOYEE_RESTAURANT_COLUMNS = {
    "english_level": "TEXT DEFAULT 'none'",
    "can_cashier": "INTEGER DEFAULT 0",
    "can_open": "INTEGER DEFAULT 0",
    "can_close": "INTEGER DEFAULT 0",
    "can_handle_complaints": "INTEGER DEFAULT 0",
    "can_explain_allergy": "INTEGER DEFAULT 0",
    "is_new_staff": "INTEGER DEFAULT 0",
    "can_train_new_staff": "INTEGER DEFAULT 0",
    "product_skill_ice": "INTEGER DEFAULT 0",
    "product_skill_chocolate": "INTEGER DEFAULT 0",
    "product_skill_cookie": "INTEGER DEFAULT 0",
    "new_product_skill": "INTEGER DEFAULT 0",
    "can_manage_cash": "INTEGER DEFAULT 0",
    "can_hygiene_check": "INTEGER DEFAULT 0",
    "peak_support_level": "INTEGER DEFAULT 0",
}

STORE_RESTAURANT_COLUMNS = {
    "required_english_level": "TEXT DEFAULT 'basic'",
    "required_new_product_count": "INTEGER DEFAULT 1",
    "required_allergy_count": "INTEGER DEFAULT 1",
}
STORE_SKILL_CODES = (
    "english_support", "cashier", "opener", "closer", "product_skill_ice",
    "product_skill_chocolate", "product_skill_cookie", "new_product",
    "allergy_support", "complaint_support", "new_staff", "trainer", "cash_manager",
    "hygiene_checker", "peak_support",
)

ALLOWED_TABLES = {
    "employees", "shift_types", "requirements", "requests", "schedules",
    "schedule_assignments", "staff_relations", "business_days",
    "role_requirements", "product_campaigns", "store_settings", "store_skill_requirements",
}


@contextmanager
def connect(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    path = Path(db_path or DEFAULT_DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS employees(
          employee_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, skills TEXT,
          active INTEGER DEFAULT 1, night_allowed INTEGER DEFAULT 1,
          max_consecutive_days INTEGER DEFAULT 5, min_work_days INTEGER DEFAULT 0,
          max_work_days INTEGER DEFAULT 31, note TEXT);
        CREATE TABLE IF NOT EXISTS shift_types(
          shift_code TEXT PRIMARY KEY, shift_name TEXT NOT NULL, is_work INTEGER DEFAULT 1,
          start_time TEXT, end_time TEXT, requires_rest_next_day INTEGER DEFAULT 0,
          color TEXT, note TEXT);
        CREATE TABLE IF NOT EXISTS requirements(
          id INTEGER PRIMARY KEY AUTOINCREMENT, target_month TEXT NOT NULL, date TEXT NOT NULL,
          shift_code TEXT NOT NULL, required_count INTEGER NOT NULL,
          UNIQUE(target_month, date, shift_code));
        CREATE TABLE IF NOT EXISTS requests(
          id INTEGER PRIMARY KEY AUTOINCREMENT, target_month TEXT NOT NULL,
          employee_id TEXT NOT NULL, date TEXT NOT NULL, request_type TEXT NOT NULL,
          shift_code TEXT, priority TEXT DEFAULT 'soft', note TEXT);
        CREATE TABLE IF NOT EXISTS schedules(
          schedule_id INTEGER PRIMARY KEY AUTOINCREMENT, target_month TEXT NOT NULL,
          created_at TEXT NOT NULL, status TEXT NOT NULL, objective_value REAL,
          solver_wall_time REAL, note TEXT);
        CREATE TABLE IF NOT EXISTS schedule_assignments(
          id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id INTEGER NOT NULL,
          employee_id TEXT NOT NULL, date TEXT NOT NULL, shift_code TEXT NOT NULL,
          FOREIGN KEY(schedule_id) REFERENCES schedules(schedule_id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS idx_requirements_month ON requirements(target_month);
        CREATE INDEX IF NOT EXISTS idx_requests_month ON requests(target_month);
        CREATE INDEX IF NOT EXISTS idx_schedules_month ON schedules(target_month);
        CREATE TABLE IF NOT EXISTS staff_relations(
          id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id_1 TEXT NOT NULL,
          employee_id_2 TEXT NOT NULL, relation_type TEXT NOT NULL,
          priority TEXT DEFAULT 'soft', weight INTEGER DEFAULT 50,
          note TEXT, active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS business_days(
          id INTEGER PRIMARY KEY AUTOINCREMENT, target_month TEXT NOT NULL,
          date TEXT NOT NULL, is_open INTEGER DEFAULT 1, is_weekend INTEGER DEFAULT 0,
          is_event_day INTEGER DEFAULT 0, event_name TEXT,
          demand_level TEXT DEFAULT 'normal', new_product_active INTEGER DEFAULT 0,
          note TEXT, UNIQUE(target_month, date));
        CREATE TABLE IF NOT EXISTS role_requirements(
          id INTEGER PRIMARY KEY AUTOINCREMENT, target_month TEXT NOT NULL,
          date TEXT NOT NULL, shift_code TEXT NOT NULL, role_code TEXT NOT NULL,
          required_count INTEGER DEFAULT 0, priority TEXT DEFAULT 'hard',
          UNIQUE(target_month, date, shift_code, role_code));
        CREATE TABLE IF NOT EXISTS product_campaigns(
          id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT NOT NULL,
          category TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
          required_skill_level INTEGER DEFAULT 2,
          require_leader_first_week INTEGER DEFAULT 1, note TEXT);
        CREATE TABLE IF NOT EXISTS store_settings(
          id INTEGER PRIMARY KEY CHECK(id=1), store_name TEXT DEFAULT '店舗A',
          business_hours TEXT DEFAULT '10:00-21:00', weekday_required INTEGER DEFAULT 0,
          weekend_required INTEGER DEFAULT 0, restaurant_mode INTEGER DEFAULT 0,
          require_english INTEGER DEFAULT 1, english_priority TEXT DEFAULT 'hard',
          required_english_count INTEGER DEFAULT 1, required_english_level TEXT DEFAULT 'basic',
          require_english_per_shift INTEGER DEFAULT 0,
          require_new_product INTEGER DEFAULT 1, new_product_priority TEXT DEFAULT 'soft',
          required_new_product_count INTEGER DEFAULT 1,
          require_allergy INTEGER DEFAULT 0, allergy_priority TEXT DEFAULT 'soft',
          required_allergy_count INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS store_skill_requirements(
          skill_code TEXT PRIMARY KEY, minimum_level TEXT NOT NULL DEFAULT '1',
          required_count INTEGER NOT NULL DEFAULT 0, priority TEXT NOT NULL DEFAULT 'soft');
        INSERT OR IGNORE INTO store_settings(id) VALUES(1);
        CREATE INDEX IF NOT EXISTS idx_business_days_month ON business_days(target_month);
        CREATE INDEX IF NOT EXISTS idx_role_requirements_month ON role_requirements(target_month);
        """)
        existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(employees)")}
        for column, definition in EMPLOYEE_RESTAURANT_COLUMNS.items():
            if column not in existing_columns:
                conn.execute(f"ALTER TABLE employees ADD COLUMN {column} {definition}")
        store_columns = {row[1] for row in conn.execute("PRAGMA table_info(store_settings)")}
        for column, definition in STORE_RESTAURANT_COLUMNS.items():
            if column not in store_columns:
                conn.execute(f"ALTER TABLE store_settings ADD COLUMN {column} {definition}")
        conn.executemany("""INSERT OR IGNORE INTO shift_types
          (shift_code,shift_name,is_work,start_time,end_time,requires_rest_next_day,color,note)
          VALUES(?,?,?,?,?,?,?,?)""", INITIAL_SHIFTS)


def fetch_all(table: str, db_path: str | Path | None = None, *, where: str = "", params: Sequence = ()) -> list[dict]:
    if table not in ALLOWED_TABLES:
        raise ValueError("不正なテーブル名です。")
    sql = f"SELECT * FROM {table}" + (f" WHERE {where}" if where else "")
    with connect(db_path) as conn:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def counts(db_path: str | Path | None = None, target_month: str | None = None) -> dict[str, int]:
    with connect(db_path) as conn:
        result = {
            "employees": conn.execute("SELECT COUNT(*) FROM employees WHERE active=1").fetchone()[0],
            "shifts": conn.execute("SELECT COUNT(*) FROM shift_types").fetchone()[0],
        }
        suffix, params = (" WHERE target_month=?", (target_month,)) if target_month else ("", ())
        result["requirements"] = conn.execute("SELECT COUNT(*) FROM requirements" + suffix, params).fetchone()[0]
        result["requests"] = conn.execute("SELECT COUNT(*) FROM requests" + suffix, params).fetchone()[0]
        return result


def upsert_employee(data: Mapping, db_path: str | Path | None = None) -> None:
    base_columns = ["employee_id", "name", "role", "skills", "active", "night_allowed",
                    "max_consecutive_days", "min_work_days", "max_work_days", "note"]
    columns = base_columns + list(EMPLOYEE_RESTAURANT_COLUMNS)
    bool_columns = {"active", "night_allowed", "can_cashier", "can_open", "can_close",
                    "can_handle_complaints", "can_explain_allergy", "is_new_staff",
                    "can_train_new_staff", "can_manage_cash", "can_hygiene_check"}
    integer_columns = {"max_consecutive_days", "min_work_days", "max_work_days",
                       "product_skill_ice", "product_skill_chocolate", "product_skill_cookie",
                       "new_product_skill", "peak_support_level"}
    defaults = {"active": True, "night_allowed": True, "max_consecutive_days": 5,
                "min_work_days": 0, "max_work_days": 31, "english_level": "none"}
    values = []
    for column in columns:
        value = data.get(column, defaults.get(column, 0 if column in EMPLOYEE_RESTAURANT_COLUMNS else ""))
        if column in bool_columns:
            value = int(bool(value))
        elif column in integer_columns:
            value = int(value or 0)
        else:
            value = str(value or "").strip() if column in {"employee_id", "name"} else str(value or "")
        values.append(value)
    placeholders = ",".join("?" for _ in columns)
    updates = ",".join(f"{c}=excluded.{c}" for c in columns if c != "employee_id")
    with connect(db_path) as conn:
        conn.execute(f"INSERT INTO employees({','.join(columns)}) VALUES ({placeholders}) "
                     f"ON CONFLICT(employee_id) DO UPDATE SET {updates}", values)
def delete_employee(employee_id: str, db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM requests WHERE employee_id=?", (employee_id,))
        conn.execute("DELETE FROM staff_relations WHERE employee_id_1=? OR employee_id_2=?",
                     (employee_id, employee_id))
        conn.execute("DELETE FROM employees WHERE employee_id=?", (employee_id,))


def get_store_settings(db_path: str | Path | None = None) -> dict:
    rows = fetch_all("store_settings", db_path, where="id=1")
    return rows[0] if rows else {}


def save_store_settings(data: Mapping, db_path: str | Path | None = None) -> None:
    columns = ["store_name", "business_hours", "weekday_required", "weekend_required",
               "restaurant_mode", "require_english", "english_priority", "required_english_count",
               "required_english_level", "require_english_per_shift", "require_new_product",
               "new_product_priority", "required_new_product_count", "require_allergy",
               "allergy_priority", "required_allergy_count"]
    bool_columns = {"restaurant_mode", "require_english", "require_english_per_shift",
                    "require_new_product", "require_allergy"}
    int_columns = {"weekday_required", "weekend_required", "required_english_count",
                   "required_new_product_count", "required_allergy_count"}
    current = get_store_settings(db_path)
    values = [int(bool(data.get(c, current.get(c, False)))) if c in bool_columns else
              int(data.get(c, current.get(c, 0)) or 0) if c in int_columns else
              str(data.get(c, current.get(c, "")) or "")
              for c in columns]
    with connect(db_path) as conn:
        conn.execute(f"UPDATE store_settings SET {','.join(f'{c}=?' for c in columns)} WHERE id=1", values)


def get_store_skill_requirements(db_path: str | Path | None = None) -> list[dict]:
    """Return all configured skill requirements, including legacy defaults."""
    stored = {row["skill_code"]: row for row in fetch_all("store_skill_requirements", db_path)}
    settings = get_store_settings(db_path)
    legacy = {
        "english_support": {
            "minimum_level": settings.get("required_english_level", "basic"),
            "required_count": int(settings.get("required_english_count", 1)) if settings.get("require_english") else 0,
            "priority": settings.get("english_priority", "hard"),
        },
        "new_product": {
            "minimum_level": "1",
            "required_count": int(settings.get("required_new_product_count", 1)) if settings.get("require_new_product") else 0,
            "priority": settings.get("new_product_priority", "soft"),
        },
        "allergy_support": {
            "minimum_level": "1",
            "required_count": int(settings.get("required_allergy_count", 1)) if settings.get("require_allergy") else 0,
            "priority": settings.get("allergy_priority", "soft"),
        },
    }
    rows = []
    for code in STORE_SKILL_CODES:
        row = stored.get(code) or legacy.get(code, {
            "minimum_level": "1", "required_count": 0, "priority": "soft"})
        rows.append({"skill_code": code, "minimum_level": str(row.get("minimum_level", "1")),
                     "required_count": max(0, int(row.get("required_count", 0))),
                     "priority": row.get("priority", "soft") if row.get("priority") in {"hard", "soft"} else "soft"})
    return rows


def save_store_skill_requirements(rows: Iterable[Mapping], db_path: str | Path | None = None) -> None:
    """Save skill requirements and mirror legacy fields for old integrations."""
    normalized = []
    for row in rows:
        code = str(row["skill_code"])
        if code not in STORE_SKILL_CODES:
            continue
        normalized.append((code, str(row.get("minimum_level", "1")),
                           max(0, int(row.get("required_count", 0))),
                           str(row.get("priority", "soft"))))
    with connect(db_path) as conn:
        conn.executemany("""INSERT INTO store_skill_requirements(skill_code,minimum_level,required_count,priority)
          VALUES(?,?,?,?) ON CONFLICT(skill_code) DO UPDATE SET minimum_level=excluded.minimum_level,
          required_count=excluded.required_count,priority=excluded.priority""", normalized)
    by_code = {row[0]: row for row in normalized}
    english = by_code.get("english_support", ("", "basic", 0, "hard"))
    new_product = by_code.get("new_product", ("", "1", 0, "soft"))
    allergy = by_code.get("allergy_support", ("", "1", 0, "soft"))
    save_store_settings({
        "require_english": english[2] > 0,
        "required_english_level": english[1], "required_english_count": english[2],
        "english_priority": english[3],
        "require_new_product": new_product[2] > 0,
        "required_new_product_count": new_product[2], "new_product_priority": new_product[3],
        "require_allergy": allergy[2] > 0,
        "required_allergy_count": allergy[2], "allergy_priority": allergy[3],
    }, db_path)


def upsert_staff_relation(data: Mapping, db_path: str | Path | None = None) -> None:
    values = (str(data["employee_id_1"]), str(data["employee_id_2"]), str(data["relation_type"]),
              str(data.get("priority", "soft")), int(data.get("weight", 50)),
              str(data.get("note", "") or ""), int(bool(data.get("active", True))))
    with connect(db_path) as conn:
        if data.get("id"):
            conn.execute("""UPDATE staff_relations SET employee_id_1=?,employee_id_2=?,relation_type=?,
              priority=?,weight=?,note=?,active=? WHERE id=?""", values + (int(data["id"]),))
        else:
            conn.execute("""INSERT INTO staff_relations(employee_id_1,employee_id_2,relation_type,
              priority,weight,note,active) VALUES(?,?,?,?,?,?,?)""", values)


def delete_staff_relation(relation_id: int, db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM staff_relations WHERE id=?", (relation_id,))


def upsert_business_day(data: Mapping, db_path: str | Path | None = None) -> None:
    values = (str(data["target_month"]), str(data["date"]), int(bool(data.get("is_open", True))),
              int(bool(data.get("is_weekend", False))), int(bool(data.get("is_event_day", False))),
              str(data.get("event_name", "") or ""), str(data.get("demand_level", "normal")),
              int(bool(data.get("new_product_active", False))), str(data.get("note", "") or ""))
    with connect(db_path) as conn:
        conn.execute("""INSERT INTO business_days(target_month,date,is_open,is_weekend,is_event_day,
          event_name,demand_level,new_product_active,note) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(target_month,date) DO UPDATE SET is_open=excluded.is_open,
          is_weekend=excluded.is_weekend,is_event_day=excluded.is_event_day,event_name=excluded.event_name,
          demand_level=excluded.demand_level,new_product_active=excluded.new_product_active,note=excluded.note""", values)


def upsert_product_campaign(data: Mapping, db_path: str | Path | None = None) -> None:
    values = (str(data["product_name"]), str(data["category"]), str(data["start_date"]),
              str(data["end_date"]), int(data.get("required_skill_level", 2)),
              int(bool(data.get("require_leader_first_week", True))), str(data.get("note", "") or ""))
    with connect(db_path) as conn:
        if data.get("id"):
            conn.execute("""UPDATE product_campaigns SET product_name=?,category=?,start_date=?,end_date=?,
              required_skill_level=?,require_leader_first_week=?,note=? WHERE id=?""", values + (int(data["id"]),))
        else:
            conn.execute("""INSERT INTO product_campaigns(product_name,category,start_date,end_date,
              required_skill_level,require_leader_first_week,note) VALUES(?,?,?,?,?,?,?)""", values)


def delete_product_campaign(campaign_id: int, db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM product_campaigns WHERE id=?", (campaign_id,))


def replace_role_requirements(target_month: str, rows: Iterable[Mapping],
                              db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM role_requirements WHERE target_month=?", (target_month,))
        conn.executemany("""INSERT INTO role_requirements(target_month,date,shift_code,role_code,
          required_count,priority) VALUES(?,?,?,?,?,?)""",
          [(target_month, str(r["date"]), str(r["shift_code"]), str(r["role_code"]),
            int(r.get("required_count", 0)), str(r.get("priority", "hard")))
           for r in rows if int(r.get("required_count", 0)) >= 0])

def upsert_role_requirement(data: Mapping, db_path: str | Path | None = None) -> None:
    values = (str(data["target_month"]), str(data["date"]), str(data["shift_code"]),
              str(data["role_code"]), int(data.get("required_count", 0)),
              str(data.get("priority", "hard")))
    with connect(db_path) as conn:
        conn.execute("""INSERT INTO role_requirements(target_month,date,shift_code,role_code,
          required_count,priority) VALUES(?,?,?,?,?,?)
          ON CONFLICT(target_month,date,shift_code,role_code) DO UPDATE SET
          required_count=excluded.required_count,priority=excluded.priority""", values)


def delete_role_requirement(requirement_id: int, db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM role_requirements WHERE id=?", (requirement_id,))
def upsert_shift_type(data: Mapping, db_path: str | Path | None = None) -> None:
    values = (str(data["shift_code"]).strip().upper(), str(data["shift_name"]).strip(),
              int(bool(data.get("is_work", True))), str(data.get("start_time", "") or ""),
              str(data.get("end_time", "") or ""), int(bool(data.get("requires_rest_next_day", False))),
              str(data.get("color", "FFFFFF") or "FFFFFF").replace("#", "").upper(),
              str(data.get("note", "") or ""))
    with connect(db_path) as conn:
        conn.execute("""INSERT INTO shift_types VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(shift_code) DO UPDATE SET shift_name=excluded.shift_name,is_work=excluded.is_work,
        start_time=excluded.start_time,end_time=excluded.end_time,
        requires_rest_next_day=excluded.requires_rest_next_day,color=excluded.color,note=excluded.note""", values)


def delete_shift_type(shift_code: str, db_path: str | Path | None = None) -> None:
    if shift_code == "O":
        raise ValueError("休み区分 O は削除できません。")
    with connect(db_path) as conn:
        if conn.execute("SELECT COUNT(*) FROM requirements WHERE shift_code=?", (shift_code,)).fetchone()[0]:
            raise ValueError("必要人数で使用中の勤務区分は削除できません。")
        conn.execute("DELETE FROM shift_types WHERE shift_code=?", (shift_code,))


def replace_requirements(target_month: str, rows: Iterable[Mapping], db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM requirements WHERE target_month=?", (target_month,))
        conn.executemany("INSERT INTO requirements(target_month,date,shift_code,required_count) VALUES(?,?,?,?)",
            [(target_month, str(r["date"]), str(r["shift_code"]), int(r["required_count"]))
             for r in rows if int(r["required_count"]) >= 0])


def add_request(data: Mapping, db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("""INSERT INTO requests(target_month,employee_id,date,request_type,shift_code,priority,note)
        VALUES(?,?,?,?,?,?,?)""", (str(data["target_month"]), str(data["employee_id"]),
        str(data["date"]), str(data["request_type"]), str(data.get("shift_code", "") or ""),
        str(data.get("priority", "soft")), str(data.get("note", "") or "")))


def add_request_range(data: Mapping, start_date: date, end_date: date,
                      db_path: str | Path | None = None) -> int:
    if isinstance(start_date, datetime):
        start_date = start_date.date()
    if isinstance(end_date, datetime):
        end_date = end_date.date()
    if end_date < start_date:
        raise ValueError("終了日は開始日以降にしてください。")

    target_month = str(data["target_month"])
    if start_date.strftime("%Y-%m") != target_month or end_date.strftime("%Y-%m") != target_month:
        raise ValueError("開始日・終了日は対象年月内で指定してください。")

    dates = [start_date + timedelta(days=offset) for offset in range((end_date - start_date).days + 1)]
    values = [
        (target_month, str(data["employee_id"]), day.isoformat(),
         str(data["request_type"]), str(data.get("shift_code", "") or ""),
         str(data.get("priority", "soft")), str(data.get("note", "") or ""))
        for day in dates
    ]
    with connect(db_path) as conn:
        conn.executemany("""INSERT INTO requests(target_month,employee_id,date,request_type,shift_code,priority,note)
        VALUES(?,?,?,?,?,?,?)""", values)
    return len(values)


def delete_request(request_id: int, db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM requests WHERE id=?", (request_id,))


def save_schedule(target_month: str, status: str, assignments: list[dict], objective_value: float | None,
                  solver_wall_time: float | None, note: str = "", db_path: str | Path | None = None) -> int:
    with connect(db_path) as conn:
        cursor = conn.execute("""INSERT INTO schedules(target_month,created_at,status,objective_value,solver_wall_time,note)
        VALUES(?,?,?,?,?,?)""", (target_month, datetime.now().isoformat(timespec="seconds"), status,
        objective_value, solver_wall_time, note))
        schedule_id = int(cursor.lastrowid)
        conn.executemany("""INSERT INTO schedule_assignments(schedule_id,employee_id,date,shift_code)
        VALUES(?,?,?,?)""", [(schedule_id, a["employee_id"], a["date"], a["shift_code"]) for a in assignments])
        return schedule_id


def latest_schedule(target_month: str | None = None, db_path: str | Path | None = None) -> dict | None:
    with connect(db_path) as conn:
        sql = "SELECT * FROM schedules" + (" WHERE target_month=?" if target_month else "") + " ORDER BY schedule_id DESC LIMIT 1"
        row = conn.execute(sql, (target_month,) if target_month else ()).fetchone()
        if not row:
            return None
        result = dict(row)
        result["assignments"] = [dict(r) for r in conn.execute("""SELECT employee_id,date,shift_code
        FROM schedule_assignments WHERE schedule_id=? ORDER BY employee_id,date""", (row["schedule_id"],)).fetchall()]
        return result
