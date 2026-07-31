from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(slots=True)
class Employee:
    employee_id: str
    name: str
    role: str = ""
    skills: str = ""
    active: bool = True
    night_allowed: bool = True
    max_consecutive_days: int = 5
    min_work_days: int = 0
    max_work_days: int = 31
    note: str = ""
    english_level: str = "none"
    can_cashier: bool = False
    can_open: bool = False
    can_close: bool = False
    can_handle_complaints: bool = False
    can_explain_allergy: bool = False
    is_new_staff: bool = False
    can_train_new_staff: bool = False
    product_skill_ice: int = 0
    product_skill_chocolate: int = 0
    product_skill_cookie: int = 0
    new_product_skill: int = 0
    can_manage_cash: bool = False
    can_hygiene_check: bool = False
    peak_support_level: int = 0


@dataclass(slots=True)
class ShiftType:
    shift_code: str
    shift_name: str
    is_work: bool = True
    start_time: str = ""
    end_time: str = ""
    requires_rest_next_day: bool = False
    color: str = "FFFFFF"
    note: str = ""


@dataclass(slots=True)
class ShiftRequest:
    employee_id: str
    date: str
    request_type: str
    shift_code: Optional[str] = None
    priority: str = "soft"
    note: str = ""


