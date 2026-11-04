import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import { checkRequired, formErrors, type FormErrors } from "../../lib/errors";
import { forgotPassword } from "./auth-api";
import { AuthCard } from "./AuthLayout";
import styles from "./auth.module.css";

// The same confirmation for every email, registered or not (proposal section 4).
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fields = checkRequired({ email }, ["email"], t);
    if (Object.keys(fields).length) return setErrors({ fields });

    setBusy(true);
    setErrors({ fields: {} });
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (error) {
      setErrors(formErrors(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("auth.forgot.title")} subtitle={sent ? undefined : t("auth.forgot.subtitle")}>
      {sent ? (
        <FormAlert tone="success">{t("auth.forgot.sent")}</FormAlert>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          {errors.form && <FormAlert>{errors.form}</FormAlert>}
          <TextField
            label={t("auth.email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            error={errors.fields.email}
          />
          <SubmitButton busy={busy}>{t("auth.forgot.submit")}</SubmitButton>
        </form>
      )}
      <p className={styles.footer}>
        <Link to="/login" className={styles.link}>
          {t("auth.forgot.back")}
        </Link>
      </p>
    </AuthCard>
  );
}
