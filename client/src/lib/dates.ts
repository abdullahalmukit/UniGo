// Times are stored in UTC and always shown in Asia/Dhaka (CLAUDE.md section 9).
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
  const time = new Intl.DateTimeFormat(locale, { timeZone: DISPLAY_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(date);
  if (day(date) === day(now)) return time;
  const dayText = new Intl.DateTimeFormat(locale, { timeZone: DISPLAY_TIME_ZONE, day: "numeric", month: "short" }).format(date);
  return `${dayText}, ${time}`;
}
