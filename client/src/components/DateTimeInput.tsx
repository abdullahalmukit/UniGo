import { useId } from "react";
import { useTranslation } from "react-i18next";
import formStyles from "./form.module.css";
import styles from "./DateTimeInput.module.css";

// Times are always shown on a 12-hour clock with am/pm (B3b-1, Q4). The
// browser's own date-time box follows the device and may show 24-hour time,
// so the time is picked with three selects instead: hour 1-12, minute in
// 5-minute steps, AM or PM. Values stay "HH:mm" (24-hour) for the code.

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
export const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const pad = (n: number) => String(n).padStart(2, "0");

// "14:07" -> { hour: 2, minute: 5, pm: true } (minutes rounded down to the step)
export function splitTime(value: string) {
  const [h = "0", m = "0"] = value.split(":");
  const hours = Number(h) || 0;
  const minute = Math.floor((Number(m) || 0) / MINUTE_STEP) * MINUTE_STEP;
  return { hour: hours % 12 === 0 ? 12 : hours % 12, minute, pm: hours >= 12 };
}

export function joinTime(hour: number, minute: number, pm: boolean) {
  const hours = (hour % 12) + (pm ? 12 : 0);
  return `${pad(hours)}:${pad(minute)}`;
}

// A time on a 12-hour clock; value and onChange use "HH:mm", or "" for none.
export function TimeSelect({
  label,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const number = new Intl.NumberFormat(i18n.language === "bn" ? "bn-BD" : "en", { minimumIntegerDigits: 1 });
  const twoDigits = new Intl.NumberFormat(i18n.language === "bn" ? "bn-BD" : "en", { minimumIntegerDigits: 2 });
  const parts = value ? splitTime(value) : null;
  const set = (patch: Partial<{ hour: number; minute: number; pm: boolean }>) => {
    const next = { hour: 12, minute: 0, pm: false, ...parts, ...patch };
    onChange(joinTime(next.hour, next.minute, next.pm));
  };

  return (
    <fieldset className={styles.fieldset}>
      <legend className={formStyles.label}>{label}</legend>
      <div className={styles.row}>
        <select
          id={`${id}-h`}
          aria-label={t("time.hour")}
          className={styles.select}
          value={parts ? parts.hour : ""}
          onChange={(event) => (event.target.value ? set({ hour: Number(event.target.value) }) : onChange(""))}
        >
          {(optional || !parts) && <option value="">{t("time.any")}</option>}
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {number.format(h)}
            </option>
          ))}
        </select>
        <span aria-hidden>:</span>
        <select
          aria-label={t("time.minute")}
          className={styles.select}
          value={parts ? parts.minute : ""}
          disabled={!parts}
          onChange={(event) => set({ minute: Number(event.target.value) })}
        >
          {!parts && <option value="">--</option>}
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {twoDigits.format(m)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("time.period")}
          className={styles.select}
          value={parts ? (parts.pm ? "pm" : "am") : ""}
          disabled={!parts}
          onChange={(event) => set({ pm: event.target.value === "pm" })}
        >
          {!parts && <option value="">--</option>}
          <option value="am">{t("time.am")}</option>
          <option value="pm">{t("time.pm")}</option>
        </select>
      </div>
    </fieldset>
  );
}

// A date and a 12-hour time; value and onChange use "YYYY-MM-DDTHH:mm".
export function DateTimeInput({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [date = "", time = ""] = value.split("T");
  return (
    <div className={formStyles.field}>
      <label htmlFor={id} className={formStyles.label}>
        {label}
      </label>
      <div className={styles.dateTime}>
        <input
          id={id}
          type="date"
          aria-label={t("time.date")}
          className={styles.select}
          value={date}
          onChange={(event) => onChange(`${event.target.value}T${time || "09:00"}`)}
        />
        <TimeSelect label={t("time.time")} value={time} onChange={(next) => onChange(`${date}T${next}`)} />
      </div>
      {hint && <p className={formStyles.hint}>{hint}</p>}
      {error && <p className={formStyles.error}>{error}</p>}
    </div>
  );
}
