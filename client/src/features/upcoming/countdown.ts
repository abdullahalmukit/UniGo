import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const MINUTE = 60 * 1000;

// "in 2 h 15 min" until a time; updated every minute (B3b-1 addition 4).
export function useCountdown(target: string | null) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, [target]);

  if (!target) return null;
  return countdownText(new Date(target).getTime() - now, t, i18n.language);
}

export function countdownText(ms: number, t: (key: string, options?: Record<string, unknown>) => string, language: string) {
  const number = new Intl.NumberFormat(language === "bn" ? "bn-BD" : "en");
  if (ms <= 0) return t("upcoming.startingNow");
  const totalMinutes = Math.ceil(ms / MINUTE);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return t("upcoming.inDays", { days: number.format(days), hours: number.format(hours) });
  if (hours > 0) return t("upcoming.inHours", { hours: number.format(hours), minutes: number.format(minutes) });
  return t("upcoming.inMinutes", { minutes: number.format(minutes) });
}
