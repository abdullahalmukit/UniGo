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
