// Asia/Dhaka is UTC+6 all year (no daylight saving time).
const DHAKA_OFFSET = 6 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// Midnight in Asia/Dhaka at the start of the day `now` falls in, as a UTC instant.
export function startOfDhakaDay(now = new Date()) {
  const local = now.getTime() + DHAKA_OFFSET;
  return new Date(local - (local % DAY) - DHAKA_OFFSET);
}

// "4 November 2026, 3:30 pm" in Asia/Dhaka, in Bangla or English.
export function formatDhakaDateTime(value: Date, language: "BN" | "EN") {
  return new Intl.DateTimeFormat(language === "BN" ? "bn-BD" : "en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

// Today's date in Asia/Dhaka as "YYYY-MM-DD".
export function dhakaDateString(now = new Date()) {
  return new Date(now.getTime() + DHAKA_OFFSET).toISOString().slice(0, 10);
}

// A "YYYY-MM-DD" date as stored in a DATE column (midnight UTC), and back.
export const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const dateOnlyString = (value: Date) => value.toISOString().slice(0, 10);

// "YYYY-MM-DD" plus whole years (29 February becomes 1 March).
export function addYearsToDateString(value: string, years: number) {
  const date = dateOnly(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return dateOnlyString(date);
}
