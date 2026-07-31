from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import streamlit as st

from src import db
from src.calendar_utils import display_date, is_weekend, month_dates, parse_target_month
from src.color_palette import SHIFT_COLOR_PALETTE, color_option_label, normalize_color
from src.display import (PRIORITY_LABELS, REQUEST_TYPE_LABELS, employee_display_frame,
                         japanese_date, request_display_frame, shift_display_frame,
                         violation_display_frame)
from src.excel_io import (export_employees_bytes, export_requirements_bytes, export_requests_bytes,
                          export_schedule, export_staff_skills_bytes, import_employees,
                          import_requirements, import_requests, import_staff_skills, load_sample_data)
from src.reports import employee_summary, request_violations, shift_summary
from src.restaurant import restaurant_condition_checks
from src.restaurant import ENGLISH_LEVEL_LABELS, SKILL_LEVEL_LABELS
from src.restaurant_ui import (render_campaigns_events, render_role_requirements,
                               render_staff_relations, render_store_settings)
from src.solver import generate_schedule
from src.validators import blocking_issues, precheck, validate_employee, validate_shift_type
from src.view_models import build_schedule_view_model
from src.ui_components import render_dashboard_header, render_schedule_table
from src.ui_styles import APP_BASE_CSS, DASHBOARD_CSS

ROOT = Path(__file__).resolve().parent
db.init_db()

st.set_page_config(page_title="勤務表メーカー", page_icon="📅", layout="wide", initial_sidebar_state="auto")
st.markdown(APP_BASE_CSS, unsafe_allow_html=True)
st.markdown(DASHBOARD_CSS, unsafe_allow_html=True)


# ── Helpers ────────────────────────────────────────────────────────
def month_options() -> list[str]:
    return [f"{year}-{month:02d}" for year in range(2025, 2029) for month in range(1, 13)]


if "target_month" not in st.session_state:
    st.session_state.target_month = "2026-08"


def month_label(target_month: str) -> str:
    year, month = target_month.split("-")
    return f"{year}年{int(month)}月"


def go_to(page_name: str) -> None:
    st.session_state.navigation = page_name


def month_selector(key: str) -> str:
    options = month_options()
    selected = st.selectbox("対象年月", options, index=options.index(st.session_state.target_month),
                            format_func=month_label, key=key)
    st.session_state.target_month = selected
    return selected


def page_header(title: str, description: str = "") -> None:
    st.title(title)
    if description:
        st.caption(description)


def dataframe_or_empty(frame: pd.DataFrame, message: str, *, height: int | None = None) -> None:
    if frame.empty:
        st.info(message)
    else:
        dataframe_options = {"use_container_width": True, "hide_index": True}
        if height is not None:
            dataframe_options["height"] = height
        st.dataframe(frame, **dataframe_options)


# ── Navigation ─────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("## 📅 勤務表メーカー")
    st.caption("ローカル勤務表作成")
    st.divider()
    page = st.radio("メニュー", ["ホーム", "勤務表", "職員マスタ", "勤務区分", "必要人数", "希望休・勤務希望",
                                  "店舗設定", "スタッフ配置相性設定", "新商品・イベント", "役割別必要人数"],
                    label_visibility="collapsed", key="navigation")
    st.divider()
    st.caption("データはこのPC内に保存されます")


# ═══════════════════════════════════════════════════════════════════
# Page: ホーム
# ═══════════════════════════════════════════════════════════════════
def render_home() -> None:
    top_left, top_right = st.columns([3, 1.5], vertical_alignment="bottom")
    with top_left:
        page_header("勤務表ダッシュボード", "職員・必要人数・希望を確認し、1か月分の勤務表を作成します。")
    with top_right:
        target = month_selector("home_month")
    st.markdown(f'<div class="status-rail">📅 {month_label(target)}</div>', unsafe_allow_html=True)
    metrics = db.counts(target_month=target)
    columns = st.columns(4)
    for column, (label, value) in zip(columns, [("登録職員", f"{metrics['employees']}名"), ("勤務区分", f"{metrics['shifts']}種類"),
                                                       ("必要人数設定", f"{metrics['requirements']}件"), ("希望登録", f"{metrics['requests']}件")]):
        column.metric(label, value)
    st.markdown('<div class="section-line"></div>', unsafe_allow_html=True)
    latest = db.latest_schedule(target)
    st.subheader("最新の勤務表")
    if latest and latest["status"] == "success":
        label = "作成済み"
        status_columns = st.columns([1, 1, 1, 1.3], vertical_alignment="center")
        status_columns[0].metric("状態", label)
        status_columns[1].metric("ペナルティ", f"{latest['objective_value'] or 0:.0f}")
        status_columns[2].metric("計算時間", f"{latest['solver_wall_time'] or 0:.2f}秒")
        status_columns[3].button("勤務表を開く", type="primary", use_container_width=True,
                                 on_click=go_to, args=("勤務表",))

        # Mini preview – show first 11 days
        vm = build_schedule_view_model(target, latest["assignments"])
        preview_dates = vm["dates"][:11]
        html = render_schedule_table(vm, visible_dates=preview_dates,
                                     show_requests=True, show_required=True, show_assigned=True)
        st.markdown(html, unsafe_allow_html=True)
        st.caption("※ プレビュー表示です。全日程は「勤務表」メニューで確認できます。")
    else:
        main, status = st.columns([4, 1.15], gap="large")
        with main:
            st.info("この対象年月の勤務表はまだありません。サンプルデータを読み込むか、必要情報を登録してください。")
            if st.button("サンプルデータを読み込む", type="primary", use_container_width=True):
                loaded = load_sample_data(target)
                st.success(f"職員 {loaded['employees']}名、必要人数 {loaded['requirements']}件、希望 {loaded['requests']}件を読み込みました。")
                st.rerun()
        with status:
            st.subheader("作成状況")
            st.metric("状態", "未作成")
            st.button("勤務表を自動作成", type="primary", use_container_width=True,
                      on_click=go_to, args=("勤務表",))
    st.markdown("""<div class="guide"><strong>1</strong>必要人数を確認・調整　　→　　<strong>2</strong>勤務表を自動作成　　→　　<strong>3</strong>結果を確認・Excel出力</div>""", unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════
# Page: 勤務表 (Dashboard – merged auto/result/export)
# ═══════════════════════════════════════════════════════════════════
def render_dashboard() -> None:
    # ── Header ─────────────────────────────────────────────────────
    st.markdown(render_dashboard_header(db.get_store_settings().get("store_name", "店舗A")), unsafe_allow_html=True)

    target = st.session_state.target_month

    # ── Toolbar row 1: period / month nav ──────────────────────────
    tc1, tc2, tc3, tc4, tc5 = st.columns([1.6, 0.5, 1.2, 2.0, 2.5], vertical_alignment="bottom")
    with tc1:
        view_mode = st.radio("表示切替", ["週", "半月", "月"], index=2, horizontal=True,
                             key="dash_view_mode", label_visibility="collapsed")
    with tc2:
        if st.button("◀", key="dash_prev", help="前へ"):
            _nav_month(target, -1)
            st.rerun()
    with tc3:
        st.markdown(f'<div class="tb-month">{month_label(target)}</div>', unsafe_allow_html=True)
    with tc4:
        if st.button("▶", key="dash_next", help="次へ"):
            _nav_month(target, +1)
            st.rerun()

    # ── Toolbar row 2: filters + actions ───────────────────────────
    employees = [e for e in db.fetch_all("employees") if e["active"]]
    employee_ids = [e["employee_id"] for e in employees]
    employee_names = {e["employee_id"]: e["name"] for e in employees}

    fc1, fc2, fc3, fc4, fc5, fc6, fc7, fc8 = st.columns(
        [1.4, 1.0, 0.55, 0.55, 0.65, 1.55, 1.15, 1.15], vertical_alignment="bottom")
    with fc1:
        staff_filter = st.selectbox(
            "スタッフ", ["__all__"] + employee_ids,
            format_func=lambda x: "すべてのスタッフ" if x == "__all__" else employee_names.get(x, x),
            key="dash_staff_filter", label_visibility="collapsed")
    with fc2:
        role_filter = st.selectbox(
            "役職", ["__all__"] + sorted({e.get("role", "") for e in employees if e.get("role")}),
            format_func=lambda x: "絞り込み" if x == "__all__" else x,
            key="dash_role_filter", label_visibility="collapsed")
    with fc3:
        show_requests_cb = st.checkbox("希望", value=True, key="dash_show_req")
    with fc4:
        show_summary_cb = st.checkbox("人数", value=True, key="dash_show_summary")
    with fc5:
        show_skill_badges = st.checkbox("技能", value=True, key="dash_show_skills")
    with fc6:
        create_clicked = st.button("📋 勤務表を自動作成", type="primary", key="dash_create",
                                   use_container_width=True)
    with fc7:
        export_usage = st.selectbox("Excel用途", ["通常配布用", "管理者確認用"],
                                    label_visibility="collapsed", key="dash_export_usage")
    with fc8:
        export_clicked = st.button("📥 Excel出力", key="dash_export", use_container_width=True)

    # ── Handle create ──────────────────────────────────────────────
    if create_clicked:
        _handle_create(target)

    # ── Handle export ──────────────────────────────────────────────
    if export_clicked:
        _handle_export(target, export_usage == "管理者確認用")

    # ── Download button (if export was previously generated) ───────
    export_path = Path(st.session_state.get("export_path", ""))
    if export_path.is_file():
        st.download_button("作成したExcelをダウンロード", export_path.read_bytes(), export_path.name,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           type="primary", key="dash_download")

    # ── Schedule table ─────────────────────────────────────────────
    latest = db.latest_schedule(target)
    if not latest or latest["status"] != "success":
        st.info("勤務表がまだ作成されていません。「勤務表を自動作成」ボタンを押してください。")
        # Show precheck
        issues = precheck(target)
        if issues:
            st.subheader("事前チェック")
            for issue in issues:
                {"error": st.error, "warning": st.warning, "info": st.success}.get(issue["severity"], st.info)(issue["message"])
        return

    # Show metadata
    st.caption(f"作成日時 {latest['created_at']}　｜　ペナルティ {latest['objective_value']:.0f}　｜　計算時間 {latest['solver_wall_time']:.2f}秒")
    restaurant_checks = restaurant_condition_checks(target, latest["assignments"])
    restaurant_alerts = [row for row in restaurant_checks if row["結果"] == "要確認"]
    if restaurant_alerts:
        with st.expander(f"飲食店向け配置の確認事項：{len(restaurant_alerts)}件", expanded=True):
            for row in restaurant_alerts[:12]:
                st.warning(f"{row['日付']}｜{row['確認項目']}：{row['内容']}")
            if len(restaurant_alerts) > 12:
                st.caption("残りは下部の「飲食店条件確認」タブで確認できます。")

    vm = build_schedule_view_model(target, latest["assignments"])

    # ── Filter staff ───────────────────────────────────────────────
    filtered_ids = None
    if staff_filter != "__all__":
        filtered_ids = {staff_filter}
    elif role_filter != "__all__":
        filtered_ids = {e["employee_id"] for e in employees if e.get("role") == role_filter}

    # ── Determine visible dates ────────────────────────────────────
    all_dates = vm["dates"]
    visible = _compute_visible_dates(all_dates, view_mode, target)

    # ── Week/half-month navigation ─────────────────────────────────
    if view_mode != "月":
        start_key = "dash_sub_start"
        max_start = max(0, len(all_dates) - len(visible))
        sub_start = st.session_state.get(start_key, 0)
        span = 7 if view_mode == "週" else 15
        visible = all_dates[sub_start:sub_start + span]

        nav_l, nav_info, nav_r = st.columns([0.3, 2, 0.3])
        with nav_l:
            if st.button("◀", key="dash_sub_prev") and sub_start > 0:
                st.session_state[start_key] = max(0, sub_start - span)
                st.rerun()
        with nav_info:
            if visible:
                st.caption(f"{visible[0]['day']}日 ～ {visible[-1]['day']}日")
        with nav_r:
            if st.button("▶", key="dash_sub_next") and sub_start + span < len(all_dates):
                st.session_state[start_key] = min(max_start, sub_start + span)
                st.rerun()

    html = render_schedule_table(
        vm,
        visible_dates=visible,
        show_required=show_summary_cb,
        show_assigned=show_summary_cb,
        show_requests=show_requests_cb,
        show_skill_badges=show_skill_badges,
        filtered_staff_ids=filtered_ids,
    )
    st.markdown(html, unsafe_allow_html=True)

    # ── Legend ─────────────────────────────────────────────────────
    shifts = db.fetch_all("shift_types")
    legend_parts = []
    for s in shifts:
        color = "#" + (s.get("color") or "FFFFFF").replace("#", "")
        legend_parts.append(
            f'<span style="display:inline-block;background:{color};border-radius:4px;'
            f'padding:2px 8px;margin:0 3px;font-size:0.78rem;font-weight:700;">'
            f'{s["shift_name"]}</span>'
        )
    st.markdown(
        '<div style="margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:4px;align-items:center;">'
        + "".join(legend_parts)
        + '<span style="margin-left:8px;font-size:0.75rem;color:#667085;">'
        '不足：<span style="color:#B42318;">赤</span>　'
        '超過：<span style="color:#8A5300;">オレンジ</span>　'
        '適正：<span style="color:#667085;">グレー</span>　'
        '希望休：<span style="color:#C4324B;">赤枠</span>'
        '</span></div>',
        unsafe_allow_html=True,
    )

    # ── Detail tabs (below table) ──────────────────────────────────
    st.markdown('<div class="section-line"></div>', unsafe_allow_html=True)
    tab1, tab2, tab3, tab4 = st.tabs(["職員別集計", "勤務区分別集計", "希望・ルール確認", "飲食店条件確認"])
    with tab1:
        st.dataframe(employee_summary(latest["assignments"]), use_container_width=True, hide_index=True)
    with tab2:
        st.dataframe(shift_summary(latest["assignments"]), use_container_width=True, hide_index=True)
    with tab3:
        violations = request_violations(target, latest["assignments"])
        dataframe_or_empty(
            violation_display_frame(violations, db.fetch_all("employees"), shifts),
            "希望違反はありません。",
        )
        if not violations:
            st.success("必須条件（必要人数・夜勤可否・必須の希望・最大連続勤務・夜勤明け休み）を満たしています。")
    with tab4:
        if restaurant_checks:
            st.dataframe(pd.DataFrame(restaurant_checks), use_container_width=True, hide_index=True)
            if not restaurant_alerts:
                st.success("飲食店向けの確認項目をすべて満たしています。")
        else:
            st.info("店舗設定で飲食店向け条件を有効にすると、配置状況を確認できます。")


def _nav_month(current: str, delta: int) -> None:
    """Move target_month forward/backward by *delta* months."""
    opts = month_options()
    idx = opts.index(current) if current in opts else 0
    new_idx = max(0, min(len(opts) - 1, idx + delta))
    st.session_state.target_month = opts[new_idx]


def _compute_visible_dates(all_dates: list[dict], view_mode: str, target_month: str) -> list[dict]:
    """Return subset of dates based on view mode."""
    if view_mode == "月":
        return all_dates
    if view_mode == "半月":
        start = st.session_state.get("dash_sub_start", 0)
        return all_dates[start:start + 15]
    # 週
    start = st.session_state.get("dash_sub_start", 0)
    return all_dates[start:start + 7]


def _render_diagnostics(diagnostics: list[dict]) -> None:
    """Show solver/precheck failures with the affected date and condition."""
    if not diagnostics:
        return
    st.subheader("作成できない日程・条件")
    for item in diagnostics:
        day = item.get("date") or "月全体"
        condition = item.get("condition") or "条件の組み合わせ"
        st.markdown(f"**{day}**　{condition}")
        st.write(item["message"])


def _handle_create(target: str) -> None:
    """Run the solver and display results."""
    issues = precheck(target)
    if blocking_issues(issues):
        st.error("自動作成の前にエラーを解消してください。")
        _render_diagnostics([issue for issue in issues if issue["severity"] == "error"])
        return
    with st.spinner("条件を満たす勤務表を探索しています…"):
        result = generate_schedule(target, 60)
    st.session_state.last_result = result
    if result["status"] == "success":
        st.success("勤務表を作成しました。")
        m1, m2, m3 = st.columns(3)
        m1.metric("計算時間", f"{result['solver_wall_time']:.2f}秒")
        m2.metric("ペナルティ合計", f"{result['objective_value']:.0f}")
        m3.metric("希望違反", len(result["violations"]))
        st.rerun()
    else:
        st.error("勤務表を作成できませんでした。")
        diagnostics = result.get("diagnostics") or [
            {"date": None, "condition": "条件の組み合わせ", "message": v}
            for v in result.get("violations", [])
        ]
        _render_diagnostics(diagnostics)


def _handle_export(target: str, admin_export: bool = False) -> None:
    """Export current schedule to Excel."""
    latest = db.latest_schedule(target)
    if not latest or latest["status"] != "success":
        st.warning("出力できる勤務表がありません。先に自動作成を実行してください。")
        return
    try:
        path = export_schedule(latest["schedule_id"], admin_export=admin_export)
        st.session_state.export_path = str(path)
        st.success(f"保存しました: {path}")
    except Exception as exc:
        st.error(str(exc))


# ═══════════════════════════════════════════════════════════════════
# Page: 職員マスタ (unchanged)
# ═══════════════════════════════════════════════════════════════════
def render_employees() -> None:
    page_header("職員マスタ", "職員の勤務条件を登録します。職員番号は重複できません。")
    employees = db.fetch_all("employees")
    employee_names = {e["employee_id"]: e["name"] for e in employees}
    dataframe_or_empty(employee_display_frame(employees), "職員が登録されていません。", height=360)
    if employees:
        with st.expander("飲食店向けスキル一覧"):
            st.dataframe(pd.DataFrame([{
                "職員名": e["name"], "英語レベル": ENGLISH_LEVEL_LABELS.get(e.get("english_level", "none"), e.get("english_level", "none")),
                "レジ": "可" if e.get("can_cashier") else "不可", "開店": "可" if e.get("can_open") else "不可",
                "閉店": "可" if e.get("can_close") else "不可", "アイス": SKILL_LEVEL_LABELS.get(int(e.get("product_skill_ice", 0)), "不明"),
                "チョコ": SKILL_LEVEL_LABELS.get(int(e.get("product_skill_chocolate", 0)), "不明"),
                "クッキー": SKILL_LEVEL_LABELS.get(int(e.get("product_skill_cookie", 0)), "不明"),
                "新商品": SKILL_LEVEL_LABELS.get(int(e.get("new_product_skill", 0)), "不明"),
                "新人": "はい" if e.get("is_new_staff") else "いいえ",
                "教育係": "可" if e.get("can_train_new_staff") else "不可",
                "ピーク対応": SKILL_LEVEL_LABELS.get(int(e.get("peak_support_level", 0)), "不明"),
                "衛生確認": "可" if e.get("can_hygiene_check") else "不可"
            } for e in employees]), use_container_width=True, hide_index=True)
    tabs = st.tabs(["追加・編集", "Excel取り込み・出力", "削除"])
    with tabs[0]:
        ids = ["__new__"] + [e["employee_id"] for e in employees]
        selected = st.selectbox(
            "編集対象", ids,
            format_func=lambda value: "新規登録" if value == "__new__" else employee_names.get(value, "不明な職員"),
        )
        current = next((e for e in employees if e["employee_id"] == selected), {})
        with st.form("employee_form"):
            c1, c2, c3 = st.columns(3)
            employee_id = c1.text_input("職員番号 *", value=current.get("employee_id", ""), disabled=bool(current))
            name = c2.text_input("職員名 *", value=current.get("name", ""))
            role = c3.text_input("役職・区分", value=current.get("role", ""))
            skills = st.text_input("保有スキル（カンマ区切り）", value=current.get("skills", ""))
            c1, c2, c3, c4 = st.columns(4)
            active = c1.checkbox("勤務表作成対象", value=bool(current.get("active", 1)))
            night_allowed = c2.checkbox("夜勤可能", value=bool(current.get("night_allowed", 1)))
            max_consecutive = c3.number_input("最大連続勤務日数", 1, 31, int(current.get("max_consecutive_days", 5)))
            min_days = c4.number_input("月間最低勤務日数", 0, 31, int(current.get("min_work_days", 0)))
            max_days = st.number_input("月間最大勤務日数", 0, 31, int(current.get("max_work_days", 22)))
            with st.expander("飲食店向けスキル", expanded=not bool(current)):
                english_options = list(ENGLISH_LEVEL_LABELS)
                current_english = current.get("english_level", "none")
                c1, c2, c3, c4 = st.columns(4)
                english_level = c1.selectbox("英語レベル", english_options,
                                             index=english_options.index(current_english if current_english in english_options else "none"),
                                             format_func=ENGLISH_LEVEL_LABELS.get)
                can_cashier = c2.checkbox("レジ対応可", bool(current.get("can_cashier", 0)))
                can_open = c3.checkbox("開店作業可", bool(current.get("can_open", 0)))
                can_close = c4.checkbox("閉店作業可", bool(current.get("can_close", 0)))
                c1, c2, c3, c4 = st.columns(4)
                skill_options = list(SKILL_LEVEL_LABELS)
                product_skill_ice = c1.selectbox("アイス対応", skill_options,
                                                 index=min(3, max(0, int(current.get("product_skill_ice", 0)))),
                                                 format_func=SKILL_LEVEL_LABELS.get)
                product_skill_chocolate = c2.selectbox("チョコ対応", skill_options,
                                                       index=min(3, max(0, int(current.get("product_skill_chocolate", 0)))),
                                                       format_func=SKILL_LEVEL_LABELS.get)
                product_skill_cookie = c3.selectbox("クッキー対応", skill_options,
                                                    index=min(3, max(0, int(current.get("product_skill_cookie", 0)))),
                                                    format_func=SKILL_LEVEL_LABELS.get)
                new_product_skill = c4.selectbox("新商品対応", skill_options,
                                                 index=min(3, max(0, int(current.get("new_product_skill", 0)))),
                                                 format_func=SKILL_LEVEL_LABELS.get)
                c1, c2, c3, c4 = st.columns(4)
                can_explain_allergy = c1.checkbox("アレルギー説明可", bool(current.get("can_explain_allergy", 0)))
                can_handle_complaints = c2.checkbox("クレーム対応可", bool(current.get("can_handle_complaints", 0)))
                is_new_staff = c3.checkbox("新人スタッフ", bool(current.get("is_new_staff", 0)))
                can_train_new_staff = c4.checkbox("新人教育可", bool(current.get("can_train_new_staff", 0)))
                c1, c2, c3, c4 = st.columns(4)
                can_manage_cash = c1.checkbox("現金管理可", bool(current.get("can_manage_cash", 0)))
                can_hygiene_check = c2.checkbox("衛生確認可", bool(current.get("can_hygiene_check", 0)))
                peak_support_level = c3.selectbox("ピーク対応力", skill_options,
                                                  index=min(3, max(0, int(current.get("peak_support_level", 0)))),
                                                  format_func=SKILL_LEVEL_LABELS.get)
            note = st.text_area("備考", value=current.get("note", ""))
            submitted = st.form_submit_button("保存", type="primary")
        if submitted:
            data = {"employee_id": employee_id, "name": name, "role": role, "skills": skills, "active": active,
                    "night_allowed": night_allowed, "max_consecutive_days": max_consecutive,
                    "min_work_days": min_days, "max_work_days": max_days, "note": note,
                    "english_level": english_level, "can_cashier": can_cashier, "can_open": can_open,
                    "can_close": can_close, "can_handle_complaints": can_handle_complaints,
                    "can_explain_allergy": can_explain_allergy, "is_new_staff": is_new_staff,
                    "can_train_new_staff": can_train_new_staff, "product_skill_ice": product_skill_ice,
                    "product_skill_chocolate": product_skill_chocolate, "product_skill_cookie": product_skill_cookie,
                    "new_product_skill": new_product_skill, "can_manage_cash": can_manage_cash,
                    "can_hygiene_check": can_hygiene_check, "peak_support_level": peak_support_level}
            errors = validate_employee(data)
            if errors:
                st.error("\n".join(errors))
            else:
                db.upsert_employee(data); st.success("職員情報を保存しました。"); st.rerun()
    with tabs[1]:
        uploaded = st.file_uploader("職員Excelを選択", type=["xlsx"], key="employees_upload")
        if uploaded and st.button("職員Excelを取り込む"):
            try:
                count = import_employees(uploaded); st.success(f"{count}件を取り込みました。"); st.rerun()
            except Exception as exc: st.error(str(exc))
        st.download_button("職員マスタをExcel出力", export_employees_bytes(), "employees.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        st.divider()
        skill_upload = st.file_uploader("staff_skills.xlsx を選択", type=["xlsx"], key="staff_skills_upload")
        if skill_upload and st.button("スタッフスキルExcelを取り込む"):
            try:
                count = import_staff_skills(skill_upload); st.success(f"{count}件のスキルを更新しました。"); st.rerun()
            except Exception as exc: st.error(str(exc))
        st.download_button("staff_skills.xlsx を出力", export_staff_skills_bytes(), "staff_skills.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    with tabs[2]:
        delete_id = st.selectbox(
            "削除する職員", [e["employee_id"] for e in employees] or [""],
            format_func=lambda value: employee_names.get(value, "登録されていません"), key="delete_employee",
        )
        if st.button("職員を削除", type="secondary", disabled=not delete_id):
            db.delete_employee(delete_id); st.success("削除しました。"); st.rerun()


# ═══════════════════════════════════════════════════════════════════
# Page: 勤務区分 (unchanged)
# ═══════════════════════════════════════════════════════════════════
def render_shifts() -> None:
    page_header("勤務区分マスタ", "勤務時間、夜勤明け休み、Excel表示色を管理します。")
    shifts = db.fetch_all("shift_types")
    shift_names = {s["shift_code"]: s["shift_name"] for s in shifts}
    st.dataframe(shift_display_frame(shifts), use_container_width=True, hide_index=True)
    selected = st.selectbox(
        "編集対象", ["__new__"] + [s["shift_code"] for s in shifts],
        format_func=lambda value: "新規登録" if value == "__new__" else shift_names.get(value, "不明な勤務区分"),
    )
    current = next((s for s in shifts if s["shift_code"] == selected), {})
    with st.form("shift_form"):
        c1, c2, c3 = st.columns(3)
        code = c1.text_input("表示記号 *", current.get("shift_code", ""), disabled=bool(current),
                             help="勤務表の保存・計算に使う短い記号です。通常の画面には勤務区分名が表示されます。")
        name = c2.text_input("勤務区分名 *", current.get("shift_name", ""))
        is_work = c3.checkbox("勤務扱い", bool(current.get("is_work", 1)))
        c1, c2, c3 = st.columns(3)
        start = c1.text_input("開始時刻", current.get("start_time", ""), placeholder="09:00")
        end = c2.text_input("終了時刻", current.get("end_time", ""), placeholder="18:00")
        rest = c3.checkbox("翌日休みが必要", bool(current.get("requires_rest_next_day", 0)))
        color_options = list(SHIFT_COLOR_PALETTE.values())
        current_color = normalize_color(current.get("color", "FFFFFF"))
        if current_color not in color_options:
            color_options.append(current_color)
        color = st.selectbox(
            "表示色",
            color_options,
            index=color_options.index(current_color),
            format_func=color_option_label,
            help="勤務表の画面表示とExcel出力に使用する色です。",
        )
        note = st.text_area("備考", current.get("note", ""))
        save = st.form_submit_button("保存", type="primary")
    if save:
        data = {"shift_code": code, "shift_name": name, "is_work": is_work, "start_time": start,
                "end_time": end, "requires_rest_next_day": rest, "color": color, "note": note}
        errors = validate_shift_type(data)
        if errors: st.error("\n".join(errors))
        else: db.upsert_shift_type(data); st.success("勤務区分を保存しました。"); st.rerun()
    with st.expander("勤務区分を削除"):
        delete_code = st.selectbox(
            "削除する区分", [s["shift_code"] for s in shifts if s["shift_code"] != "O"],
            format_func=lambda value: shift_names.get(value, "不明な勤務区分"),
        )
        if st.button("勤務区分を削除"):
            try: db.delete_shift_type(delete_code); st.success("削除しました。"); st.rerun()
            except ValueError as exc: st.error(str(exc))


# ═══════════════════════════════════════════════════════════════════
# Page: 必要人数 (unchanged)
# ═══════════════════════════════════════════════════════════════════
def render_requirements() -> None:
    page_header("必要人数設定", "日付・勤務区分ごとの必要人数を入力します。")
    target = month_selector("req_month")
    shifts = [s for s in db.fetch_all("shift_types") if s["is_work"]]
    shift_labels = {s["shift_code"]: s["shift_name"] for s in shifts}
    existing = db.fetch_all("requirements", where="target_month=?", params=(target,))
    existing_map = {(r["date"], r["shift_code"]): r["required_count"] for r in existing}
    rows = []
    for day in month_dates(target):
        row = {"日付": day.isoformat(), "曜日": display_date(day).split("(")[-1].rstrip(")")}
        for shift in shifts:
            row[shift_labels[shift["shift_code"]]] = existing_map.get((day.isoformat(), shift["shift_code"]), 0)
        rows.append(row)
    with st.expander("平日・土日テンプレートを一括適用", expanded=not bool(existing)):
        columns = st.columns(len(shifts) or 1)
        weekday_values, weekend_values = {}, {}
        for column, shift in zip(columns, shifts):
            shift_name = shift_labels[shift["shift_code"]]
            weekday_values[shift["shift_code"]] = column.number_input(f"平日・{shift_name}", 0, 99, 4 if shift["shift_code"] == "D" else 1)
            weekend_values[shift["shift_code"]] = column.number_input(f"土日・{shift_name}", 0, 99, 2 if shift["shift_code"] == "D" else (1 if shift["shift_code"] == "N" else 0))
        if st.button("テンプレートを適用", type="primary"):
            template_rows = [{"date": day.isoformat(), "shift_code": shift["shift_code"],
                              "required_count": (weekend_values if is_weekend(day) else weekday_values)[shift["shift_code"]]}
                             for day in month_dates(target) for shift in shifts]
            db.replace_requirements(target, template_rows); st.success("テンプレートを適用しました。"); st.rerun()
    edited = st.data_editor(pd.DataFrame(rows), use_container_width=True, hide_index=True,
                            disabled=["日付", "曜日"], num_rows="fixed", key=f"req_editor_{target}")
    if st.button("必要人数を保存", type="primary"):
        saved = [{"date": row["日付"], "shift_code": shift["shift_code"],
                  "required_count": int(row[shift_labels[shift["shift_code"]]])}
                 for _, row in edited.iterrows() for shift in shifts]
        db.replace_requirements(target, saved); st.success("必要人数を保存しました。")
    c1, c2 = st.columns(2)
    with c1:
        uploaded = st.file_uploader("必要人数Excelを選択", type=["xlsx"], key="req_upload")
        if uploaded and st.button("必要人数Excelを取り込む"):
            try: count = import_requirements(uploaded, target); st.success(f"{count}件を取り込みました。"); st.rerun()
            except Exception as exc: st.error(str(exc))
    with c2:
        st.download_button("必要人数をExcel出力", export_requirements_bytes(target), f"requirements_{target}.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ═══════════════════════════════════════════════════════════════════
# Page: 希望休・勤務希望 (unchanged)
# ═══════════════════════════════════════════════════════════════════
def render_requests() -> None:
    page_header("希望休・勤務希望", "「必須」は必ず守る条件、「できる限り」は可能な範囲で考慮する条件です。")
    target = month_selector("request_month")
    requests = db.fetch_all("requests", where="target_month=?", params=(target,))
    employees = db.fetch_all("employees", where="active=1")
    shifts = db.fetch_all("shift_types")
    employee_names = {e["employee_id"]: e["name"] for e in employees}
    shift_names = {s["shift_code"]: s["shift_name"] for s in shifts}
    dataframe_or_empty(request_display_frame(requests, employees, shifts), "希望はまだ登録されていません。")
    month_days = month_dates(target)
    with st.form("request_form"):
        c1, c2, c3, c4 = st.columns(4)
        employee = c1.selectbox("職員", [e["employee_id"] for e in employees],
                                format_func=lambda value: employee_names.get(value, "不明な職員"))
        start_day = c2.date_input("開始日", value=month_days[0], min_value=month_days[0], max_value=month_days[-1])
        end_day = c3.date_input("終了日", value=month_days[0], min_value=month_days[0], max_value=month_days[-1])
        request_type = c4.selectbox("希望種別", list(REQUEST_TYPE_LABELS),
                                    format_func=lambda value: REQUEST_TYPE_LABELS[value])
        c1, c2 = st.columns(2)
        shift_code = c1.selectbox(
            "勤務区分", [s["shift_code"] for s in shifts],
            index=next((i for i, s in enumerate(shifts) if s["shift_code"] == "O"), 0),
            format_func=lambda value: shift_names.get(value, "不明な勤務区分"),
        )
        priority = c2.selectbox("優先度", list(PRIORITY_LABELS),
                                format_func=lambda value: PRIORITY_LABELS[value])
        note = st.text_input("備考")
        add = st.form_submit_button("希望を追加", type="primary")
    if add:
        try:
            count = db.add_request_range(
                {"target_month": target, "employee_id": employee,
                 "request_type": request_type, "shift_code": "O" if request_type == "off" else shift_code,
                 "priority": priority, "note": note},
                start_day,
                end_day,
            )
            st.success(f"希望を{count}件追加しました。")
            st.rerun()
        except ValueError as exc:
            st.error(str(exc))
    c1, c2 = st.columns(2)
    with c1:
        uploaded = st.file_uploader("希望Excelを選択", type=["xlsx"], key="requests_upload")
        if uploaded and st.button("希望Excelを取り込む"):
            try: count = import_requests(uploaded, target); st.success(f"{count}件を取り込みました。"); st.rerun()
            except Exception as exc: st.error(str(exc))
    with c2:
        st.download_button("希望をExcel出力", export_requests_bytes(target), f"requests_{target}.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if requests:
        request_by_id = {r["id"]: r for r in requests}
        delete_id = st.selectbox(
            "削除する希望", list(request_by_id),
            format_func=lambda value: (
                f"{employee_names.get(request_by_id[value]['employee_id'], '不明な職員')}｜"
                f"{japanese_date(request_by_id[value]['date'])}｜"
                f"{REQUEST_TYPE_LABELS.get(request_by_id[value]['request_type'], '不明')}"
            ),
        )
        if st.button("選択した希望を削除"):
            db.delete_request(delete_id); st.success("削除しました。"); st.rerun()


# ═══════════════════════════════════════════════════════════════════
# Router
# ═══════════════════════════════════════════════════════════════════
pages = {"ホーム": render_home, "勤務表": render_dashboard, "職員マスタ": render_employees,
         "勤務区分": render_shifts, "必要人数": render_requirements, "希望休・勤務希望": render_requests,
         "店舗設定": render_store_settings, "スタッフ配置相性設定": render_staff_relations,
         "新商品・イベント": render_campaigns_events, "役割別必要人数": render_role_requirements}
pages[page]()
