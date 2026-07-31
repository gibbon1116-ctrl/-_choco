from __future__ import annotations

from datetime import date

import pandas as pd
import streamlit as st

from . import db
from .calendar_utils import month_dates
from .excel_io import (
    export_product_campaigns_bytes,
    export_role_requirements_bytes,
    export_staff_relations_bytes,
    import_product_campaigns,
    import_role_requirements,
    import_staff_relations,
)
from .restaurant import (ENGLISH_LEVEL_LABELS, RELATION_LABELS, ROLE_LABELS,
                         SKILL_DEFINITIONS, SKILL_LEVEL_LABELS, skill_level_label,
                         skill_level_options)

PRIORITY_LABELS = {"hard": "必須", "soft": "できる限り"}
DEMAND_LABELS = {"low": "閑散", "normal": "通常", "high": "繁忙", "very_high": "大繁忙"}
CATEGORY_LABELS = {"ice": "アイス", "chocolate": "チョコ", "cookie": "クッキー", "other": "その他"}


def _month_options() -> list[str]:
    return [f"{year}-{month:02d}" for year in range(2025, 2029) for month in range(1, 13)]


def _month_selector(key: str) -> str:
    options = _month_options()
    current = st.session_state.get("target_month", "2026-08")
    selected = st.selectbox("対象年月", options, index=options.index(current),
                            format_func=lambda value: f"{value[:4]}年{int(value[5:])}月", key=key)
    st.session_state.target_month = selected
    return selected


def _header(title: str, description: str) -> None:
    st.title(title)
    st.caption(description)


def render_store_settings() -> None:
    _header("店舗設定", "飲食店向け制約の有効化と、店舗運営上の標準条件を設定します。")
    current = db.get_store_settings()
    current_skill_requirements = {row["skill_code"]: row for row in db.get_store_skill_requirements()}
    with st.form("store_settings_form"):
        c1, c2 = st.columns(2)
        store_name = c1.text_input("店舗名", current.get("store_name", "店舗A"))
        business_hours = c2.text_input("標準営業時間", current.get("business_hours", "10:00-21:00"))
        c1, c2, c3 = st.columns(3)
        weekday_required = c1.number_input("平日必要人数（標準）", 0, 99, int(current.get("weekday_required", 0)))
        weekend_required = c2.number_input("土日祝必要人数（標準）", 0, 99, int(current.get("weekend_required", 0)))
        restaurant_mode = c3.toggle("飲食店向け条件を有効にする", bool(current.get("restaurant_mode", 0)))
        require_english_per_shift = st.checkbox(
            "英語対応は勤務区分ごとに必要", bool(current.get("require_english_per_shift", 0)),
            help="英語対応の必要人数を、日全体ではなく各勤務区分ごとに判定します。",
        )
        st.subheader("スキル別の必須・推奨条件")
        st.caption("職員マスタの飲食店向けスキルと同じ能力を指定します。必要人数を0人にすると、そのスキルの条件は無効です。")
        skill_column_widths = [1.3, 2.1, 1.1, 1.1]
        h1, h2, h3, h4 = st.columns(skill_column_widths, vertical_alignment="bottom")
        h1.caption("スキル")
        h2.caption("最低能力")
        h3.caption("必要人数")
        h4.caption("優先度")
        skill_inputs = {}
        for definition in SKILL_DEFINITIONS:
            code = definition["code"]
            setting = current_skill_requirements.get(code, {"minimum_level": "1", "required_count": 0, "priority": "soft"})
            # Align each row to the bottom so wrapped field labels do not push
            # only that column's control down relative to its siblings.
            c1, c2, c3, c4 = st.columns(skill_column_widths, vertical_alignment="bottom")
            c1.markdown(f"**{definition['label']}**")
            options = skill_level_options(code)
            stored_level = setting.get("minimum_level", options[0])
            normalized_level = stored_level if stored_level in options else (
                int(stored_level) if definition["kind"] == "level" and str(stored_level).isdigit() and int(stored_level) in options else options[0])
            minimum_level = c2.selectbox(
                "最低能力", options,
                index=options.index(normalized_level),
                format_func=lambda value, skill_code=code: skill_level_label(skill_code, value),
                key=f"store_skill_level_{code}", label_visibility="collapsed",
            )
            required_count = c3.number_input(
                "必要人数", 0, 20,
                int(setting.get("required_count", 0)), key=f"store_skill_count_{code}",
                label_visibility="collapsed",
            )
            priority = c4.selectbox(
                "優先度", list(PRIORITY_LABELS),
                index=list(PRIORITY_LABELS).index(setting.get("priority", "soft"))
                if setting.get("priority", "soft") in PRIORITY_LABELS else 1,
                format_func=PRIORITY_LABELS.get, key=f"store_skill_priority_{code}",
                label_visibility="collapsed",
            )
            skill_inputs[code] = {"minimum_level": minimum_level, "required_count": required_count, "priority": priority}
        save = st.form_submit_button("店舗設定を保存", type="primary")
    if save:
        db.save_store_settings(locals())
        db.save_store_skill_requirements([
            {"skill_code": code, **values} for code, values in skill_inputs.items()
        ])
        st.success("店舗設定を保存しました。")
        st.rerun()


def render_staff_relations() -> None:
    _header("スタッフ配置相性設定", "管理者向け情報です。通常配布用の勤務表には出力されません。")
    employees = [e for e in db.fetch_all("employees") if e["active"]]
    names = {e["employee_id"]: e["name"] for e in employees}
    relations = db.fetch_all("staff_relations")
    display = pd.DataFrame([{
        "ID": r["id"], "スタッフ1": names.get(r["employee_id_1"], r["employee_id_1"]),
        "スタッフ2": names.get(r["employee_id_2"], r["employee_id_2"]),
        "配置ルール": RELATION_LABELS.get(r["relation_type"], r["relation_type"]),
        "優先度": PRIORITY_LABELS.get(r["priority"], r["priority"]), "重み": r["weight"],
        "有効": "有効" if r["active"] else "無効", "管理者メモ": r.get("note", "")
    } for r in relations])
    if display.empty:
        st.info("スタッフ配置条件はまだ登録されていません。")
    else:
        st.dataframe(display.drop(columns=["ID"]), use_container_width=True, hide_index=True)
    tabs = st.tabs(["追加", "Excel取り込み・出力", "削除"])
    with tabs[0]:
        if len(employees) < 2:
            st.warning("先に職員を2人以上登録してください。")
        else:
            with st.form("relation_form"):
                c1, c2 = st.columns(2)
                e1 = c1.selectbox("スタッフ1", list(names), format_func=names.get)
                e2 = c2.selectbox("スタッフ2", list(names), index=1, format_func=names.get)
                c1, c2, c3 = st.columns(3)
                relation_type = c1.selectbox("配置ルール", list(RELATION_LABELS), format_func=RELATION_LABELS.get)
                priority = c2.selectbox("優先度", list(PRIORITY_LABELS), format_func=PRIORITY_LABELS.get)
                weight = c3.number_input("重み", 1, 5000, 50)
                note = st.text_input("管理者メモ")
                active = st.checkbox("有効", True)
                submitted = st.form_submit_button("配置条件を追加", type="primary")
            if submitted:
                if e1 == e2:
                    st.error("同じスタッフ同士は登録できません。")
                else:
                    db.upsert_staff_relation({"employee_id_1": e1, "employee_id_2": e2,
                                              "relation_type": relation_type, "priority": priority,
                                              "weight": weight, "note": note, "active": active})
                    st.success("配置条件を追加しました。")
                    st.rerun()
    with tabs[1]:
        uploaded = st.file_uploader("staff_relations.xlsx を選択", type=["xlsx"], key="relations_upload")
        if uploaded and st.button("配置条件Excelを取り込む"):
            try:
                count = import_staff_relations(uploaded)
                st.success(f"{count}件を取り込みました。")
                st.rerun()
            except Exception as exc:
                st.error(str(exc))
        st.download_button("staff_relations.xlsx を出力", export_staff_relations_bytes(), "staff_relations.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    with tabs[2]:
        relation_map = {r["id"]: r for r in relations}
        if relation_map:
            selected = st.selectbox("削除する配置条件", list(relation_map), format_func=lambda rid:
                                    f"{names.get(relation_map[rid]['employee_id_1'], relation_map[rid]['employee_id_1'])}・"
                                    f"{names.get(relation_map[rid]['employee_id_2'], relation_map[rid]['employee_id_2'])}｜"
                                    f"{RELATION_LABELS.get(relation_map[rid]['relation_type'], '')}")
            if st.button("選択した配置条件を削除"):
                db.delete_staff_relation(selected)
                st.success("削除しました。")
                st.rerun()


def render_campaigns_events() -> None:
    _header("新商品・イベント設定", "新商品の販売期間と、営業日ごとのイベント・繁忙度を管理します。")
    target = _month_selector("campaign_month")
    campaign_tab, event_tab, excel_tab = st.tabs(["新商品", "営業日・イベント", "Excel取り込み・出力"])
    campaigns = db.fetch_all("product_campaigns")
    with campaign_tab:
        display = pd.DataFrame([{
            "ID": c["id"], "商品名": c["product_name"], "カテゴリ": CATEGORY_LABELS.get(c["category"], c["category"]),
            "開始日": c["start_date"], "終了日": c["end_date"],
            "必要能力": SKILL_LEVEL_LABELS.get(c["required_skill_level"], c["required_skill_level"]),
            "初週リーダー": "必要" if c["require_leader_first_week"] else "任意", "備考": c.get("note", "")
        } for c in campaigns])
        if display.empty:
            st.info("新商品キャンペーンはまだ登録されていません。")
        else:
            st.dataframe(display.drop(columns=["ID"]), use_container_width=True, hide_index=True)
        first, last = month_dates(target)[0], month_dates(target)[-1]
        with st.form("campaign_form"):
            c1, c2 = st.columns(2)
            product_name = c1.text_input("商品名")
            category = c2.selectbox("商品カテゴリ", list(CATEGORY_LABELS), format_func=CATEGORY_LABELS.get)
            c1, c2, c3 = st.columns(3)
            start_date = c1.date_input("開始日", first)
            end_date = c2.date_input("終了日", last)
            skill_options = [1, 2, 3]
            required_skill_level = c3.selectbox(
                "必要な能力", skill_options, index=1,
                format_func=SKILL_LEVEL_LABELS.get,
                help="数字ではなく、職員に想定する対応レベルで指定します。",
            )
            require_leader_first_week = st.checkbox("販売初週は指導可能者を優先", True)
            note = st.text_input("備考")
            submitted = st.form_submit_button("新商品を登録", type="primary")
        if submitted:
            if not product_name.strip() or start_date > end_date:
                st.error("商品名と販売期間を確認してください。")
            else:
                db.upsert_product_campaign({"product_name": product_name, "category": category,
                                            "start_date": start_date.isoformat(), "end_date": end_date.isoformat(),
                                            "required_skill_level": required_skill_level,
                                            "require_leader_first_week": require_leader_first_week, "note": note})
                st.success("新商品を登録しました。")
                st.rerun()
        if campaigns:
            selected = st.selectbox("削除する新商品", [c["id"] for c in campaigns],
                                    format_func=lambda cid: next(c["product_name"] for c in campaigns if c["id"] == cid))
            if st.button("選択した新商品を削除"):
                db.delete_product_campaign(selected)
                st.rerun()
    with event_tab:
        existing = {r["date"]: r for r in db.fetch_all("business_days", where="target_month=?", params=(target,))}
        rows = []
        for day in month_dates(target):
            item = existing.get(day.isoformat(), {})
            rows.append({"日付": day.isoformat(), "営業": bool(item.get("is_open", 1)),
                         "イベント日": bool(item.get("is_event_day", 0)), "イベント名": item.get("event_name", ""),
                         "需要レベル": item.get("demand_level", "normal"),
                         "新商品販売日": bool(item.get("new_product_active", 0)), "備考": item.get("note", "")})
        edited = st.data_editor(pd.DataFrame(rows), use_container_width=True, hide_index=True, disabled=["日付"],
                                column_config={"需要レベル": st.column_config.SelectboxColumn(
                                    "需要レベル", options=list(DEMAND_LABELS), help="low=閑散 / normal=通常 / high=繁忙 / very_high=大繁忙")},
                                key=f"business_days_{target}")
        if st.button("営業日・イベントを保存", type="primary"):
            for _, row in edited.iterrows():
                day = date.fromisoformat(str(row["日付"]))
                db.upsert_business_day({"target_month": target, "date": day.isoformat(), "is_open": row["営業"],
                                        "is_weekend": day.weekday() >= 5, "is_event_day": row["イベント日"],
                                        "event_name": row["イベント名"], "demand_level": row["需要レベル"],
                                        "new_product_active": row["新商品販売日"], "note": row["備考"]})
            st.success("営業日とイベントを保存しました。")
            st.rerun()
    with excel_tab:
        uploaded = st.file_uploader("product_campaigns.xlsx を選択", type=["xlsx"], key="campaign_upload")
        if uploaded and st.button("新商品Excelを取り込む"):
            try:
                count = import_product_campaigns(uploaded)
                st.success(f"{count}件を取り込みました。")
                st.rerun()
            except Exception as exc:
                st.error(str(exc))
        st.download_button("product_campaigns.xlsx を出力", export_product_campaigns_bytes(), "product_campaigns.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def render_role_requirements() -> None:
    _header("役割別必要人数", "日付・勤務区分ごとに、英語・レジ・開店・閉店などの必要人数を設定します。")
    target = _month_selector("role_req_month")
    shifts = [s for s in db.fetch_all("shift_types") if s["is_work"]]
    shift_names = {s["shift_code"]: s["shift_name"] for s in shifts}
    rows = db.fetch_all("role_requirements", where="target_month=?", params=(target,))
    display = pd.DataFrame([{"ID": r["id"], "日付": r["date"], "勤務区分": shift_names.get(r["shift_code"], r["shift_code"]),
                             "役割": ROLE_LABELS.get(r["role_code"], r["role_code"]), "必要人数": r["required_count"],
                             "優先度": PRIORITY_LABELS.get(r["priority"], r["priority"])} for r in rows])
    if display.empty:
        st.info("役割別必要人数はまだ登録されていません。")
    else:
        st.dataframe(display.drop(columns=["ID"]), use_container_width=True, hide_index=True)
    tabs = st.tabs(["追加・更新", "Excel取り込み・出力", "削除"])
    with tabs[0]:
        with st.form("role_requirement_form"):
            c1, c2, c3 = st.columns(3)
            day = c1.date_input("日付", month_dates(target)[0], min_value=month_dates(target)[0], max_value=month_dates(target)[-1])
            shift_code = c2.selectbox("勤務区分", list(shift_names), format_func=shift_names.get)
            role_code = c3.selectbox("必要な役割", list(ROLE_LABELS), format_func=ROLE_LABELS.get)
            c1, c2 = st.columns(2)
            required_count = c1.number_input("必要人数", 0, 20, 1)
            priority = c2.selectbox("優先度", list(PRIORITY_LABELS), format_func=PRIORITY_LABELS.get)
            submitted = st.form_submit_button("役割条件を保存", type="primary")
        if submitted:
            db.upsert_role_requirement({"target_month": target, "date": day.isoformat(), "shift_code": shift_code,
                                        "role_code": role_code, "required_count": required_count, "priority": priority})
            st.success("役割条件を保存しました。")
            st.rerun()
    with tabs[1]:
        uploaded = st.file_uploader("role_requirements.xlsx を選択", type=["xlsx"], key="role_req_upload")
        if uploaded and st.button("役割条件Excelを取り込む"):
            try:
                count = import_role_requirements(uploaded, target)
                st.success(f"{count}件を取り込みました。")
                st.rerun()
            except Exception as exc:
                st.error(str(exc))
        st.download_button("role_requirements.xlsx を出力", export_role_requirements_bytes(target),
                           f"role_requirements_{target}.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    with tabs[2]:
        row_map = {r["id"]: r for r in rows}
        if row_map:
            selected = st.selectbox("削除する役割条件", list(row_map), format_func=lambda rid:
                                    f"{row_map[rid]['date']}｜{shift_names.get(row_map[rid]['shift_code'], '')}｜"
                                    f"{ROLE_LABELS.get(row_map[rid]['role_code'], '')}")
            if st.button("選択した役割条件を削除"):
                db.delete_role_requirement(selected)
                st.rerun()
