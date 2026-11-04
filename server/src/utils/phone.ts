// Bangladesh mobile numbers only (A3 decision). Accepts 01XXXXXXXXX, 8801XXXXXXXXX
// or +8801XXXXXXXXX, with optional spaces or hyphens, and returns +8801XXXXXXXXX.
// Returns null when the value is not a Bangladesh mobile number.
const BD_MOBILE = /^(?:\+?88)?(01[3-9]\d{8})$/;

export function normalizeBdMobile(value: string): string | null {
  const match = value.replace(/[\s-]/g, "").match(BD_MOBILE);
  return match ? `+88${match[1]}` : null;
}
