import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { EmptyState, PageHeader, Section } from "../../components/ui";
import { api } from "../../lib/api";
import type { AdminPerson } from "./admin-rides-api";
import { adminError, ConfirmSheet, formatDateTime, Loaded, Pager, SelectField, TextAreaField, useLoad } from "./admin-ui";
import { Person } from "./AdminRideDetailPage";
import styles from "./admin.module.css";

// Admin › Support Requests & App Feedback (B7): list, detail, reply.
// Proposal §5 — Moderators and Super Admins.

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const CATEGORIES = ["RIDE", "FOOD", "CARPOOL", "SERVICE", "ACCOUNT", "SAFETY", "APP_FEEDBACK", "OTHER"];

type SupportRow = {
  id: string;
  category: string;
  status: string;
  message: string;
  user: AdminPerson;
  createdAt: string;
};

type SupportDetail = {
  id: string;
  category: string;
  status: string;
  message: string;
  reply: string | null;
  screenshot: { url: string; expiresAt: string } | null;
  user: AdminPerson;
  repliedBy: AdminPerson | null;
  createdAt: string;
  repliedAt: string | null;
};

const enc = encodeURIComponent;
function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `?${search}`;
}

export const adminSupportApi = {
  list: (filters: { category?: string; status?: string; page: number }) =>
    api<{ items: SupportRow[]; total: number; page: number; pageSize: number }>(`/admin/support${query(filters)}`),
  get: (id: string) => api<{ request: SupportDetail }>(`/admin/support/${enc(id)}`).then((r) => r.request),
  reply: (id: string, reply: string) =>
    api<{ request: SupportDetail }>(`/admin/support/${enc(id)}/reply`, { method: "POST", body: { reply } }),
};

export function AdminSupportPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);

  const { state, reload } = useLoad(() => adminSupportApi.list({ status, category, page }), [status, category, page]);

  return (
    <>
      <PageHeader title={t("admin.nav.support")} />
      <div className={styles.stack}>
        <div className={styles.filters}>
          <SelectField
            label={t("admin.support.category")}
            value={category}
            onChange={(value) => { setCategory(value); setPage(1); }}
            options={[{ value: "", label: t("admin.users.any") }, ...CATEGORIES.map((value) => ({ value, label: t(`admin.support.categories.${value}`) }))]}
          />
          <SelectField
            label={t("admin.rides.status")}
            value={status}
            onChange={(value) => { setStatus(value); setPage(1); }}
            options={[{ value: "", label: t("admin.users.any") }, ...STATUSES.map((value) => ({ value, label: t(`admin.support.status.${value}`) }))]}
          />
        </div>
        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={MessageSquare} text={t("admin.support.empty")} />
            ) : (
              <>
                <p className={styles.muted}>{t("admin.support.count", { count: data.total })}</p>
                <ul className={styles.list}>
                  {data.items.map((row) => (
                    <li key={row.id}>
                      <Link to={`/admin/support/${row.id}`} className={styles.itemLink}>
                        <div className={styles.itemHeader}>
                          <span className={styles.itemTitle}>
                            {t(`admin.support.categories.${row.category}`)} — {row.message.slice(0, 60)}{row.message.length > 60 ? "…" : ""}
                          </span>
                          <span className={styles.chip}>{t(`admin.support.status.${row.status}`)}</span>
                        </div>
                        <span className={styles.muted}>
                          {row.user?.name} · {formatDateTime(row.createdAt, i18n.language)}
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

export function AdminSupportDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminSupportApi.get(id), [id]);

  const [sheet, setSheet] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t("admin.support.detailTitle")} />
      <Link to="/admin/support" className={styles.backLink}>{t("admin.support.back")}</Link>
      <Loaded state={state} reload={reload}>
        {(item: SupportDetail) => (
          <div className={styles.stack}>
            <Section title={t(`admin.support.categories.${item.category}`)}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>{t(`admin.support.status.${item.status}`)}</dd>
                <Person label={t("admin.support.from")} person={item.user} />
                <dt>{t("admin.support.message")}</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{item.message}</dd>
                <dt>{t("admin.support.createdAt")}</dt>
                <dd>{formatDateTime(item.createdAt, i18n.language)}</dd>
                {item.reply && (
                  <>
                    <dt>{t("admin.support.reply")}</dt>
                    <dd style={{ whiteSpace: "pre-wrap" }}>{item.reply}</dd>
                    <dt>{t("admin.support.repliedBy")}</dt>
                    <dd>
                      {item.repliedBy?.name ?? "—"} · {formatDateTime(item.repliedAt, i18n.language)}
                    </dd>
                  </>
                )}
              </dl>

              {item.screenshot && (
                <a href={item.screenshot.url} target="_blank" rel="noreferrer" className={styles.muted}>
                  {t("admin.support.openScreenshot")}
                </a>
              )}

              {error && <p className={styles.muted}>{error}</p>}
              {item.status !== "RESOLVED" && item.status !== "CLOSED" && (
                <button
                  type="button"
                  onClick={() => { setReply(item.reply ?? ""); setSheet(true); }}
                  style={{ marginTop: "12px", padding: "8px 16px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "0.875rem" }}
                >
                  {t("admin.support.replyButton")}
                </button>
              )}
            </Section>

            <ConfirmSheet
              title={t("admin.support.replyTitle")}
              open={sheet}
              onClose={() => setSheet(false)}
              confirmLabel={t("admin.support.send")}
              onConfirm={async () => {
                try {
                  await adminSupportApi.reply(item.id, reply.trim());
                  setError(null);
                  void reload();
                } catch (failure) {
                  setError(adminError(failure, t));
                  throw failure;
                }
              }}
            >
              <TextAreaField label={t("admin.support.replyLabel")} value={reply} onChange={setReply} />
            </ConfirmSheet>
          </div>
        )}
      </Loaded>
    </>
  );
}

