import { CarFront, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { FormAlert, TextField } from "../../components/form";
import { ToneChip } from "../../components/StatusChip";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { formatDate } from "../../lib/dates";
import { adminApi, type ApprovalStatus, type RiderRow } from "./admin-api";
import { ConfirmSheet, DateTimeField, formatDateTime, Loaded, Pager, SelectField, TextAreaField, toIso, useAdminRole, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

type View = "applications" | "riders";
const TONE: Record<ApprovalStatus, "amber" | "green" | "red"> = { PENDING: "amber", APPROVED: "green", REJECTED: "red" };

// Rider Requests (proposal section 17, B1): applications to review, and the
// list of approved riders with suspend / reinstate for Super Admins.
export function AdminRiderRequestsPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("applications");

  return (
    <>
      <PageHeader title={t("admin.nav.riderRequests")} />
      <div className={styles.stack}>
        <div role="tablist" className={styles.tabs}>
          {(["applications", "riders"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} className={styles.tab} onClick={() => setView(value)}>
              {t(`admin.riders.views.${value}`)}
            </button>
          ))}
        </div>
        {view === "applications" ? <Applications /> : <Riders />}
      </div>
    </>
  );
}

function Applications() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<ApprovalStatus>("PENDING");
  const [page, setPage] = useState(1);
  const { state, reload } = useLoad(() => adminApi.riderApplications(status, page), [status, page]);

  return (
    <>
      <SelectField
        label={t("admin.riders.status")}
        value={status}
        onChange={(value) => {
          setStatus(value as ApprovalStatus);
          setPage(1);
        }}
        options={(["PENDING", "APPROVED", "REJECTED"] as const).map((value) => ({ value, label: t(`rider.status.${value}`) }))}
      />
      <Loaded state={state} reload={reload}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState icon={CarFront} text={t("admin.riders.noApplications")} />
          ) : (
            <>
              <ul className={styles.list}>
                {data.items.map((application) => (
                  <li key={application.id}>
                    <Link to={`/admin/rider-requests/${application.id}`} className={`${styles.item} ${styles.itemLink}`}>
                      <div className={styles.itemHeader}>
                        <span className={styles.itemTitle}>{application.user.name ?? application.user.email}</span>
                        <ToneChip tone={TONE[application.status]} label={t(`rider.status.${application.status}`)} />
                      </div>
                      <span className={styles.muted}>
                        {t(application.kind === "INITIAL" ? "rider.application" : "rider.reverification")} ·{" "}
                        {t("admin.riders.vehicles", { count: application.vehicleCount })} · {application.user.university.name}
                      </span>
                      <span className={styles.muted}>{formatDateTime(application.submittedAt, i18n.language)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )
        }
      </Loaded>
    </>
  );
}

function Riders() {
  const { t, i18n } = useTranslation();
  const role = useAdminRole();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<{ rider: RiderRow; action: "suspend" | "reinstate" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { state, reload } = useLoad(() => adminApi.riders({ q: search, status, page }), [search, status, page]);

  return (
    <>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(q.trim());
          setPage(1);
        }}
      >
        <TextField label={t("admin.users.search")} value={q} onChange={setQ} type="search" />
        <SelectField
          label={t("admin.riders.status")}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={["", "ACTIVE", "INACTIVE", "SUSPENDED"].map((value) => ({
            value,
            label: value ? t(`admin.riders.riderStatus.${value}`) : t("admin.users.any"),
          }))}
        />
        <button type="submit" className={buttonStyles.secondary}>
          <Search aria-hidden size={18} />
          {t("admin.riders.searchButton")}
        </button>
      </form>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <Loaded state={state} reload={reload}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState icon={CarFront} text={t("admin.riders.noRiders")} />
          ) : (
            <>
              <ul className={styles.list}>
                {data.items.map((rider) => (
                  <li key={rider.id} className={styles.item}>
                    <div className={styles.itemHeader}>
                      <Link to={`/admin/users/${rider.id}`} className={styles.itemTitle}>
                        {rider.name ?? rider.email}
                      </Link>
                      <RiderStateChip rider={rider} />
                    </div>
                    <span className={styles.muted}>
                      {rider.university.name} · {t("admin.riders.vehicles", { count: rider.vehicleCount })}
                    </span>
                    <span className={styles.muted}>
                      {rider.licenceExpiresOn
                        ? t(rider.licenceExpired ? "admin.riders.licenceExpired" : "admin.riders.licenceUntil", {
                            date: formatDate(rider.licenceExpiresOn, i18n.language),
                          })
                        : "—"}
                      {rider.riderSuspended && rider.riderSuspendedUntil
                        ? ` · ${t("admin.riders.suspendedUntil", { date: formatDateTime(rider.riderSuspendedUntil, i18n.language) })}`
                        : ""}
                    </span>
                    {role === "SUPER_ADMIN" && (
                      <div className={styles.row}>
                        <button
                          type="button"
                          className={buttonStyles.secondary}
                          onClick={() => setActing({ rider, action: rider.riderSuspended ? "reinstate" : "suspend" })}
                        >
                          {t(rider.riderSuspended ? "admin.riders.reinstate" : "admin.riders.suspend")}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )
        }
      </Loaded>
      {acting && (
        <RiderAccessSheet
          rider={acting.rider}
          action={acting.action}
          onClose={() => setActing(null)}
          onDone={(message) => {
            setNotice(message);
            void reload();
          }}
        />
      )}
    </>
  );
}

function RiderStateChip({ rider }: { rider: RiderRow }) {
  const { t } = useTranslation();
  if (rider.riderSuspended) return <ToneChip tone="red" label={t("admin.riders.riderStatus.SUSPENDED")} />;
  if (rider.riderActive) return <ToneChip tone="green" label={t("admin.riders.riderStatus.ACTIVE")} />;
  return <ToneChip tone="grey" label={t("admin.riders.riderStatus.INACTIVE")} />;
}

// Suspend (reason, optional end date) or reinstate (reason). Super Admin only.
function RiderAccessSheet({
  rider,
  action,
  onClose,
  onDone,
}: {
  rider: RiderRow;
  action: "suspend" | "reinstate";
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const name = rider.name ?? rider.email;

  return (
    <ConfirmSheet
      title={t(`admin.riders.${action}Title`, { name })}
      open
      onClose={onClose}
      confirmLabel={t(`admin.riders.${action}`)}
      onConfirm={async () => {
        if (action === "suspend") await adminApi.suspendRider(rider.id, { reason, endsAt: toIso(endsAt) });
        else await adminApi.reinstateRider(rider.id, reason);
        onDone(t(`admin.riders.${action}Done`, { name }));
      }}
    >
      <TextAreaField label={t("admin.reason")} value={reason} onChange={setReason} />
      {action === "suspend" && (
        <DateTimeField label={t("admin.riders.endsAt")} value={endsAt} onChange={setEndsAt} hint={t("admin.riders.endsAtHint")} />
      )}
    </ConfirmSheet>
  );
}
