import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert, TextField } from "../../components/form";
import { buttonStyles, PageHeader, Section } from "../../components/ui";
import { adminApi } from "./admin-api";
import { adminError, formatDateTime, Loaded, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

// Fare Settings (Super Admin, B3a): the rate per km behind the suggested fare
// (proposal 8.2). A new rate applies from now; older ones stay as history.
export function AdminFareSettingsPage() {
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(adminApi.fareSettings, []);
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await adminApi.setFareRate(Number(rate));
      setRate("");
      setNotice(t("admin.fares.saved"));
      await reload();
    } catch (failure) {
      setError(adminError(failure, t));
    }
  };

  return (
    <>
      <PageHeader title={t("admin.nav.fareSettings")} />
      <div className={styles.stack}>
        <Loaded state={state} reload={reload}>
          {(data) => (
            <>
              <Section title={t("admin.fares.current")}>
                <p>{data.current === null ? t("admin.fares.none") : t("admin.fares.rate", { rate: data.current })}</p>
                <form className={styles.row} onSubmit={(event) => void save(event)} noValidate>
                  <TextField
                    label={t("admin.fares.newRate")}
                    type="number"
                    inputMode="decimal"
                    min={data.limits.min}
                    max={data.limits.max}
                    step="0.01"
                    value={rate}
                    onChange={setRate}
                    hint={t("admin.fares.hint", { min: data.limits.min, max: data.limits.max })}
                  />
                  <button type="submit" className={buttonStyles.primary} disabled={!rate}>
                    {t("admin.fares.save")}
                  </button>
                </form>
                {error && <FormAlert>{error}</FormAlert>}
                {notice && <FormAlert tone="success">{notice}</FormAlert>}
              </Section>
              <Section title={t("admin.fares.history")}>
                {data.history.length === 0 ? (
                  <p className={styles.muted}>{t("admin.fares.none")}</p>
                ) : (
                  <ul className={styles.list}>
                    {data.history.map((row) => (
                      <li key={row.id} className={styles.row}>
                        <span>{t("admin.fares.rate", { rate: row.ratePerKm })}</span>
                        <span className={styles.muted}>{formatDateTime(row.effectiveFrom, i18n.language)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </Loaded>
      </div>
    </>
  );
}
