import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { FormAlert, PasswordField, SubmitButton, TextField } from "../../components/form";
import { checkRequired, formErrors, type FormErrors } from "../../lib/errors";
import { register } from "./auth-api";
import { AuthCard } from "./AuthLayout";
import { UniversityPicker } from "./UniversityPicker";
import { nextQuery, useNext, useRedirectIfSignedIn } from "./use-auth-redirect";
import styles from "./auth.module.css";

const empty = { name: "", email: "", phone: "", universityId: "", password: "" };

// Name, email, Bangladesh mobile number, university and password. The password
// and phone rules are checked by the server (A5b decision); the rule is shown
// as a hint. The browser's language and theme go with the request.
export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const next = useNext();
  const leaving = useRedirectIfSignedIn(next);
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);

  const set = (field: keyof typeof empty) => (value: string) => setValues((v) => ({ ...v, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fields = checkRequired(values, Object.keys(empty), t);
    if (Object.keys(fields).length) return setErrors({ fields });

    setBusy(true);
    setErrors({ fields: {} });
    leaving.current = true;
    try {
      await register({ ...values, name: values.name.trim(), email: values.email.trim() });
      navigate(`/verify-student${nextQuery(next)}`, { replace: true });
    } catch (error) {
      leaving.current = false;
      setErrors(formErrors(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("auth.register.title")} subtitle={t("auth.register.subtitle")}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <TextField label={t("auth.name")} autoComplete="name" value={values.name} onChange={set("name")} error={errors.fields.name} />
        <TextField
          label={t("auth.email")}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={values.email}
          onChange={set("email")}
          error={errors.fields.email}
        />
        <TextField
          label={t("auth.phone")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={t("auth.phonePlaceholder")}
          value={values.phone}
          onChange={set("phone")}
          error={errors.fields.phone}
        />
        <UniversityPicker value={values.universityId} onChange={set("universityId")} error={errors.fields.universityId} />
        <PasswordField
          label={t("auth.password")}
          autoComplete="new-password"
          hint={t("auth.passwordHint")}
          value={values.password}
          onChange={set("password")}
          error={errors.fields.password}
        />
        <SubmitButton busy={busy}>{t("auth.register.submit")}</SubmitButton>
      </form>

      <p className={styles.footer}>
        {t("auth.register.haveAccount")}{" "}
        <Link to={`/login${nextQuery(next)}`} className={styles.link}>
          {t("auth.register.login")}
        </Link>
      </p>
    </AuthCard>
  );
}
