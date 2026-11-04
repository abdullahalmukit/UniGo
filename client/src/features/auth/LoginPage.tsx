import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { FormAlert, PasswordField, SubmitButton, TextField } from "../../components/form";
import { ApiError } from "../../lib/api";
import { checkRequired, formErrors, type FormErrors } from "../../lib/errors";
import { googleLink, googleSignIn, login } from "./auth-api";
import { AuthCard } from "./AuthLayout";
import { GoogleButton } from "./GoogleButton";
import { nextQuery, useNext, useRedirectIfSignedIn } from "./use-auth-redirect";
import styles from "./auth.module.css";

const noErrors: FormErrors = { fields: {} };

// Email + password, Google sign-in, and the one-time password step that links
// Google to an existing password account (A4 decision 1).
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = useNext();
  const leaving = useRedirectIfSignedIn(next);

  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ linkToken: string; email: string } | null>(null);
  const [linkPassword, setLinkPassword] = useState("");

  const set = (field: keyof typeof values) => (value: string) => setValues((v) => ({ ...v, [field]: value }));

  // Runs a call that signs in; on success goes to `next`.
  async function signingIn(call: () => Promise<unknown>, onError?: (error: unknown) => boolean) {
    setBusy(true);
    setErrors(noErrors);
    leaving.current = true;
    try {
      await call();
      navigate(next, { replace: true });
    } catch (error) {
      leaving.current = false;
      if (!onError?.(error)) setErrors(formErrors(error, t));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const fields = checkRequired(values, ["email", "password"], t);
    if (Object.keys(fields).length) return setErrors({ fields });
    void signingIn(() => login(values.email.trim(), values.password));
  }

  async function onGoogle(idToken: string) {
    setErrors(noErrors);
    leaving.current = true;
    try {
      const pending = await googleSignIn(idToken);
      if (pending) {
        navigate(`/register/google${nextQuery(next)}`, { state: pending });
        return;
      }
      navigate(next, { replace: true });
    } catch (error) {
      leaving.current = false;
      if (error instanceof ApiError && error.code === "GOOGLE_LINK_REQUIRES_PASSWORD") {
        setLink({ linkToken: String(error.data.linkToken), email: String(error.data.email) });
        return;
      }
      setErrors(formErrors(error, t));
    }
  }

  function submitLink(event: FormEvent) {
    event.preventDefault();
    if (!link) return;
    if (!linkPassword) return setErrors({ fields: { password: t("errors.required") } });
    void signingIn(
      () => googleLink(link.linkToken, linkPassword),
      (error) => {
        // The link step took too long: start Google sign-in again.
        if (error instanceof ApiError && error.code === "INVALID_GOOGLE_STEP_TOKEN") {
          setLink(null);
          setErrors(formErrors(error, t));
          return true;
        }
        return false;
      },
    );
  }

  if (link) {
    return (
      <AuthCard title={t("auth.google.linkTitle")} subtitle={t("auth.google.linkText", { email: link.email })}>
        <form className={styles.form} onSubmit={submitLink} noValidate>
          {errors.form && <FormAlert>{errors.form}</FormAlert>}
          <PasswordField
            label={t("auth.password")}
            value={linkPassword}
            onChange={setLinkPassword}
            error={errors.fields.password}
            autoComplete="current-password"
            autoFocus
          />
          <p className={styles.footer}>
            {t("auth.google.linkForgot")}{" "}
            <Link to="/forgot-password" className={styles.link}>
              {t("auth.login.forgot")}
            </Link>
          </p>
          <SubmitButton busy={busy}>{t("auth.google.linkSubmit")}</SubmitButton>
          <button type="button" className={styles.linkButton} onClick={() => (setLink(null), setErrors(noErrors))}>
            {t("auth.google.cancel")}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.login.title")} subtitle={t("auth.login.subtitle")}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {params.get("reset") === "done" && <FormAlert tone="success">{t("auth.login.passwordChanged")}</FormAlert>}
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <TextField
          label={t("auth.email")}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={values.email}
          onChange={set("email")}
          error={errors.fields.email}
        />
        <PasswordField
          label={t("auth.password")}
          autoComplete="current-password"
          value={values.password}
          onChange={set("password")}
          error={errors.fields.password}
        />
        <div className={styles.row}>
          {/* Same words as in the "password changed" email (A5b decision). */}
          <Link to="/forgot-password" className={styles.link}>
            {t("auth.login.forgot")}
          </Link>
        </div>
        <SubmitButton busy={busy}>{t("auth.login.submit")}</SubmitButton>
      </form>

      <GoogleButton onCredential={(idToken) => void onGoogle(idToken)} />

      <p className={styles.footer}>
        {t("auth.login.noAccount")}{" "}
        <Link to={`/register${nextQuery(next)}`} className={styles.link}>
          {t("auth.login.register")}
        </Link>
      </p>
    </AuthCard>
  );
}
