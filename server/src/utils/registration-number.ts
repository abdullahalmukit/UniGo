// Turns a vehicle registration number into the form stored in
// vehicles.registration_number_normalized, so the same plate typed differently
// ("Dhaka Metro-LA 12-3456", "dhaka metro la 123456", Bangla digits) matches.
const BANGLA_ZERO = 0x09e6;

export function normalizeRegistrationNumber(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - BANGLA_ZERO))
    .toUpperCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

// The registration number students see (proposal section 6): every digit of the
// last group of digits except the last two becomes "•", so
// "Dhaka Metro-LA 12-1234" -> "Dhaka Metro-LA 12-••34". Bangla digits too.
export function maskRegistrationNumber(value: string): string {
  const groups = [...value.matchAll(/[0-9০-৯]+/g)];
  const last = groups.at(-1);
  if (!last || last.index === undefined) return value;
  const digits = last[0];
  const keep = digits.length >= 3 ? 2 : digits.length - 1;
  const masked = "•".repeat(digits.length - keep) + digits.slice(digits.length - keep);
  return value.slice(0, last.index) + masked + value.slice(last.index + digits.length);
}
