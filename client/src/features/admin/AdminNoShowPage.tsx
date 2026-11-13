import { Flag } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { EmptyState, PageHeader, Section } from "../../components/ui";
import { api } from "../../lib/api";
import type { AdminPerson } from "./admin-rides-api";
import { adminError, ConfirmSheet, formatDateTime, Loaded, Pager, SelectField, TextAreaField, useLoad } from "./admin-ui";
import { Person } from "./AdminRideDetailPage";
import styles from "./admin.module.css";

// Admin › Food No-Show Reports (B7): list, detail and resolve/dismiss.
// Proposal §10.4 — Moderators and Super Admins.

const STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"];
const MOD_ACTIONS = ["WARN", "RESTRICT", "SUSPEND", "BAN"];

type NoShowRow = {
  id: string;
  status: string;
  createdAt: string;
  reporter: AdminPerson;
  reportedUser: AdminPerson;
};

type NoShowDetail = {
  id: string;
  activityId: string;
  status: string;
  description: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  evidence: { url: string; expiresAt: string } | null;
  reporter: AdminPerson;
  reportedUser: AdminPerson;
  createdAt: string;
};

const enc = encodeURIComponent;
function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `?${search}`;
}

export const adminNoShowApi = {
  list: (page: number, status?: string) =>
    api<{ items: NoShowRow[]; total: number; page: number; pageSize: number }>(`/admin/no-shows${query({ page, status })}`),
  get: (id: string) => api<{ report: NoShowDetail }>(`/admin/no-shows/${enc(id)}`).then((r) => r.report),
  resolve: (id: string, body: { status: "RESOLVED" | "DISMISSED"; resolutionNote: string; action?: string; actionReason?: string; suspensionDays?: number }) =>
    api<{ report: NoShowDetail }>(`/admin/no-shows/${enc(id)}/resolve`, { method: "POST", body }),
};

export function AdminNoShowPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const { state, reload } = useLoad(() => adminNoShowApi.list(page, status || undefined), [status, page]);

  return (
    <>
      <PageHeader title={t("admin.nav.noShows")} />
      <div className={styles.stack}>
        <div className={styles.filters}>
          <SelectField
            label={t("admin.rides.status")}
            value={status}
            onChange={(value) => { setStatus(value); setPage(1); }}
            options={[{ value: "", label: t("admin.users.any") }, ...STATUSES.map((value) => ({ value, label: t(`admin.noShows.status.${value}`) }))]}
          />
        </div>
        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={Flag} text={t("admin.noShows.empty")} />
            ) : (
              <>
                <p className={styles.muted}>{t("admin.noShows.count", { count: data.total })}</p>
                <ul className={styles.list}>
                  {data.items.map((row) => (
                    <li key={row.id}>
                      <Link to={`/admin/no-shows/${row.id}`} className={styles.itemLink}>
                        <div className={styles.itemHeader}>
                          <span className={styles.itemTitle}>{row.reporter?.name ?? "?"} → {row.reportedUser?.name ?? "?"}</span>
                          <span className={styles.chip}>{t(`admin.noShows.status.${row.status}`)}</span>
                        </div>
                        <span className={styles.muted}>{formatDateTime(row.createdAt, i18n.language)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </>
            )
          }
        </Loaded>
      </div>
    </>
  );
}

export function AdminNoShowDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminNoShowApi.get(id), [id]);

  const [sheet, setSheet] = useState(false);
  const [decision, setDecision] = useState<"RESOLVED" | "DISMISSED">("RESOLVED");
  const [resolutionNote, setResolutionNote] = useState("");
  const [action, setAction] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [suspensionDays, setSuspensionDays] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t("admin.noShows.detailTitle")} />
      <Link to="/admin/no-shows" className={styles.backLink}>{t("admin.noShows.back")}</Link>
      <Loaded state={state} reload={reload}>
        {(item: NoShowDetail) => (
          <div className={styles.stack}>
            <Section title={t("admin.noShows.detailTitle")}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>{t(`admin.noShows.status.${item.status}`)}</dd>
                <Person label={t("admin.noShows.reporter")} person={item.reporter} />
                <Person label={t("admin.noShows.reported")} person={item.reportedUser} />
                <dt>{t("admin.noShows.description")}</dt>
                <dd>{item.description}</dd>
                <dt>{t("admin.noShows.createdAt")}</dt>
                <dd>{formatDateTime(item.createdAt, i18n.language)}</dd>
                {item.resolutionNote && (
                  <>
                    <dt>{t("admin.noShows.resolutionNote")}</dt>
                    <dd>{item.resolutionNote} ({formatDateTime(item.resolvedAt, i18n.language)})</dd>
                  </>
                )}
              </dl>

              {item.evidence && (
                <a href={item.evidence.url} target="_blank" rel="noreferrer" className={styles.muted}>
                  {t("admin.noShows.openEvidence")}
                </a>
              )}

              {error && <p className={styles.muted}>{error}</p>}
              {item.status === "OPEN" || item.status === "UNDER_REVIEW" ? (
                <button
                  type="button"
                  onClick={() => setSheet(true)}
                  style={{ marginTop: "12px", padding: "8px 16px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "0.875rem" }}
                >
                  {t("admin.noShows.resolve")}
                </button>
              ) : null}
            </Section>

            <ConfirmSheet
              title={t("admin.noShows.resolveTitle")}
              open={sheet}
              onClose={() => setSheet(false)}
              confirmLabel={t("admin.noShows.resolve")}
              onConfirm={async () => {
                try {
                  await adminNoShowApi.resolve(item.id, {
                    status: decision,
                    resolutionNote: resolutionNote.trim(),
                    ...(action && { action }),
                    ...(actionReason.trim() && { actionReason: actionReason.trim() }),
                    ...(suspensionDays && action === "SUSPEND" && { suspensionDays: Number(suspensionDays) }),
                  });
                  setError(null);
                  void reload();
                } catch (failure) {
                  setError(adminError(failure, t));
                  throw failure;
                }
              }}
            >
              <div className={styles.stack}>
                <div>
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "6px" }}>{t("admin.noShows.decision")}</p>
                  {(["RESOLVED", "DISMISSED"] as const).map((d) => (
                    <label key={d} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", cursor: "pointer" }}>
                      <input type="radio" name="noshow-decision" value={d} checked={decision === d} onChange={() => setDecision(d)} />
                      {t(`admin.noShows.decisions.${d}`)}
                    </label>
                  ))}
                </div>
                <TextAreaField label={t("admin.noShows.resolutionNote") + " *"} value={resolutionNote} onChange={setResolutionNote} />
                <SelectField
                  label={t("admin.disputes.moderationAction")}
                  value={action}
                  onChange={setAction}
                  options={[{ value: "", label: t("admin.disputes.noAction") }, ...MOD_ACTIONS.map((a) => ({ value: a, label: t(`admin.actions.${a.toLowerCase()}`) }))]}
                />
                {action && <TextAreaField label={t("admin.disputes.actionReason")} value={actionReason} onChange={setActionReason} />}
                {action === "SUSPEND" && (
                  <div>
                    <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>{t("admin.disputes.suspensionDays")}</label>
                    <input
                      type="number" min={1} max={365} value={suspensionDays}
                      onChange={(e) => setSuspensionDays(e.target.value)}
                      style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
                    />
                  </div>
                )}
              </div>
            </ConfirmSheet>
          </div>
        )}
      </Loaded>
    </>
  );
}

