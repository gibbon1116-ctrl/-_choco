export function validateShiftType(data) {
  const errors = [];
  if (!String(data.shift_code ?? "").trim()) {
    errors.push("勤務区分コードを入力してください。");
  }
  if (!String(data.shift_name ?? "").trim()) {
    errors.push("勤務区分名を入力してください。");
  }
  const color = String(data.color ?? "FFFFFF").replaceAll("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(color)) {
    errors.push("背景色は6桁の16進数で入力してください。");
  }
  return errors;
}
