"""Dashboard UI components – HTML table renderer for the schedule grid.

Every public function returns an HTML string (or renders Streamlit widgets).
The heavy lifting is pure-Python string concatenation; no extra dependencies.
"""
from __future__ import annotations

import html as _html
from typing import Any


# ── Header ─────────────────────────────────────────────────────────
def render_dashboard_header(store_name: str = "店舗A") -> str:
    """Top-bar: app name on left, dummy store/admin on right."""
    return (
        '<div class="dash-header">'
        '  <div class="dash-header-title">勤務表</div>'
        '  <div class="dash-header-right">'
        '    <span class="notif" title="通知">🔔</span>'
        f'    <span class="store-badge">{_html.escape(store_name)} ▾</span>'
        '    <span class="store-badge">管理者 ▾</span>'
        '  </div>'
        '</div>'
    )


# ── Schedule HTML table ────────────────────────────────────────────
def render_schedule_table(
    view_model: dict,
    *,
    visible_dates: list[dict] | None = None,
    show_required: bool = True,
    show_assigned: bool = True,
    show_requests: bool = True,
    show_skill_badges: bool = True,
    filtered_staff_ids: set[str] | None = None,
) -> str:
    """Build the full HTML table from the view-model dict.

    Parameters
    ----------
    view_model : dict from ``build_schedule_view_model``
    visible_dates : subset of ``view_model["dates"]`` to render (for week/half-month)
    show_required : whether to show required/assigned/diff summary rows
    show_assigned : alias — when False, also hides assigned row
    show_requests : annotate request badges on cells
    filtered_staff_ids : if not None, only show these employee IDs
    """
    dates = visible_dates or view_model["dates"]
    summary = view_model["summary"]
    staff_rows = view_model["staff_rows"]
    shift_map = view_model.get("shift_map", {})

    if filtered_staff_ids is not None:
        staff_rows = [r for r in staff_rows if r["employee_id"] in filtered_staff_ids]

    parts: list[str] = []
    parts.append('<div class="schedule-container">')
    parts.append('<table class="schedule-table">')

    # ── THEAD: date header ─────────────────────────────────────────
    parts.append("<thead><tr>")
    parts.append('<th class="col-staff" rowspan="1">スタッフ名</th>')
    for d in dates:
        cls = "date-sat" if d["is_saturday"] else ("date-sun" if d["is_sunday"] else "")
        parts.append(
            f'<th class="date-cell {cls}">'
            f'<div class="date-day">{d["day"]}</div>'
            f'<div class="date-wd">{d["weekday"]}</div>'
            + (f'<div class="date-event" title="{_html.escape(d.get("event_label", ""))}">★</div>' if d.get("is_event") else "")
            + f"</th>"
        )
    parts.append("</tr></thead>")

    parts.append("<tbody>")

    # ── Summary rows ───────────────────────────────────────────────
    if show_required:
        # Required row
        parts.append('<tr class="summary-row row-required">')
        parts.append('<td class="col-staff">必要人数</td>')
        for d in dates:
            val = summary["required"].get(d["date"], 0)
            bg_cls = _weekend_col_cls(d)
            parts.append(f'<td class="{bg_cls}">{val}</td>')
        parts.append("</tr>")

    if show_assigned:
        # Assigned row
        parts.append('<tr class="summary-row row-assigned">')
        parts.append('<td class="col-staff">勤務人数</td>')
        for d in dates:
            val = summary["assigned"].get(d["date"], 0)
            bg_cls = _weekend_col_cls(d)
            parts.append(f'<td class="{bg_cls}">{val}</td>')
        parts.append("</tr>")

    if show_required or show_assigned:
        # Diff row
        parts.append('<tr class="summary-row row-diff">')
        parts.append('<td class="col-staff">過不足</td>')
        for d in dates:
            diff = summary["diff"].get(d["date"], 0)
            cls = "diff-neg" if diff < 0 else ("diff-pos" if diff > 0 else "diff-zero")
            label = f"+{diff}" if diff > 0 else str(diff)
            bg_cls = _weekend_col_cls(d)
            parts.append(f'<td class="{bg_cls} {cls}">{label}</td>')
        parts.append("</tr>")

    # ── Staff rows ─────────────────────────────────────────────────
    for row in staff_rows:
        parts.append("<tr>")
        name_esc = _html.escape(row["name"])
        role_esc = _html.escape(row["role"])
        parts.append(
            f'<td class="col-staff">'
            f'<div class="staff-name">{name_esc}</div>'
            f'<div class="staff-role">{role_esc}</div>'
            f"</td>"
        )
        for d in dates:
            cell = row["cells"].get(d["date"], {})
            parts.append(_render_cell(cell, d, show_requests, show_skill_badges))
        parts.append("</tr>")

    parts.append("</tbody></table></div>")
    return "\n".join(parts)


# ── Private helpers ────────────────────────────────────────────────
def _weekend_col_cls(d: dict) -> str:
    if d["is_saturday"]:
        return "col-sat"
    if d["is_sunday"]:
        return "col-sun"
    return ""


def _render_cell(cell: dict, d: dict, show_requests: bool, show_skill_badges: bool) -> str:
    """Render a single shift cell as <td>."""
    code = cell.get("shift_code", "O")
    color = cell.get("color", "#FFFFFF")
    is_work = cell.get("is_work", False)
    bg_cls = _weekend_col_cls(d)

    if not is_work:
        # Rest day – minimal display
        req = cell.get("request_type")
        if show_requests and req == "off":
            # Show request-off badge
            violated = cell.get("request_violated", False)
            v_cls = "request-violated" if violated else ""
            priority = cell.get("request_priority", "soft")
            label = "希望休" if priority == "soft" else "希望休(必須)"
            return (
                f'<td class="shift-cell {bg_cls}">'
                f'<div class="shift-badge request-badge {v_cls}" '
                f'style="background:#FEF2F2;">'
                f'<div class="shift-name" style="color:#C4324B;">{label}</div>'
                f"</div></td>"
            )
        return f'<td class="shift-cell {bg_cls}"><div class="shift-rest">―</div></td>'

    # Work shift
    name = _html.escape(cell.get("shift_name", code))
    start = cell.get("start_time", "")
    end = cell.get("end_time", "")
    time_str = f"{start}-{end}" if start and end else ""

    req_type = cell.get("request_type")
    violated = cell.get("request_violated", False)

    badge_cls = ""
    req_label = ""
    if show_requests and req_type:
        if req_type == "off":
            # Worked on a requested day off → violation
            badge_cls = "request-badge request-violated"
            req_label = '<div class="request-label">希望休違反</div>'
        elif req_type == "fixed":
            badge_cls = "request-badge" if violated else ""
            v_label = "固定違反" if violated else "固定"
            style = 'color:#C4324B;' if violated else 'color:#2B6CB0;'
            req_label = f'<div class="request-label" style="{style}">{v_label}</div>'
        elif req_type == "prefer":
            if violated:
                badge_cls = "request-badge request-violated"
                req_label = '<div class="request-label">希望違反</div>'
            else:
                req_label = '<div class="request-label" style="color:#2B6CB0;">希望</div>'
        elif req_type == "avoid":
            if violated:
                badge_cls = "request-badge request-violated"
                req_label = '<div class="request-label">避けたい(違反)</div>'

    violated_bg = ""
    if violated and show_requests:
        badge_cls += " request-violated"

    skill_html = ""
    if show_skill_badges and cell.get("skill_badges"):
        skill_html = '<div class="skill-badges">' + "".join(
            f'<span class="skill-badge">{_html.escape(label)}</span>' for label in cell["skill_badges"]
        ) + "</div>"
    return (
        f'<td class="shift-cell {bg_cls}">'
        f'<div class="shift-badge {badge_cls}" style="background:{color};">'
        f'<div class="shift-name">{name}</div>'
        + (f'<div class="shift-time">{time_str}</div>' if time_str else "")
        + req_label
        + skill_html
        + "</div></td>"
    )
