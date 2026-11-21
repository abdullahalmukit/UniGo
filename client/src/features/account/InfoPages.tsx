import { Banknote, Star } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { buttonStyles, Section } from "../../components/ui";
import { api } from "../../lib/api";
import { formErrors } from "../../lib/errors";
import { SubPageHeader } from "./SubPage";
import styles from "./InfoPages.module.css";

// Proposal section 5: About Us, Payment Methods, Policy and Rate Us. Every
// text is in bn.json / en.json; long pages are lists of points.

function Points({ base }: { base: string }) {
  const { t } = useTranslation();
  const points = t(base, { returnObjects: true }) as unknown;
  if (!Array.isArray(points)) return null;
  return (
    <ul className={styles.points}>
      {points.map((point, index) => (
        <li key={index}>{String(point)}</li>
      ))}
    </ul>
  );
}

export function AboutPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <SubPageHeader title={t("info.about.title")} back="/" />
      <p className={styles.lead}>{t("info.about.lead")}</p>
      {(["services", "trust", "owner"] as const).map((key) => (
        <Section key={key} title={t(`info.about.${key}.title`)}>
          <Points base={`info.about.${key}.points`} />
        </Section>
      ))}
    </div>
  );
}

export function PaymentMethodsPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <SubPageHeader title={t("info.payments.title")} />
      <p className={styles.lead}>{t("info.payments.lead")}</p>
      <ul className={styles.methods}>
        {(["CASH", "BKASH", "NAGAD"] as const).map((method) => (
          <li key={method} className={styles.method}>
            <Banknote aria-hidden size={20} />
            <span>
              <strong>{t(`payment.methods.${method}`)}</strong>
              <br />
              <span className={styles.muted}>{t(`info.payments.methods.${method}`)}</span>
            </span>
          </li>
        ))}
      </ul>
      <Section title={t("info.payments.howTitle")}>
        <Points base="info.payments.how" />
      </Section>
    </div>
  );
}

const POLICY_SECTIONS = ["terms", "privacy", "safety", "cancellation"] as const;

export function PolicyPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <SubPageHeader title={t("info.policy.title")} back="/account" />
      <p className={styles.muted}>{t("info.policy.updated")}</p>
      <nav aria-label={t("info.policy.title")} className={styles.toc}>
        {POLICY_SECTIONS.map((key) => (
          <a key={key} href={`#policy-${key}`}>
            {t(`info.policy.${key}.title`)}
          </a>
        ))}
      </nav>
      {POLICY_SECTIONS.map((key) => (
        <section key={key} id={`policy-${key}`} className={styles.policySection}>
          <h2>{t(`info.policy.${key}.title`)}</h2>
          <Points base={`info.policy.${key}.points`} />
        </section>
      ))}
    </div>
  );
}

export function RateUsPage() {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rating === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api("/support/rate", { method: "POST", body: { rating, ...(comment.trim() && { comment: comment.trim() }) } });
      setDone(true);
    } catch (failure) {
      setError(formErrors(failure, t).form ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <SubPageHeader title={t("info.rate.title")} />
      {done ? (
        <FormAlert tone="success">{t("info.rate.thanks")}</FormAlert>
      ) : (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <p className={styles.lead}>{t("info.rate.lead")}</p>
          <div className={styles.stars} role="radiogroup" aria-label={t("info.rate.title")}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={t("info.rate.star", { count: value })}
                className={styles.star}
                onClick={() => setRating(value)}
              >
                <Star aria-hidden size={36} className={value <= rating ? styles.starOn : undefined} />
              </button>
            ))}
          </div>
          <label className={formStyles.field}>
            <span className={formStyles.label}>{t("info.rate.comment")}</span>
            <textarea className={styles.comment} rows={4} maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          {error && <FormAlert>{error}</FormAlert>}
          <button type="submit" className={buttonStyles.primary} disabled={busy || rating === 0}>
            {t("info.rate.send")}
          </button>
        </form>
      )}
    </div>
  );
}
