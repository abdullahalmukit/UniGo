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
