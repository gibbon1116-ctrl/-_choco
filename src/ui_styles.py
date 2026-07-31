"""CSS constants for the dashboard schedule UI.

All CSS is kept in a single string so that app.py can inject it
via ``st.markdown(DASHBOARD_CSS, unsafe_allow_html=True)``.
"""
from __future__ import annotations

# ── colour tokens ──────────────────────────────────────────────────
NAVY      = "#10233F"
ACCENT    = "#008C95"
LINE      = "#D8E1EA"
MUTED     = "#667085"
BG        = "#F8F9FB"
WHITE     = "#FFFFFF"
SAT_COLOR = "#2B6CB0"
SUN_COLOR = "#C53030"
SHORTAGE  = "#B42318"
SURPLUS   = "#8A5300"
REQUEST   = "#C4324B"

DASHBOARD_CSS = r"""
<style>
/* ── Dashboard Header ─────────────────────────────────────────── */
.dash-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.65rem 1.2rem; background: #fff;
  border-bottom: 1px solid #D8E1EA; margin: -1rem -1rem 0.8rem -1rem;
}
.dash-header-title {
  font-size: 1.45rem; font-weight: 800; color: #10233F;
  letter-spacing: -0.03em;
}
.dash-header-right {
  display: flex; align-items: center; gap: 1.1rem; font-size: 0.88rem; color: #667085;
}
.dash-header-right .notif { font-size: 1.15rem; cursor: pointer; }
.dash-header-right .store-badge {
  background: #F0F2F5; padding: 0.3rem 0.8rem; border-radius: 6px;
  font-weight: 600; color: #344054;
}

/* ── Toolbar ──────────────────────────────────────────────────── */
.dash-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem;
  padding: 0.55rem 0; margin-bottom: 0.3rem;
}
.tb-group {
  display: flex; align-items: center; gap: 0.35rem;
}
.tb-seg { display: inline-flex; border: 1px solid #D8E1EA; border-radius: 7px; overflow: hidden; }
.tb-seg-btn {
  padding: 0.32rem 0.85rem; font-size: 0.82rem; font-weight: 600;
  background: #fff; color: #344054; border: none; cursor: pointer;
  border-right: 1px solid #D8E1EA; transition: all 0.15s;
}
.tb-seg-btn:last-child { border-right: none; }
.tb-seg-btn.active { background: #008C95; color: #fff; }
.tb-seg-btn:hover:not(.active) { background: #F0F2F5; }
.tb-nav-btn {
  width: 32px; height: 32px; border-radius: 7px; border: 1px solid #D8E1EA;
  background: #fff; font-size: 1rem; cursor: pointer; display: flex;
  align-items: center; justify-content: center; color: #344054;
  transition: all 0.15s;
}
.tb-nav-btn:hover { background: #F0F2F5; }
.tb-month {
  font-size: 1.1rem; font-weight: 700; color: #10233F;
  min-width: 110px; text-align: center;
}
.tb-spacer { flex: 1; }
.tb-primary-btn {
  padding: 0.42rem 1.1rem; border-radius: 7px; border: none;
  background: #008C95; color: #fff; font-weight: 700; font-size: 0.88rem;
  cursor: pointer; display: flex; align-items: center; gap: 0.4rem;
  transition: all 0.15s; white-space: nowrap;
}
.tb-primary-btn:hover { background: #006E75; }
.tb-secondary-btn {
  padding: 0.42rem 1.1rem; border-radius: 7px;
  border: 1px solid #D8E1EA; background: #fff; color: #344054;
  font-weight: 600; font-size: 0.88rem; cursor: pointer;
  transition: all 0.15s; white-space: nowrap;
}
.tb-secondary-btn:hover { background: #F0F2F5; }

/* ── Schedule table container ────────────────────────────────── */
.schedule-container {
  overflow-x: auto; overflow-y: auto;
  max-height: 75vh; border: 1px solid #D8E1EA;
  border-radius: 8px; background: #fff;
}
.schedule-table {
  border-collapse: separate; border-spacing: 0;
  min-width: 100%; font-size: 0.78rem;
}

/* ── Sticky columns & header ─────────────────────────────────── */
.schedule-table th, .schedule-table td {
  padding: 0; vertical-align: top;
  border-right: 1px solid #EEF1F4; border-bottom: 1px solid #EEF1F4;
}
.schedule-table thead th {
  position: sticky; top: 0; z-index: 3;
  background: #F5F7FA; font-weight: 700; text-align: center;
  color: #344054;
}
.schedule-table .col-staff {
  position: sticky; left: 0; z-index: 4;
  background: #F5F7FA; min-width: 110px; max-width: 140px;
  padding: 6px 10px; text-align: left; white-space: nowrap;
}
.schedule-table thead .col-staff { z-index: 5; }
.schedule-table tbody .col-staff {
  z-index: 2; background: #fff; border-right: 2px solid #D8E1EA;
}
.staff-name { font-weight: 700; color: #10233F; font-size: 0.82rem; }
.staff-role { font-size: 0.7rem; color: #667085; margin-top: 1px; }

/* ── Date header cells ───────────────────────────────────────── */
.date-cell { min-width: 72px; padding: 5px 2px; text-align: center; }
.date-day { font-size: 0.92rem; font-weight: 700; line-height: 1.2; }
.date-wd  { font-size: 0.72rem; font-weight: 600; }
.date-sat .date-day, .date-sat .date-wd { color: #2B6CB0; }
.date-sun .date-day, .date-sun .date-wd { color: #C53030; }.date-event { color: #B45309; font-size: 0.68rem; line-height: 1; margin-top: 2px; }

/* ── Summary rows ────────────────────────────────────────────── */
.summary-row td { text-align: center; font-weight: 700; font-size: 0.8rem; padding: 4px 2px; }
.summary-row .col-staff {
  background: #F5F7FA; font-weight: 700; font-size: 0.78rem;
  color: #344054; padding: 4px 10px;
}
.summary-row.row-required td { background: #F5F7FA; color: #344054; }
.summary-row.row-assigned td { background: #F5F7FA; color: #344054; }
.summary-row.row-diff td { background: #FAFAFA; }
.diff-neg { color: #B42318; }
.diff-pos { color: #8A5300; }
.diff-zero { color: #667085; }

/* ── Shift badge ─────────────────────────────────────────────── */
.shift-cell { padding: 3px 2px; text-align: center; min-height: 44px; }
.shift-badge {
  display: inline-block; border-radius: 6px;
  padding: 3px 5px; min-width: 58px;
  text-align: center; line-height: 1.25;
}
.shift-name { font-weight: 700; font-size: 0.76rem; }
.shift-time { font-size: 0.65rem; color: #475467; margin-top: 1px; }.skill-badges { display:flex; flex-wrap:wrap; justify-content:center; gap:2px; margin-top:3px; max-width:68px; }
.skill-badge {
  background:rgba(255,255,255,.82); border:1px solid rgba(16,35,63,.15); border-radius:3px;
  color:#344054; font-size:.52rem; font-weight:700; line-height:1.25; padding:1px 2px;
}

/* ── rest day ─────────────────────────────────────────────────── */
.shift-rest {
  color: #98A2B3; font-size: 0.82rem; font-weight: 500;
  display: flex; align-items: center; justify-content: center;
  min-height: 38px;
}

/* ── Request annotations ─────────────────────────────────────── */
.request-badge {
  border: 2px solid #E53E3E; border-radius: 6px;
}
.request-label {
  font-size: 0.6rem; color: #C4324B; font-weight: 700; margin-top: 1px;
}
.request-violated {
  background: #FEF2F2 !important; border-color: #C53030;
}
.request-violated .shift-name { color: #B42318; }

/* ── Weekend column bg ───────────────────────────────────────── */
.col-sat { background-color: #F0F5FF; }
.col-sun { background-color: #FFF5F5; }

/* ── Responsive ──────────────────────────────────────────────── */
@media (max-width: 768px) {
  .dash-header { padding: 0.5rem 0.6rem; }
  .dash-toolbar { gap: 0.35rem; }
  .tb-primary-btn, .tb-secondary-btn { padding: 0.35rem 0.65rem; font-size: 0.8rem; }
  .schedule-table { font-size: 0.72rem; }
  .date-cell { min-width: 58px; }
  .shift-badge { min-width: 48px; }
  .col-staff { min-width: 85px; }
}
</style>
"""

# Base app CSS (Streamlit overrides) kept from original app.py
APP_BASE_CSS = r"""
<style>
:root { --navy:#10233F; --accent:#008c95; --line:#d8e1ea; --muted:#667085; }
.stApp { background:#fff; color:#111827; }
[data-testid="stSidebar"] { background:#082b4c; border-right:0; }
[data-testid="stSidebar"] * { color:#f8fafc; }
[data-testid="stSidebar"] .stRadio label { padding:.42rem .65rem; border-radius:8px; margin:.08rem 0; }
[data-testid="stSidebar"] .stRadio label:hover { background:#0d476c; }
[data-testid="stSidebar"] hr { border-color:#29405d; }
.block-container { padding-top:1.6rem; padding-bottom:3rem; max-width:1500px; }
h1 { font-size:2rem !important; letter-spacing:-.035em; margin-bottom:.4rem !important; }
h2 { font-size:1.35rem !important; margin-top:1.8rem !important; }
h3 { font-size:1.05rem !important; }
[data-testid="stMetric"] { border-right:1px solid var(--line); padding:.35rem 1.1rem; }
[data-testid="stMetricLabel"] { color:#344054; }
[data-testid="stMetricValue"] { color:var(--navy); font-weight:700; font-size:1.75rem; }
.status-rail { border-top:4px solid var(--accent); padding-top:.55rem; color:var(--navy); font-weight:700; }
.section-line { border-top:1px solid var(--line); margin:1.25rem 0; }
.guide { border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:1rem 0; color:#344054; }
.guide strong { color:var(--accent); margin-right:.4rem; }
.stButton > button[kind="primary"] { background:var(--accent); border-color:var(--accent); font-weight:700; }
.stButton > button, .stDownloadButton > button { border-radius:7px; min-height:2.6rem; }
[data-testid="stDataFrame"], [data-testid="stDataEditor"] { border:1px solid var(--line); border-radius:5px; overflow:hidden; }
div[data-baseweb="select"] > div, .stTextInput input, .stNumberInput input { border-radius:7px; }
.small-note { color:var(--muted); font-size:.88rem; }
@media (max-width: 768px) {
  .block-container { padding:1rem .8rem 2rem; max-width:100%; }
  h1 { font-size:1.45rem !important; }
  [data-testid="stHorizontalBlock"] { flex-wrap:wrap; gap:.7rem; }
  [data-testid="column"] { min-width:150px; flex:1 1 45% !important; }
  [data-testid="stMetric"] { padding:.25rem .45rem; }
}
</style>
"""
