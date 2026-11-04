import { IdCard, Mail } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { buttonStyles } from "../../components/ui";
import { VerificationChip } from "../../components/VerificationChip";
import { ApiError } from "../../lib/api";
import { formatDate } from "../../lib/dates";
import { checkRequired, formErrors, type FormErrors } from "../../lib/errors";
import { AuthCard } from "../auth/AuthLayout";
import authStyles from "../auth/auth.module.css";
import { useNext } from "../auth/use-auth-redirect";
import {
  confirmEmailCode,
  getStudentVerification,
  sendEmailCode,
  uploadIdCard,
  type SentCode,
  type StudentVerification,
} from "./verification-api";

type View = "choose" | "email" | "code" | "idCard";
type Load = { status: "loading" } | { status: "error" } | { status: "ready"; data: StudentVerification };

const noErrors: FormErrors = { fields: {} };

// Proposal section 4 (A6): verify with a university email code, or upload the
// student ID card for an admin to review. Shown after registration and from
// Account & Settings.
export function VerifyStudentPage() {
  const { t, i18n } = useTranslation();
  const next = useNext();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [view, setView] = useState<View>("choose");
  const [sent, setSent] = useState<SentCode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const data = await getStudentVerification();
      setLoad({ status: "ready", data });
      // A code is still waiting to be entered (for example after a reload).
      if (data.status !== "VERIFIED" && data.emailCode) {
        setSent(data.emailCode);
        setView("code");
      }
    } catch {
      setLoad({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showResult = (data: StudentVerification, message?: string) => {
    setLoad({ status: "ready", data });
    setView("choose");
    setNotice(message ?? null);
  };

  if (load.status === "loading") {
    return (
      <AuthCard title={t("verification.title")}>
        <p role="status" className={authStyles.subtitle}>
          {t("verification.loading")}
        </p>
      </AuthCard>
    );
  }

  if (load.status === "error") {
    return (
      <AuthCard title={t("verification.title")}>
        <FormAlert>{t("verification.loadFailed")}</FormAlert>
        <button type="button" className={buttonStyles.secondary} onClick={() => void refresh()}>
          {t("verification.retry")}
        </button>
      </AuthCard>
    );
  }

  const { data } = load;
  const verified = data.status === "VERIFIED";

  return (
    <AuthCard title={t("verification.title")} subtitle={verified ? undefined : t("verification.subtitle")}>
      <div className={authStyles.statusRow}>
        <span>{t("verification.statusTitle")}</span>
        <VerificationChip status={data.status} />
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {verified ? (
        <>
          <FormAlert tone="success">
            {t("verification.verified")}{" "}
            {data.verifiedBy === "UNIVERSITY_EMAIL" && data.universityEmail
              ? t("verification.verifiedByEmail", { email: data.universityEmail })
              : t("verification.verifiedByIdCard")}
          </FormAlert>
          <div className={formStyles.actions}>
            <Link to={next} replace className={formStyles.submit} style={{ display: "grid", placeItems: "center" }}>
              {t("verification.continue")}
            </Link>
          </div>
        </>
      ) : (
        <>
          {data.status === "PENDING" && data.idCard && (
            <FormAlert tone="info">
              {t("verification.pending", { date: formatDate(data.idCard.submittedAt, i18n.language) })}
            </FormAlert>
          )}
          {data.status === "REJECTED" && data.idCard?.rejectionReason && (
            <FormAlert>
              {t("verification.rejected", { reason: data.idCard.rejectionReason })} {t("verification.rejectedHint")}
            </FormAlert>
          )}

          {view === "choose" && (
            <ChooseMethod
              idCardUnderReview={data.status === "PENDING"}
              onChoose={(method) => {
                setNotice(null);
                setView(method);
              }}
            />
          )}
          {view === "email" && (
            <EmailStep
              initialEmail={sent?.email ?? ""}
              onSent={(code) => {
                setSent(code);
                setView("code");
              }}
              onBack={() => setView("choose")}
            />
          )}
          {view === "code" && sent && (
            <CodeStep
              sent={sent}
              onResent={setSent}
              onVerified={(result) => showResult(result)}
              onChangeEmail={() => setView("email")}
            />
          )}
          {view === "idCard" && (
            <IdCardStep onUploaded={(result) => showResult(result)} onBack={() => setView("choose")} />
          )}

          <p className={authStyles.footer}>
            <Link to={next} replace className={authStyles.link}>
              {t("verification.later")}
            </Link>
          </p>
        </>
      )}
    </AuthCard>
  );
}

function ChooseMethod({ idCardUnderReview, onChoose }: { idCardUnderReview: boolean; onChoose: (view: "email" | "idCard") => void }) {
  const { t } = useTranslation();
  const options = [
    { key: "email", icon: Mail, disabled: false },
    { key: "idCard", icon: IdCard, disabled: idCardUnderReview },
  ] as const;

  return (
    <ul className={authStyles.options} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {options.map(({ key, icon: Icon, disabled }) => (
        <li key={key}>
          <button
            type="button"
            className={`${authStyles.option} ${authStyles.optionButton}`}
            disabled={disabled}
            onClick={() => onChoose(key)}
          >
            <span className={authStyles.optionIcon}>
              <Icon aria-hidden size={22} />
            </span>
            <span className={authStyles.optionText}>
              <span className={authStyles.optionTitle}>{t(`verification.${key}`)}</span>
              <span className={authStyles.optionHint}>{t(`verification.${key}Hint`)}</span>
            </span>
            {disabled && <span className={authStyles.soon}>{t("verification.underReview")}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmailStep({ initialEmail, onSent, onBack }: { initialEmail: string; onSent: (sent: SentCode) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields = checkRequired({ email }, ["email"], t);
    setErrors({ fields });
    if (Object.keys(fields).length > 0) return;

    setBusy(true);
    try {
      onSent(await sendEmailCode(email.trim()));
    } catch (error) {
      setErrors(formErrors(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={authStyles.form} onSubmit={submit} noValidate>
      {errors.form && <FormAlert>{errors.form}</FormAlert>}
      <TextField
        label={t("verification.emailLabel")}
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={setEmail}
        hint={t("verification.emailFieldHint")}
        error={errors.fields.email}
      />
      <button type="button" className={authStyles.linkButton} onClick={onBack}>
        {t("verification.back")}
      </button>
      <SubmitButton busy={busy}>{t("verification.sendCode")}</SubmitButton>
    </form>
  );
}

function CodeStep({
  sent,
  onResent,
  onVerified,
  onChangeEmail,
}: {
  sent: SentCode;
  onResent: (sent: SentCode) => void;
  onVerified: (result: StudentVerification) => void;
  onChangeEmail: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(() => new Date(sent.resendAvailableAt).getTime());
  const now = useNow(resendAt);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const minutes = Math.max(1, Math.round((new Date(sent.expiresAt).getTime() - Date.now()) / 60_000));

  useEffect(() => setResendAt(new Date(sent.resendAvailableAt).getTime()), [sent.resendAvailableAt]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields = checkRequired({ code }, ["code"], t);
    setErrors({ fields });
    if (Object.keys(fields).length > 0) return;

    setBusy(true);
    try {
      onVerified(await confirmEmailCode(code.trim()));
    } catch (error) {
      const attemptsLeft = error instanceof ApiError ? error.data.attemptsLeft : undefined;
      if (error instanceof ApiError && error.code === "OTP_INVALID" && typeof attemptsLeft === "number") {
        setErrors({ fields: { code: t("verification.codeWrong", { count: attemptsLeft }) } });
      } else {
        setErrors(formErrors(error, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setErrors(noErrors);
    try {
      onResent(await sendEmailCode(sent.email));
      setCode("");
    } catch (error) {
      const availableAt = error instanceof ApiError ? error.data.resendAvailableAt : undefined;
      if (typeof availableAt === "string") setResendAt(new Date(availableAt).getTime());
      setErrors(formErrors(error, t));
    }
  };

  return (
    <form className={authStyles.form} onSubmit={submit} noValidate>
      <FormAlert tone="info">{t("verification.codeSent", { email: sent.email, minutes })}</FormAlert>
      {errors.form && <FormAlert>{errors.form}</FormAlert>}
      <TextField
        label={t("verification.codeLabel")}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(value) => setCode(value.replace(/\D/g, ""))}
        error={errors.fields.code}
      />
      <div className={authStyles.inlineActions}>
        <button type="button" className={authStyles.linkButton} disabled={secondsLeft > 0} onClick={() => void resend()}>
          {secondsLeft > 0 ? t("verification.resendIn", { seconds: secondsLeft }) : t("verification.resend")}
        </button>
        <button type="button" className={authStyles.linkButton} onClick={onChangeEmail}>
          {t("verification.changeEmail")}
        </button>
      </div>
      <SubmitButton busy={busy}>{t("verification.verify")}</SubmitButton>
    </form>
  );
}

// Only saves an upload that the server would refuse anyway; the server's
// rules (rules.uploads) decide.
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_BYTES = 5 * 1024 * 1024;

function IdCardStep({ onUploaded, onBack }: { onUploaded: (result: StudentVerification) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/") || typeof URL.createObjectURL !== "function") {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = (chosen: File | undefined) => {
    setErrors(noErrors);
    if (!chosen) return;
    if (!ACCEPTED_TYPES.includes(chosen.type)) {
      setErrors({ fields: { file: t("errors.FILE_TYPE_NOT_ALLOWED") } });
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setErrors({ fields: { file: t("errors.FILE_TOO_LARGE") } });
      return;
    }
    setFile(chosen);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setErrors({ fields: { file: t("errors.FILE_REQUIRED") } });
      return;
    }
    setBusy(true);
    try {
      onUploaded(await uploadIdCard(file));
    } catch (error) {
      setErrors(formErrors(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={authStyles.form} onSubmit={submit} noValidate>
      {errors.form && <FormAlert>{errors.form}</FormAlert>}
      <div className={formStyles.field}>
        <span className={formStyles.label}>{t("verification.fileLabel")}</span>
        {preview && <img src={preview} alt={t("verification.previewAlt")} className={authStyles.preview} />}
        {file && !preview && <p className={formStyles.hint}>{t("verification.pdfSelected", { name: file.name })}</p>}
        <label className={`${buttonStyles.secondary} ${authStyles.fileButton}`}>
          {file ? t("verification.changeFile") : t("verification.chooseFile")}
          <input
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            className={authStyles.fileInput}
            onChange={(event) => choose(event.target.files?.[0])}
          />
        </label>
        <p className={formStyles.hint}>{t("verification.fileHint")}</p>
        {errors.fields.file && (
          <p role="alert" className={formStyles.error}>
            {errors.fields.file}
          </p>
        )}
      </div>
      <p className={formStyles.hint}>{t("verification.privacy")}</p>
      <button type="button" className={authStyles.linkButton} onClick={onBack}>
        {t("verification.back")}
      </button>
      <SubmitButton busy={busy}>{t("verification.upload")}</SubmitButton>
    </form>
  );
}

// The current time, ticking every second until `until` has passed.
function useNow(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Date.now() >= until) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}
