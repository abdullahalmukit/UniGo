import { ChevronRight, Headphones } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { FormAlert } from "../../components/form";
import { buttonStyles, EmptyState, Section } from "../../components/ui";
import { api } from "../../lib/api";
import { formErrors, type FieldErrors } from "../../lib/errors";
import { formatDate } from "../../lib/dates";
import { SkeletonList, SubPageHeader } from "./SubPage";
import styles from "./settings.module.css";

// Support categories matching server rules.ts
const CATEGORIES = [
  "ACCOUNT",
  "VERIFICATION",
  "RIDE",
  "CARPOOL",
  "FOOD",
  "SERVICE",
  "PAYMENT",
  "TECHNICAL",
  "APP_FEEDBACK",
  "OTHER",
] as const;
type SupportCategory = (typeof CATEGORIES)[number];
type SupportStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

type SupportRequest = {
  id: string;
  category: SupportCategory;
  message: string;
  status: SupportStatus;
  adminReply: string | null;
  createdAt: string;
};

const supportApi = {
  list: () => api<{ requests: SupportRequest[] }>("/support/my"),
  get: (id: string) => api<{ request: SupportRequest }>(`/support/${encodeURIComponent(id)}`),
  create: (body: { category: string; message: string }) =>
    api<{ request: SupportRequest }>("/support", { method: "POST", body }),
};

function statusTone(status: SupportStatus) {
  if (status === "RESOLVED" || status === "CLOSED") return "green";
  if (status === "IN_PROGRESS") return "amber";
  return "blue";
}

/* ─── List + Create page ─────────────────────────────────────────── */
export function SupportPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // Load past requests
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await supportApi.list();
      setRequests(res.requests);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Create form
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !message.trim()) return;
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const res = await supportApi.create({ category, message: message.trim() });
      void navigate(`/account/support/${res.request.id}`);
    } catch (err) {
      const { form, fields } = formErrors(err, t);
      setFormError(form ?? null);
      setFieldErrors(fields ?? {});
    } finally {      setBusy(false);
    }
  };

  return (
    <>
      <SubPageHeader title={t("account.menu.support")} />
      <div className={styles.page}>

        {/* ── New request form ─────────────────────────── */}
        <Section title={t("support.newRequest")}>
          <form onSubmit={(e) => void submit(e)} className={styles.stack}>

            {/* Category select */}
            <div>
              <label style={{ display: "block", marginBottom: "var(--space-1)", fontWeight: "var(--weight-medium)" }}>
                {t("admin.support.category")}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                style={{
                  width: "100%",
                  minHeight: "var(--tap-target)",
                  padding: "0 var(--space-3)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-control)",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  font: "inherit",
                }}
              >
                <option value="">{t("support.selectCategory")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`admin.support.categories.${c}`, c)}
                  </option>
                ))}
              </select>
              {fieldErrors["category"] && (
                <p style={{ color: "var(--status-red-fg)", fontSize: "var(--text-caption)", marginTop: "var(--space-1)" }}>
                  {fieldErrors["category"]}
                </p>
              )}
            </div>

            {/* Message textarea */}
            <div>
              <label style={{ display: "block", marginBottom: "var(--space-1)", fontWeight: "var(--weight-medium)" }}>
                {t("support.describeIssue")}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                required
                minLength={5}
                maxLength={2000}
                placeholder={t("support.messagePlaceholder")}
                style={{
                  width: "100%",
                  padding: "var(--space-2) var(--space-3)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-control)",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  font: "inherit",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              {fieldErrors["message"] && (
                <p style={{ color: "var(--status-red-fg)", fontSize: "var(--text-caption)", marginTop: "var(--space-1)" }}>
                  {fieldErrors["message"]}
                </p>
              )}
            </div>

            {formError && <FormAlert>{formError}</FormAlert>}

            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={busy || !category || !message.trim()}
            >
              {busy ? t("common.sending") : t("support.submit")}
            </button>
          </form>
        </Section>

        {/* ── Past requests ─────────────────────────────── */}
        <Section title={t("support.myRequests")}>
          {requests === null && !loadFailed ? (
            <SkeletonList rows={2} />
          ) : loadFailed ? (
            <FormAlert>{t("errors.generic")}</FormAlert>
          ) : (requests ?? []).length === 0 ? (
            <EmptyState icon={Headphones} text={t("support.noRequests")} />
          ) : (
            <ul className={styles.list}>
              {(requests ?? []).map((req) => (
                <li key={req.id}>
                  <Link
                    to={`/account/support/${req.id}`}
                    className={`${styles.row} ${styles.rowLink}`}
                  >
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>
                        {t(`admin.support.categories.${req.category}`, req.category)}
                      </span>
                      <span className={`${styles.caption} ${styles.ellipsis}`}>{req.message}</span>
                      <span className={styles.caption}>{formatDate(req.createdAt, i18n.language)}</span>
                    </span>
                    <StatusBadge status={req.status} />
                    <ChevronRight aria-hidden size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

/* ─── Detail page ─────────────────────────────────────────────────── */
export function SupportDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const [request, setRequest] = useState<SupportRequest | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    supportApi.get(id)
      .then((r) => setRequest(r.request))
      .catch(() => setFailed(true));
  }, [id]);

  if (failed)
    return (
      <>
        <SubPageHeader title={t("admin.support.detailTitle")} back="/account/support" />
        <FormAlert>{t("errors.generic")}</FormAlert>
      </>
    );

  if (!request) return <SkeletonList rows={4} />;

  return (
    <>
      <SubPageHeader title={t("admin.support.detailTitle")} back="/account/support" />
      <div className={styles.page}>
        <Section title={t(`admin.support.categories.${request.category}`, request.category)}>
          <div className={styles.stack}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span className={styles.caption}>{t("support.status")}:</span>
              <StatusBadge status={request.status} />
            </div>

            <div>
              <p className={styles.caption}>{t("admin.support.message")}</p>
              <p style={{ marginTop: "var(--space-1)", whiteSpace: "pre-wrap" }}>{request.message}</p>
            </div>

            <div>
              <p className={styles.caption}>{t("admin.support.createdAt")}</p>
              <p style={{ marginTop: "var(--space-1)" }}>{formatDate(request.createdAt, i18n.language)}</p>
            </div>

            {request.adminReply && (
              <div
                style={{
                  background: "var(--color-accent-soft)",
                  borderRadius: "var(--radius-card)",
                  padding: "var(--space-3)",
                  borderLeft: "3px solid var(--color-accent)",
                }}
              >
                <p className={styles.caption} style={{ marginBottom: "var(--space-1)" }}>
                  {t("admin.support.reply")}
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>{request.adminReply}</p>
              </div>
            )}

            {!request.adminReply && (
              <p className={styles.caption} style={{ fontStyle: "italic" }}>
                {t("support.awaitingReply")}
              </p>
            )}
          </div>
        </Section>
      </div>
    </>
  );
}

/* ─── Shared status badge ─────────────────────────────────────────── */
function StatusBadge({ status }: { status: SupportStatus }) {
  const { t } = useTranslation();
  const tone = statusTone(status);
  const colorMap: Record<string, string> = {
    green: "var(--status-green-fg)",
    amber: "var(--status-amber-fg)",
    blue: "var(--color-accent)",
  };
  const bgMap: Record<string, string> = {
    green: "var(--status-green-bg)",
    amber: "var(--status-amber-bg)",
    blue: "var(--color-accent-soft)",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--text-caption)",
        fontWeight: "var(--weight-medium)",
        color: colorMap[tone],
        background: bgMap[tone],
        whiteSpace: "nowrap",
      }}
    >
      {t(`admin.support.status.${status}`, status)}
    </span>
  );
}
