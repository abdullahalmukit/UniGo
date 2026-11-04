import { Camera, KeyRound, Mail, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Avatar } from "../../components/Avatar";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { BottomSheet, FormAlert, PasswordField, SubmitButton, TextField } from "../../components/form";
import { useToast } from "../../components/toast";
import { buttonStyles, Card, Section } from "../../components/ui";
import { VerificationChip } from "../../components/VerificationChip";
import { checkRequired, formErrors, type FormErrors } from "../../lib/errors";
import {
  changePassword,
  fileUrl,
  removePhoto,
  requestPasswordSetupLink,
  updateProfile,
  uploadPhoto,
  useMe,
  type Me,
  type ProfileInput,
} from "../account/account-api";
import settings from "../account/settings.module.css";
import { SubPageHeader } from "../account/SubPage";
import { shrinkImage } from "./shrink-image";
import styles from "./ProfilePage.module.css";

const noErrors: FormErrors = { fields: {} };
const FIELDS = ["name", "phone", "studentIdNumber", "department", "batch", "location"] as const;
type Values = Record<(typeof FIELDS)[number], string>;

// The phone as people type it: +8801712345678 -> 01712345678
const localPhone = (phone: string) => phone.replace(/^\+88/, "");

function valuesOf(me: Me): Values {
  return {
    name: me.profile?.fullName ?? "",
    phone: localPhone(me.phone),
    studentIdNumber: me.profile?.studentIdNumber ?? "",
    department: me.profile?.department ?? "",
    batch: me.profile?.batch ?? "",
    location: me.profile?.location ?? "",
  };
}

// Profile (proposal section 5, A7): photo, the user's details, verification
// status and password. Email and university cannot be changed.
export function ProfilePage() {
  const { t } = useTranslation();
  const me = useMe();
  if (!me) return null;

  return (
    <div className={settings.page}>
      <SubPageHeader title={t("profile.title")} />
      <PhotoCard me={me} />
      <AccountCard me={me} />
      <DetailsForm me={me} />
      <PasswordSection me={me} />
    </div>
  );
}

function PhotoCard({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = me.profile?.fullName ?? "";

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadPhoto(await shrinkImage(file));
      toast.show(t("profile.photoSaved"));
    } catch (failure) {
      const { form, fields } = formErrors(failure, t);
      setError(fields.photo ?? fields.file ?? form ?? t("errors.generic"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card className={styles.photoCard}>
      <Avatar name={name} src={fileUrl(me.photo)} size={88} />
      <div className={styles.photoText}>
        <span className={styles.name}>{name}</span>
        <span className={settings.caption}>{t("profile.photoHint")}</span>
        <div className={styles.photoButtons}>
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => input.current?.click()}
          >
            <Camera aria-hidden size={18} />
            {me.photo ? t("profile.changePhoto") : t("profile.addPhoto")}
          </button>
          {me.photo && (
            <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => setConfirmRemove(true)}>
              <Trash2 aria-hidden size={18} />
              {t("profile.removePhoto")}
            </button>
          )}
        </div>
        {error && <FormAlert>{error}</FormAlert>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        aria-label={t("profile.addPhoto")}
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      <ConfirmSheet
        title={t("profile.removePhotoTitle")}
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        confirmLabel={t("profile.removePhoto")}
        onConfirm={async () => {
          await removePhoto();
          toast.show(t("profile.photoRemoved"));
        }}
      >
        <p>{t("profile.removePhotoText")}</p>
      </ConfirmSheet>
    </Card>
  );
}

function AccountCard({ me }: { me: Me }) {
  const { t } = useTranslation();
  const verified = me.studentVerificationStatus === "VERIFIED";

  return (
    <Card>
      <dl className={styles.facts}>
        <dt>{t("profile.email")}</dt>
        <dd className={settings.ellipsis}>{me.email}</dd>
        <dt>{t("profile.university")}</dt>
        <dd>{me.university.name}</dd>
        <dt>{t("verification.statusTitle")}</dt>
        <dd className={styles.status}>
          <VerificationChip status={me.studentVerificationStatus} />
          {!verified && (
            <Link to="/verify-student?next=%2Faccount%2Fprofile" className={styles.inlineLink}>
              {me.studentVerificationStatus === "PENDING" ? t("account.viewVerification") : t("account.verifyNow")}
            </Link>
          )}
        </dd>
      </dl>
      <p className={`${settings.caption} ${styles.locked}`}>{t("profile.lockedHint")}</p>
    </Card>
  );
}

function DetailsForm({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [values, setValues] = useState<Values>(() => valuesOf(me));
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);
  const saved = valuesOf(me);

  // Another tab saved the profile: show its values when nothing is being edited.
  const savedKey = JSON.stringify(saved);
  const lastSaved = useRef(savedKey);
  useEffect(() => {
    if (lastSaved.current === savedKey) return;
    lastSaved.current = savedKey;
    setValues(JSON.parse(savedKey) as Values);
  }, [savedKey]);

  const set = (field: keyof Values) => (value: string) => setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const required = checkRequired(values, ["name", "phone"], t);
    if (Object.keys(required).length > 0) {
      setErrors({ fields: required });
      return;
    }
    const changes: ProfileInput = {};
    for (const field of FIELDS) {
      if (values[field].trim() !== saved[field]) changes[field] = values[field];
    }
    if (Object.keys(changes).length === 0) {
      toast.show(t("profile.nothingChanged"));
      return;
    }

    setBusy(true);
    setErrors(noErrors);
    try {
      await updateProfile(changes);
      toast.show(t("profile.saved"));
    } catch (failure) {
      setErrors(formErrors(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t("profile.details")}>
      <form className={settings.stack} onSubmit={(event) => void submit(event)} noValidate>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <TextField label={t("auth.name")} value={values.name} onChange={set("name")} error={errors.fields.name} autoComplete="name" required />
        <TextField
          label={t("auth.phone")}
          value={values.phone}
          onChange={set("phone")}
          error={errors.fields.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
        />
        <TextField label={t("profile.studentId")} value={values.studentIdNumber} onChange={set("studentIdNumber")} error={errors.fields.studentIdNumber} />
        <TextField label={t("profile.department")} value={values.department} onChange={set("department")} error={errors.fields.department} />
        <TextField label={t("profile.batch")} value={values.batch} onChange={set("batch")} error={errors.fields.batch} />
        <TextField
          label={t("profile.location")}
          value={values.location}
          onChange={set("location")}
          error={errors.fields.location}
          hint={t("profile.locationHint")}
        />
        <SubmitButton busy={busy}>{t("profile.save")}</SubmitButton>
      </form>
    </Section>
  );
}

function PasswordSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async () => {
    setSending(true);
    setError(null);
    try {
      await requestPasswordSetupLink();
      toast.show(t("profile.setupLinkSent"));
    } catch (failure) {
      setError(formErrors(failure, t).form ?? t("errors.generic"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Section title={t("profile.password")}>
      <Card className={settings.stack}>
        {me.hasPassword ? (
          <>
            <p className={settings.caption}>{t("profile.changePasswordHint")}</p>
            <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
              <KeyRound aria-hidden size={18} />
              {t("profile.changePassword")}
            </button>
          </>
        ) : (
          <>
            <p className={settings.caption}>{t("profile.setPasswordHint")}</p>
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={sending}
              aria-busy={sending || undefined}
              onClick={() => void sendLink()}
            >
              <Mail aria-hidden size={18} />
              {t("profile.sendSetupLink")}
            </button>
          </>
        )}
        {error && <FormAlert>{error}</FormAlert>}
      </Card>
      <ChangePasswordSheet open={open} onClose={() => setOpen(false)} />
    </Section>
  );
}

function ChangePasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValues({ currentPassword: "", newPassword: "", confirm: "" });
      setErrors(noErrors);
    }
  }, [open]);

  const set = (field: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields = checkRequired(values, ["currentPassword", "newPassword", "confirm"], t);
    if (!fields.confirm && values.newPassword !== values.confirm) fields.confirm = t("errors.passwordMismatch");
    if (Object.keys(fields).length > 0) {
      setErrors({ fields });
      return;
    }
    setBusy(true);
    setErrors(noErrors);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      toast.show(t("profile.passwordChanged"));
      onClose();
    } catch (failure) {
      setErrors(formErrors(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={t("profile.changePassword")} open={open} onClose={onClose}>
      <form className={settings.stack} onSubmit={(event) => void submit(event)} noValidate>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <PasswordField
          label={t("profile.currentPassword")}
          value={values.currentPassword}
          onChange={set("currentPassword")}
          error={errors.fields.currentPassword}
          autoComplete="current-password"
        />
        <PasswordField
          label={t("profile.newPassword")}
          value={values.newPassword}
          onChange={set("newPassword")}
          error={errors.fields.newPassword}
          hint={t("auth.passwordHint")}
          autoComplete="new-password"
        />
        <PasswordField
          label={t("profile.confirmPassword")}
          value={values.confirm}
          onChange={set("confirm")}
          error={errors.fields.confirm}
          autoComplete="new-password"
        />
        <p className={settings.caption}>{t("profile.otherDevicesLoggedOut")}</p>
        <SubmitButton busy={busy}>{t("profile.changePassword")}</SubmitButton>
      </form>
    </BottomSheet>
  );
}
