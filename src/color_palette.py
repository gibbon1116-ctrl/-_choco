from __future__ import annotations


SHIFT_COLOR_PALETTE = {
    "白": "FFFFFF",
    "薄い青": "DCE9FF",
    "水色": "D9F3F0",
    "薄い緑": "DDF4E4",
    "ミント": "E0F2E9",
    "薄い黄色": "FFF4CC",
    "薄いオレンジ": "FFE8CC",
    "薄い赤": "FDE2E2",
    "薄いピンク": "FCE4EC",
    "薄い紫": "E8DDF8",
    "薄いグレー": "E9ECEF",
    "青": "BCD7FF",
    "緑": "BFE5C8",
    "黄色": "FFE38A",
    "オレンジ": "FFCB8A",
    "赤": "F5B7B1",
    "ピンク": "F8BBD0",
    "紫": "D1C4E9",
    "グレー": "CDD3D8",
    "濃いグレー": "ACB4BC",
}

COLOR_NAME_BY_VALUE = {value: name for name, value in SHIFT_COLOR_PALETTE.items()}


def normalize_color(value: object) -> str:
    return str(value or "FFFFFF").replace("#", "").upper()


def color_name(value: object) -> str:
    return COLOR_NAME_BY_VALUE.get(normalize_color(value), "その他")


def color_option_label(value: object) -> str:
    normalized = normalize_color(value)
    return COLOR_NAME_BY_VALUE.get(normalized, "登録済みの色（パレット外）")
