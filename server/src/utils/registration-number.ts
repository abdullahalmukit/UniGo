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
