export const SHIFT_COLOR_PALETTE = Object.freeze({
  白: "FFFFFF",
  薄い青: "DCE9FF",
  水色: "D9F3F0",
  薄い緑: "DDF4E4",
  ミント: "E0F2E9",
  薄い黄色: "FFF4CC",
  薄いオレンジ: "FFE8CC",
  薄い赤: "FDE2E2",
  薄いピンク: "FCE4EC",
  薄い紫: "E8DDF8",
  薄いグレー: "E9ECEF",
  青: "BCD7FF",
  緑: "BFE5C8",
  黄色: "FFE38A",
  オレンジ: "FFCB8A",
  赤: "F5B7B1",
  ピンク: "F8BBD0",
  紫: "D1C4E9",
  グレー: "CDD3D8",
  濃いグレー: "ACB4BC",
});

const COLOR_NAME_BY_VALUE = new Map(
  Object.entries(SHIFT_COLOR_PALETTE).map(([name, value]) => [value, name]),
);

export function normalizeColor(value) {
  return String(value || "FFFFFF").replaceAll("#", "").toUpperCase();
}

export function colorName(value) {
  return COLOR_NAME_BY_VALUE.get(normalizeColor(value)) ?? "その他";
}

export function colorOptionLabel(value) {
  return COLOR_NAME_BY_VALUE.get(normalizeColor(value))
    ?? "登録済みの色（パレット外）";
}
