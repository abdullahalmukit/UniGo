import { CalendarDays, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import formStyles from "../../components/form.module.css";
import { formatDate } from "../../lib/dates";
import { PersonRow, Route, taka, VehicleLine } from "../ride/RideCard";
import rideStyles from "../ride/ride.module.css";
import { getCarpoolConfig, minuteToTime, runsOn, WEEKDAYS, type CarpoolConfig, type CarpoolPost } from "./carpool-api";
import styles from "./carpool.module.css";

let configCache: Promise<CarpoolConfig> | null = null;

// Limits from the server (rules.ts), never hard-coded here.
export function useCarpoolConfig() {
  const [config, setConfig] = useState<CarpoolConfig | null>(null);
  useEffect(() => {
    configCache ??= getCarpoolConfig().catch((error) => {
      configCache = null;
      throw error;
    });
    let cancelled = false;
    configCache.then((value) => !cancelled && setConfig(value)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}

// "8:30 am" for a minute of the day (12-hour clock, B3b-1)
export function formatMinute(minute: number, language: string) {
  const [h, m] = minuteToTime(minute).split(":").map(Number) as [number, number];
  return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 0, 1, h, m)),
  );
}

// "Sun, Tue, Thu · 8:30 am"
export function ScheduleLine({ daysOfWeek, departureMinute }: { daysOfWeek: number; departureMinute: number }) {
  const { t, i18n } = useTranslation();
  const days = daysOfWeek === 127 ? t("carpool.days.everyDay") : WEEKDAYS.filter((d) => runsOn(daysOfWeek, d)).map((d) => t(`carpool.days.short.${d}`)).join(", ");
  return (
    <span className={rideStyles.meta}>
      <Repeat aria-hidden size={14} />
      <span>
        {days} · {formatMinute(departureMinute, i18n.language)}
      </span>
    </span>
  );
}

export function DateRange({ from, until }: { from: string; until: string | null }) {
  const { t, i18n } = useTranslation();
  return (
    <span className={rideStyles.meta}>
      <CalendarDays aria-hidden size={14} />
      <span>
        {until
          ? t("carpool.dates.range", { from: formatDate(`${from}T00:00:00+06:00`, i18n.language), until: formatDate(`${until}T00:00:00+06:00`, i18n.language) })
          : t("carpool.dates.from", { from: formatDate(`${from}T00:00:00+06:00`, i18n.language) })}
      </span>
    </span>
  );
}

export const showDate = (date: string, language: string) => formatDate(`${date}T00:00:00+06:00`, language);

// The lowest monthly price, for cards
export function PriceFrom({ post }: { post: Pick<CarpoolPost, "prices"> }) {
  const { t, i18n } = useTranslation();
  const lowest = Math.min(...post.prices.map((p) => p.monthlyPrice));
  return <span className={rideStyles.amount}>{t("carpool.priceFrom", { amount: taka(lowest, i18n.language) })}</span>;
}

// Days of the week as toggle buttons (bit 0 = Sunday)
export function DaysPicker({ value, onChange, error }: { value: number; onChange: (value: number) => void; error?: string }) {
  const { t } = useTranslation();
  return (
    <fieldset className={styles.days}>
      <legend className={formStyles.label}>{t("carpool.form.days")}</legend>
      <div className={styles.dayRow}>
        {WEEKDAYS.map((day) => (
          <button
            key={day}
            type="button"
            className={styles.day}
            aria-pressed={runsOn(value, day)}
            aria-label={t(`carpool.days.long.${day}`)}
            onClick={() => onChange(value ^ (1 << day))}
          >
            {t(`carpool.days.short.${day}`)}
          </button>
        ))}
      </div>
      {error && <p className={formStyles.error}>{error}</p>}
    </fieldset>
  );
}

// A post in Search (9.1): route, schedule, price, seats and the rider.
export function CarpoolCard({ post }: { post: CarpoolPost }) {
  const { t } = useTranslation();
  return (
    <div className={rideStyles.card}>
      <Link to={`/carpool/posts/${post.id}`} className={rideStyles.cardLink}>
        <span className={rideStyles.cardTop}>
          <span className={rideStyles.kind}>
            <Repeat aria-hidden size={14} /> {t("carpool.kind.post")}
          </span>
          <PriceFrom post={post} />
        </span>
        <ScheduleLine daysOfWeek={post.daysOfWeek} departureMinute={post.departureMinute} />
        <Route pickup={post.pickup} destination={post.destination} />
        <span className={rideStyles.meta}>
          <span>{t("ride.seatsLeft", { count: post.seatsAvailable })}</span>
          <span>{t("carpool.sessionCancellations", { count: post.riderSessionCancellations })}</span>
          {post.mine && <span>{t("ride.yours")}</span>}
        </span>
      </Link>
      <PersonRow person={post.rider} caption={t("ride.role.rider")} />
      <VehicleLine vehicle={post.vehicle} />
    </div>
  );
}
