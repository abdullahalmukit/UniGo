import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { FormAlert } from "../../components/form";
import { buttonStyles, PageHeader, Section } from "../../components/ui";
import { VerificationChip } from "../../components/VerificationChip";
import { useSession } from "../../app/use-session";
import { adminApi, type AccountAction, type UserDetail } from "./admin-api";
import {
  AccountStatusChip,
  ConfirmSheet,
  DateTimeField,
  formatDateTime,
  Loaded,
  TextAreaField,
  toIso,
  useAdminRole,
  useLoad,
} from "./admin-ui";
import styles from "./admin.module.css";

// One user: profile, verification and moderation history, and the account
// actions (Super Admin only, A8 decision 3).
export function AdminUserPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { state, reload } = useLoad(() => adminApi.user(id), [id]);

  return (
    <>
      <PageHeader title={t("admin.users.detailTitle")} />
      <p>
        <Link to="/admin/users">{t("admin.users.backToList")}</Link>
      </p>
      <Loaded state={state} reload={reload}>
        {({ user }) => <UserDetailView user={user} onChanged={reload} />}
      </Loaded>
    </>
  );
}

// Which actions fit the account's current status (the server checks again).
function availableActions(user: UserDetail): AccountAction[] {
  const booked = !!user.suspendedFrom && new Date(user.suspendedFrom) > new Date();
  switch (user.accountStatus) {
    case "ACTIVE":
      return booked ? ["warn", "restrict", "suspend", "ban", "reactivate"] : ["warn", "restrict", "suspend", "ban"];
    case "RESTRICTED":
      return ["warn", "restrict", "suspend", "ban", "reactivate"];
    case "SUSPENDED":
      return ["warn", "suspend", "ban", "reactivate"];
    case "BANNED":
      return ["unban"];
  }
}

function UserDetailView({ user, onChanged }: { user: UserDetail; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const role = useAdminRole();
  const session = useSession();
  const myId = session.status === "authenticated" ? session.session.user.id : null;
  const [action, setAction] = useState<AccountAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const date = (value: string | null) => formatDateTime(value, i18n.language);

  const canAct = role === "SUPER_ADMIN" && user.id !== myId && user.role !== "SUPER_ADMIN";

  return (
    <div className={styles.stack}>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <div className={styles.item}>
        <div className={styles.itemHeader}>
          <span className={styles.itemTitle}>{user.profile?.fullName ?? user.email}</span>
          <span className={styles.row}>
            <AccountStatusChip status={user.accountStatus} />
            <VerificationChip status={user.studentVerificationStatus} />
          </span>
        </div>
        <dl className={styles.keyValues}>
          <dt>{t("admin.users.email")}</dt>
          <dd>{user.email}</dd>
          <dt>{t("admin.users.phone")}</dt>
          <dd>{user.phone}</dd>
          <dt>{t("admin.users.university")}</dt>
          <dd>{user.university.name}</dd>
          <dt>{t("admin.users.studentId")}</dt>
          <dd>{user.profile?.studentIdNumber ?? "—"}</dd>
          <dt>{t("admin.users.department")}</dt>
          <dd>{[user.profile?.department, user.profile?.batch].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>{t("admin.users.role")}</dt>
          <dd>{t(`admin.roles.${user.role}`)}</dd>
          <dt>{t("admin.users.universityEmail")}</dt>
          <dd>{user.verifiedUniversityEmail ?? "—"}</dd>
          <dt>{t("admin.users.rider")}</dt>
          <dd>{user.isVerifiedRider ? t("admin.yes") : t("admin.no")}</dd>
          <dt>{t("admin.users.joined")}</dt>
          <dd>{date(user.createdAt)}</dd>
          <dt>{t("admin.users.lastLogin")}</dt>
          <dd>{date(user.lastLoginAt)}</dd>
          {user.suspendedUntil && (
            <>
              <dt>{t("admin.users.suspension")}</dt>
              <dd>{t("admin.users.period", { from: date(user.suspendedFrom), until: date(user.suspendedUntil) })}</dd>
            </>
          )}
          {user.accountStatus === "RESTRICTED" && (
            <>
              <dt>{t("admin.users.restrictedUntil")}</dt>
              <dd>{user.restrictedUntil ? date(user.restrictedUntil) : t("admin.users.untilLifted")}</dd>
            </>
          )}
        </dl>
      </div>

      {canAct && (
        <Section title={t("admin.users.actions")}>
          <div className={styles.row}>
            {availableActions(user).map((value) => (
              <button
                key={value}
                type="button"
                className={value === "warn" || value === "reactivate" || value === "unban" ? buttonStyles.secondary : buttonStyles.primary}
                onClick={() => setAction(value)}
              >
                {t(`admin.actions.${value}`)}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title={t("admin.users.moderationHistory")}>
        {user.moderationHistory.length === 0 ? (
          <p className={styles.muted}>{t("admin.users.noHistory")}</p>
        ) : (
          <ul className={styles.list}>
            {user.moderationHistory.map((entry) => (
              <li key={entry.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={styles.itemTitle}>{t(`admin.history.${entry.type}`, { defaultValue: entry.type })}</span>
                  <span className={styles.muted}>{date(entry.createdAt)}</span>
                </div>
                <span>{entry.reason}</span>
                {(entry.startsAt || entry.endsAt) && (
                  <span className={styles.muted}>{t("admin.users.period", { from: date(entry.startsAt), until: date(entry.endsAt) })}</span>
                )}
                <span className={styles.muted}>{t("admin.users.by", { name: entry.admin.name ?? "—" })}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("admin.users.verificationHistory")}>
        {user.verifications.length === 0 ? (
          <p className={styles.muted}>{t("admin.users.noVerifications")}</p>
        ) : (
          <ul className={styles.list}>
            {user.verifications.map((row) => (
              <li key={row.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={styles.itemTitle}>{t(`admin.users.method.${row.method}`)}</span>
                  <VerificationChip status={row.status} />
                </div>
                <span className={styles.muted}>
                  {date(row.createdAt)}
                  {row.universityEmail ? ` · ${row.universityEmail}` : ""}
                </span>
                {row.rejectionReason && <span className={styles.muted}>{row.rejectionReason}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {action && (
        <ActionSheet
          user={user}
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setNotice(t("admin.users.actionDone"));
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ActionSheet({
  user,
  action,
  onClose,
  onDone,
}: {
  user: UserDetail;
  action: AccountAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  return (
    <ConfirmSheet
      title={t(`admin.actions.${action}Title`, { name: user.profile?.fullName ?? user.email })}
      open
      onClose={onClose}
      confirmLabel={t(`admin.actions.${action}`)}
      onConfirm={async () => {
        await adminApi.act(user.id, action, { reason, startsAt: toIso(startsAt), endsAt: toIso(endsAt) });
        onDone();
      }}
    >
      <p className={styles.muted}>{t(`admin.actions.${action}Text`)}</p>
      <TextAreaField label={t("admin.reason")} value={reason} onChange={setReason} />
      {action === "suspend" && (
        <div className={styles.dates}>
          <DateTimeField label={t("admin.actions.startsAt")} value={startsAt} onChange={setStartsAt} hint={t("admin.actions.startsAtHint")} />
          <DateTimeField label={t("admin.actions.endsAt")} value={endsAt} onChange={setEndsAt} />
        </div>
      )}
      {action === "restrict" && (
        <DateTimeField label={t("admin.actions.endsAt")} value={endsAt} onChange={setEndsAt} hint={t("admin.actions.restrictEndHint")} />
      )}
      <p className={styles.muted}>{t("admin.actions.emailNote")}</p>
    </ConfirmSheet>
  );
}
