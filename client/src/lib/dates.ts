// Times are stored in UTC and always shown in Asia/Dhaka (CLAUDE.md section 9),
// on a 12-hour clock with am/pm, never "14:20" (B3b-1).
export const DISPLAY_TIME_ZONE = "Asia/Dhaka";

export function formatDate(value: string | Date, language: string) {
  return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

// A chat time in Asia/Dhaka: "3:05 pm" today, otherwise "4 Nov, 3:05 pm".
export function formatShortTime(value: string | Date, language = "en", now = new Date()) {
  const date = new Date(value);
  const locale = language === "bn" ? "bn-BD" : "en-GB";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE }).format(d);
  const time = new Intl.DateTimeFormat(locale, { timeZone: DISPLAY_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  if (day(date) === day(now)) return time;
  const dayText = new Intl.DateTimeFormat(locale, { timeZone: DISPLAY_TIME_ZONE, day: "numeric", month: "short" }).format(date);
  return `${dayText}, ${time}`;
}

// B3a: date-time inputs show Asia/Dhaka wall time whatever the device's zone.
// Asia/Dhaka is UTC+6 all year (no daylight saving time).
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// "2026-11-08T09:30" in Asia/Dhaka for an instant.
export function toDhakaInput(value: string | Date) {
  return new Date(new Date(value).getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 16);
}

// The instant of a "YYYY-MM-DDTHH:mm" Asia/Dhaka wall time, as an ISO string.
export function fromDhakaInput(value: string) {
  const [date, time = "00:00"] = value.split("T");
  return new Date(new Date(`${date}T${time}:00.000Z`).getTime() - DHAKA_OFFSET_MS).toISOString();
}

// "Sat 8 Nov, 9:30 am" in Asia/Dhaka, for ride cards.
export function formatRideTime(value: string | Date, language: string) {
  return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}
