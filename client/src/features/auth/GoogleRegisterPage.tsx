import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import { ApiError } from "../../lib/api";
import { checkRequired, formErrors, type FormErrors } from "../../lib/errors";
import { googleRegister } from "./auth-api";
import { AuthCard } from "./AuthLayout";
import { UniversityPicker } from "./UniversityPicker";
import { nextQuery, useNext } from "./use-auth-redirect";
import styles from "./auth.module.css";

type Pending = { signupToken: string; email: string; name: string };

// A new Google user (needsRegistration): Google gave the email and a name; the
// account still needs a phone number and a university. The signup token lives
// only in the page state, never in the URL or storage.
export function GoogleRegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pending = useLocation().state as Pending | null;
  const next = useNext();
  const [values, setValues] = useState({ name: pending?.name ?? "", phone: "", universityId: "" });
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);

  if (!pending?.signupToken) return <Navigate to={`/login${nextQuery(next)}`} replace />;
  const set = (field: keyof typeof values) => (value: string) => setValues((v) => ({ ...v, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fields = checkRequired(values, ["name", "phone", "universityId"], t);
    if (Object.keys(fields).length) return setErrors({ fields });

    setBusy(true);
    setErrors({ fields: {} });
    try {
      await googleRegister({ ...values, name: values.name.trim(), signupToken: pending!.signupToken });
      navigate(`/verify-student${nextQuery(next)}`, { replace: true });
    } catch (error) {
      // The 10-minute signup token ran out: start Google sign-in again.
      if (error instanceof ApiError && error.code === "INVALID_GOOGLE_STEP_TOKEN") {
        navigate(`/login${nextQuery(next)}`, { replace: true });
        return;
      }
      setErrors(formErrors(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("auth.google.registerTitle")} subtitle={t("auth.google.registerSubtitle")}>
      <p className={styles.readOnly}>{pending.email}</p>
      <form className={styles.form} onSubmit={submit} noValidate>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        {errors.fields.email && <FormAlert>{errors.fields.email}</FormAlert>}
        <TextField label={t("auth.name")} autoComplete="name" value={values.name} onChange={set("name")} error={errors.fields.name} />
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
        <SubmitButton busy={busy}>{t("auth.register.submit")}</SubmitButton>
      </form>
    </AuthCard>
  );
}
