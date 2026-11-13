// Small building blocks shared by the admin pages.
import { DateTimeInput } from "../../components/DateTimeInput";
import { ShieldOff } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useSession } from "../../app/use-session";
import { BottomSheet, FormAlert } from "../../components/form";
import formStyles from "../../components/form.module.css";
import statusStyles from "../../components/StatusChip.module.css";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { DISPLAY_TIME_ZONE } from "../../lib/dates";
import type { TFunction } from "i18next";
import { ApiError } from "../../lib/api";
import { formErrors } from "../../lib/errors";
import type { AccountStatus, Role } from "./admin-api";
import styles from "./admin.module.css";

export function useAdminRole(): Role | null {
  const state = useSession();
  if (state.status !== "authenticated") return null;
  const role = state.session.user.role;
  return role === "MODERATOR" || role === "SUPER_ADMIN" || role === "USER" ? role : null;
}

export const isAdminRole = (role: Role | null) => role === "MODERATOR" || role === "SUPER_ADMIN";

// Loads data for a page and reloads it on demand.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message?: string } | { status: "ready"; data: T }>({
    status: "loading",
  });
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    try {
      setState({ status: "ready", data: await run() });
    } catch (err) {
      console.error("[useLoad] failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "error", message });
    }
  }, [run]);

  useEffect(() => {
    setState({ status: "loading" });
    void reload();
  }, [reload]);

  return { state, reload };
}

export function Loaded<T>({
  state,
  reload,
  children,
}: {
  state: ReturnType<typeof useLoad<T>>["state"];
  reload: () => void;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (state.status === "loading") return <p role="status" className={styles.muted}>{t("admin.loading")}</p>;
  if (state.status === "error") {
    return (
      <div className={styles.stack}>
        <FormAlert>{t("admin.loadFailed")}{state.message ? `: ${state.message}` : ""}</FormAlert>
        <button type="button" className={buttonStyles.secondary} onClick={reload}>
          {t("admin.retry")}
        </button>
      </div>
    );
  }
  return <>{children(state.data)}</>;
}

export function NotAllowed() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("admin.notAllowedTitle")} />
      <EmptyState
        icon={ShieldOff}
        text={t("admin.notAllowed")}
        action={
          <Link to="/" className={buttonStyles.primary}>
            {t("notFound.back")}
          </Link>
        }
      />
    </>
  );
}

const ACCOUNT_TONE: Record<AccountStatus, "green" | "amber" | "red"> = {
  ACTIVE: "green",
  RESTRICTED: "amber",
  SUSPENDED: "red",
  BANNED: "red",
};

export function AccountStatusChip({ status }: { status: AccountStatus }) {
  const { t } = useTranslation();
  const tone = ACCOUNT_TONE[status];
  return (
    <span className={`${statusStyles.chip} ${statusStyles[tone]}`} data-tone={tone}>
      {t(`admin.accountStatus.${status}`)}
    </span>
  );
}

export function formatDateTime(value: string | null, language: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className={formStyles.field}>
      <label htmlFor={id} className={formStyles.label}>
        {label}
      </label>
      <select id={id} className={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div className={formStyles.field}>
      <label htmlFor={id} className={formStyles.label}>
        {label}
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        value={value}
        maxLength={500}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <p className={formStyles.error}>{error}</p>}
    </div>
  );
}

// A date and a 12-hour time (B3b-1); the value is "YYYY-MM-DDTHH:mm" as before.
export function DateTimeField({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <DateTimeInput label={label} value={value} onChange={onChange} hint={hint} />;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className={styles.pager}>
      <button type="button" className={buttonStyles.secondary} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t("admin.previous")}
      </button>
      <span className={styles.muted}>{t("admin.pageOf", { page, pages })}</span>
      <button type="button" className={buttonStyles.secondary} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t("admin.next")}
      </button>
    </div>
  );
}

// A confirm step before an action; shows the server's error if it fails.
export function ConfirmSheet({
  title,
  open,
  onClose,
  confirmLabel,
  onConfirm,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sheet moves focus whenever its onClose changes, so hand it a stable one;
  // otherwise typing in a parent-held field would move focus on every key.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      close();
    } catch (failure) {
      setError(adminError(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={title} open={open} onClose={close}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, maxHeight: "calc(72vh - 64px)" }}>
        <div style={{ overflowY: "auto", flex: 1, paddingRight: "4px", minHeight: 0, display: "grid", gap: "var(--space-3)" }}>
          {children}
          {error && <FormAlert>{error}</FormAlert>}
        </div>
        <div className={styles.row} style={{ flexShrink: 0, paddingTop: "12px", marginTop: "12px", borderTop: "1px solid var(--color-border)" }}>
          <button type="button" className={buttonStyles.secondary} onClick={close}>
            {t("admin.cancel")}
          </button>
          <button type="button" className={buttonStyles.primary} disabled={busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// datetime-local value (browser time) -> ISO string, or undefined when empty.
export const toIso = (value: string) => (value ? new Date(value).toISOString() : undefined);

// One translated message for a failed admin request.
export function adminError(failure: unknown, t: TFunction) {
  if (failure instanceof ApiError && failure.code === "VALIDATION_ERROR") {
    if (failure.fields && Object.keys(failure.fields).length > 0) {
      const details = Object.entries(failure.fields)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("; ");
      return `${t("admin.errors.invalid")} (${details})`;
    }
    return failure.fields?.reason ? t("admin.errors.reason") : t("admin.errors.invalid");
  }
  const errors = formErrors(failure, t);
  return errors.form ?? Object.values(errors.fields)[0] ?? t("errors.generic");
}
