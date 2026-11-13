import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { TextField } from "../../components/form";
import { EmptyState, PageHeader, Section } from "../../components/ui";
import { api } from "../../lib/api";
import type { AdminPerson } from "./admin-rides-api";
import { adminError, ConfirmSheet, formatDateTime, Loaded, Pager, SelectField, TextAreaField, useLoad } from "./admin-ui";
import { Person } from "./AdminRideDetailPage";
import styles from "./admin.module.css";

// Admin › Disputes & Complaints (B7): list, detail and resolve.
// Proposal §17 — both Moderators and Super Admins.

const STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED"];
const KINDS = ["COMPLAINT", "COMPLETION_DISPUTE"];
const DECISIONS = ["RESOLVE_COMPLETED", "RESOLVE_CANCELLED"] as const;
const MOD_ACTIONS = ["WARN", "RESTRICT", "SUSPEND", "BAN"];

type MiniProfile = { id: string; name: string | null; photo: null; university: string | null };

type DisputeRow = {
  id: string;
  activityId: string;
  activityType: string;
  kind: string;
  status: string;
  reason: string;
  raisedBy: MiniProfile;
  againstUser: MiniProfile;
  createdAt: string;
};

type DisputeEvidence = {
  id: string;
  uploadedById: string;
  url: string;
  note: string | null;
  createdAt: string;
};

type DisputeDetail = {
  id: string;
  activityId: string;
  activityType: string;
  activityStatus: string;
  kind: string;
  status: string;
  reason: string;
  description: string;
  statusBefore: string;
  subStatusBefore: string | null;
  finalStatus: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  raisedBy: MiniProfile;
  againstUser: MiniProfile;
  evidence: DisputeEvidence[];
  createdAt: string;
};

const enc = encodeURIComponent;
function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `?${search}`;
}

export const adminDisputesApi = {
  list: (filters: { status?: string; kind?: string; page: number }) =>
    api<{ items: DisputeRow[]; total: number; page: number; pageSize: number }>(`/admin/disputes${query(filters)}`),
  get: (id: string) => api<{ dispute: DisputeDetail }>(`/admin/disputes/${enc(id)}`).then((r) => r.dispute),
  resolve: (id: string, body: { decision: string; decisionNote: string; action?: string; actionReason?: string; suspensionDays?: number }) =>
    api<{ dispute: DisputeDetail }>(`/admin/disputes/${enc(id)}/resolve`, { method: "POST", body }),
};

export function AdminDisputesPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const { state, reload } = useLoad(() => adminDisputesApi.list({ status, kind, page }), [status, kind, page]);

  return (
    <>
      <PageHeader title={t("admin.nav.disputes")} />
      <div className={styles.stack}>
        <div className={styles.filters}>
          <TextField label={t("admin.disputes.search")} type="search" value={q} onChange={setQ} />
          <SelectField
            label={t("admin.rides.status")}
            value={status}
            onChange={(value) => { setStatus(value); setPage(1); }}
            options={[{ value: "", label: t("admin.users.any") }, ...STATUSES.map((value) => ({ value, label: t(`admin.disputes.status.${value}`) }))]}
          />
          <SelectField
            label={t("admin.disputes.kind")}
            value={kind}
            onChange={(value) => { setKind(value); setPage(1); }}
            options={[{ value: "", label: t("admin.users.any") }, ...KINDS.map((value) => ({ value, label: t(`admin.disputes.kinds.${value}`) }))]}
          />
        </div>
        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={AlertTriangle} text={t("admin.disputes.empty")} />
            ) : (
              <>
                <p className={styles.muted}>{t("admin.disputes.count", { count: data.total })}</p>
                <ul className={styles.list}>
                  {data.items.filter((row) => !q || row.reason.toLowerCase().includes(q.toLowerCase()) || row.raisedBy.name?.toLowerCase().includes(q.toLowerCase())).map((row) => (
                    <li key={row.id}>
                      <Link to={`/admin/disputes/${row.id}`} className={styles.itemLink}>
                        <div className={styles.itemHeader}>
                          <span className={styles.itemTitle}>{row.reason}</span>
                          <span className={styles.chip}>{t(`admin.disputes.status.${row.status}`)}</span>
                        </div>
                        <span className={styles.muted}>
                          {t(`admin.disputes.kinds.${row.kind}`)} · {t(`activity.filters.${row.activityType.toLowerCase().replace("_request", "")}`, { defaultValue: row.activityType })}
                        </span>
                        <span className={styles.muted}>
                          {row.raisedBy.name} → {row.againstUser.name} · {formatDateTime(row.createdAt, i18n.language)}
                        </span>
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

export function AdminDisputeDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminDisputesApi.get(id), [id]);

  const [sheet, setSheet] = useState(false);
  const [decision, setDecision] = useState<"RESOLVE_COMPLETED" | "RESOLVE_CANCELLED">("RESOLVE_COMPLETED");
  const [decisionNote, setDecisionNote] = useState("");
  const [action, setAction] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [suspensionDays, setSuspensionDays] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t("admin.disputes.detailTitle")} />
      <Link to="/admin/disputes" className={styles.backLink}>{t("admin.disputes.back")}</Link>
      <Loaded state={state} reload={reload}>
        {(item: DisputeDetail) => (
          <div className={styles.stack}>
            <Section title={item.reason}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>{t(`admin.disputes.status.${item.status}`)}</dd>
                <dt>{t("admin.disputes.kind")}</dt>
                <dd>{t(`admin.disputes.kinds.${item.kind}`)}</dd>
                <dt>{t("admin.disputes.activityType")}</dt>
                <dd>
                  <Link to={`/activity`}>{item.activityType} ({item.activityStatus})</Link>
                </dd>
                <dt>{t("admin.disputes.description")}</dt>
                <dd>{item.description}</dd>
                <dt>{t("admin.disputes.statusBefore")}</dt>
                <dd>{item.statusBefore}{item.subStatusBefore ? ` / ${item.subStatusBefore}` : ""}</dd>
                <Person label={t("admin.disputes.raisedBy")} person={item.raisedBy as unknown as AdminPerson} />
                <Person label={t("admin.disputes.against")} person={item.againstUser as unknown as AdminPerson} />
                <dt>{t("admin.disputes.createdAt")}</dt>
                <dd>{formatDateTime(item.createdAt, i18n.language)}</dd>
                {item.finalStatus && (
                  <>
                    <dt>{t("admin.disputes.finalStatus")}</dt>
                    <dd>{item.finalStatus}</dd>
                  </>
                )}
                {item.decisionNote && (
                  <>
                    <dt>{t("admin.disputes.decisionNote")}</dt>
                    <dd>{item.decisionNote} ({formatDateTime(item.decidedAt, i18n.language)})</dd>
                  </>
                )}
              </dl>

              {item.evidence.length > 0 && (
                <>
                  <h4 style={{ margin: "12px 0 6px", fontSize: "0.9rem", fontWeight: 600 }}>{t("admin.disputes.evidence")}</h4>
                  <ul className={styles.list}>
                    {item.evidence.map((e) => (
                      <li key={e.id} className={styles.item}>
                        <a href={e.url} target="_blank" rel="noreferrer">{t("admin.disputes.openEvidence")}</a>
                        {e.note && <span className={styles.muted}>{e.note}</span>}
                        <span className={styles.muted}>{formatDateTime(e.createdAt, i18n.language)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {error && <p className={styles.muted}>{error}</p>}
              {item.status !== "RESOLVED" && (
                <button type="button" className={styles.actionButton ?? ""} onClick={() => setSheet(true)}
                  style={{ marginTop: "12px", padding: "8px 16px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "0.875rem" }}>
                  {t("admin.disputes.resolve")}
                </button>
              )}
            </Section>

            <ConfirmSheet
              title={t("admin.disputes.resolveTitle")}
              open={sheet}
              onClose={() => setSheet(false)}
              confirmLabel={t("admin.disputes.resolve")}
              onConfirm={async () => {
                try {
                  await adminDisputesApi.resolve(item.id, {
                    decision,
                    decisionNote: decisionNote.trim(),
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
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "6px" }}>{t("admin.disputes.decision")}</p>
                  {DECISIONS.map((d) => (
                    <label key={d} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", cursor: "pointer" }}>
                      <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} />
                      {t(`admin.disputes.decisions.${d}`)}
                    </label>
                  ))}
                </div>
                <TextAreaField
                  label={t("admin.disputes.decisionNote")}
                  value={decisionNote}
                  onChange={setDecisionNote}
                />
                <SelectField
                  label={t("admin.disputes.moderationAction")}
                  value={action}
                  onChange={setAction}
                  options={[{ value: "", label: t("admin.disputes.noAction") }, ...MOD_ACTIONS.map((a) => ({ value: a, label: t(`admin.actions.${a.toLowerCase()}`) }))]}
                />
                {action && (
                  <TextAreaField
                    label={t("admin.disputes.actionReason")}
                    value={actionReason}
                    onChange={setActionReason}
                  />
                )}
                {action === "SUSPEND" && (
                  <div>
                    <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>{t("admin.disputes.suspensionDays")}</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={suspensionDays}
                      onChange={(e) => setSuspensionDays(e.target.value)}
                      style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
                    />
                  </div>
                )}
              </div>
            </ConfirmSheet>

            <p className={styles.muted}>{t("admin.disputes.chatNote")}</p>
          </div>
        )}
      </Loaded>
    </>
  );
}

