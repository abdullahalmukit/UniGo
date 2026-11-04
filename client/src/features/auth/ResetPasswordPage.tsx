import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import { FormAlert, PasswordField, SubmitButton } from "../../components/form";
import { ApiError } from "../../lib/api";
import { checkRequired, formErrors, type FormErrors } from "../../lib/errors";
import { resetPassword } from "./auth-api";
import { AuthCard } from "./AuthLayout";
import styles from "./auth.module.css";

// Reads the token from the link's fragment (#token=…), which browsers never
// send to a server (A4 decision 2), and removes it from the address bar at
// once so it does not stay in the browser history.
function readToken(hash: string) {
  return new URLSearchParams(hash.replace(/^#/, "")).get("token") ?? "";
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [token] = useState(() => readToken(location.hash));
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(!token);

  useEffect(() => {
    if (location.hash) navigate(`${location.pathname}${location.search}`, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  const set = (field: keyof typeof values) => (value: string) => setValues((v) => ({ ...v, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fields = checkRequired(values, ["password", "confirm"], t);
    if (!fields.confirm && values.confirm !== values.password) fields.confirm = t("errors.passwordMismatch");
    if (Object.keys(fields).length) return setErrors({ fields });

    setBusy(true);
    setErrors({ fields: {} });
    try {
      await resetPassword(token, values.password);
      navigate("/login?reset=done", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_RESET_TOKEN") setLinkInvalid(true);
      setErrors(formErrors(error, t));
    } finally {
      setBusy(false);
    }
  }

  if (linkInvalid) {
    return (
      <AuthCard title={t("auth.reset.title")}>
        <FormAlert>{token ? t("errors.INVALID_RESET_TOKEN") : t("auth.reset.missing")}</FormAlert>
        <p className={styles.footer}>
          <Link to="/forgot-password" className={styles.link}>
            {t("auth.reset.requestNew")}
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.reset.title")}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <PasswordField
          label={t("auth.reset.password")}
          autoComplete="new-password"
          hint={t("auth.passwordHint")}
          value={values.password}
          onChange={set("password")}
          error={errors.fields.password}
        />
        <PasswordField
          label={t("auth.reset.confirm")}
          autoComplete="new-password"
          value={values.confirm}
          onChange={set("confirm")}
          error={errors.fields.confirm}
        />
        <SubmitButton busy={busy}>{t("auth.reset.submit")}</SubmitButton>
      </form>
    </AuthCard>
  );
}
