import { Briefcase, Plus, Tag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { FormAlert, TextField } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader, Section } from "../../components/ui";
import { api } from "../../lib/api";
import { adminError, ConfirmSheet, formatDateTime, Loaded, Pager, SelectField, useLoad } from "./admin-ui";
import { CancelButton, History, Person, Reviews } from "./AdminRideDetailPage";
import type { AdminPerson, AdminReview, HistoryRow } from "./admin-rides-api";
import { adminServiceCategoriesApi, type ServiceCategory } from "../service/service-api";
import { categoryLabel } from "../service/ServiceCard";
import styles from "./admin.module.css";

// Admin › Uni Service (B5): every service request with filters, details,
// history, reviews, referenceImage and admin cancel.

const STATUSES = ["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED"];
const RUNNING = ["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED"];

const enc = encodeURIComponent;
function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") search.set(key, String(value));
  return `?${search}`;
}

type AdminServiceRow = {
  id: string;
  status: string;
  subStatus: string | null;
  deleted: boolean;
  isLateCancellation?: boolean;
  createdAt: string;
  serviceTitle: string;
  category: { code: string } | null;
  categoryCode: string | null;
  creator: AdminPerson;
  accepter: AdminPerson | null;
};

type AdminService = {
  id: string;
  status: string;
  subStatus: string | null;
  deleted: boolean;
  isLateCancellation?: boolean;
  startTime: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  creator: AdminPerson;
  accepter: AdminPerson | null;
  category: { code: string; name?: string };
  serviceTitle: string;
  taskTitle: string | null;
  description: string | null;
  destinationAddress: string | null;
  pickupAddress: string | null;
  subArea: string | null;
  preferredDate: string | null;
  hasPreferredTime: boolean;
  offeredAmount: number | null;
  estimatedBudget: number | null;
  itemDetails: string | null;
  quantity: number | null;
  instructions: string | null;
  referenceImage: { url: string; expiresAt: string } | null;
  history: HistoryRow[];
  reviews: AdminReview[];
  payment: { amount: number; method: string | null; status: string } | null;
};

export const adminServiceApi = {
  list: (filters: { status?: string; q?: string; date?: string; categoryId?: string; page: number }) =>
    api<{ items: AdminServiceRow[]; total: number; page: number; pageSize: number }>(`/admin/services${query(filters)}`),
  get: (id: string) => api<{ service: AdminService }>(`/admin/services/${enc(id)}`).then((r) => r.service),
  cancel: (id: string, reason: string) => api(`/admin/services/${enc(id)}/cancel`, { method: "POST", body: { reason } }),
};

export function AdminServicePage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);

  // Category management
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [catError, setCatError] = useState<string | null>(null);
  const [catLoading, setCatLoading] = useState(false);

  const loadCategories = async () => {
    try {
      const res = await adminServiceCategoriesApi.list();
      setCategories(res.categories);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    void loadCategories();
  }, []);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setCatLoading(true);
    setCatError(null);
    try {
      await adminServiceCategoriesApi.create(newCatName.trim());
      setNewCatName("");
      await loadCategories();
    } catch (err: any) {
      setCatError(err?.message || "Failed to add category");
    } finally {
      setCatLoading(false);
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    if (!confirm("Are you sure you want to delete this custom category?")) return;
    try {
      await adminServiceCategoriesApi.delete(catId);
      await loadCategories();
    } catch (err: any) {
      alert(err?.message || "Failed to delete category");
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { state, reload } = useLoad(() => adminServiceApi.list({ status, q: search, date, page }), [status, search, date, page]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
        <PageHeader title={t("admin.nav.services")} />
        <button
          type="button"
          onClick={() => { setCategoryModalOpen(true); void loadCategories(); }}
          className={buttonStyles.primary}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
        >
          <Plus size={16} aria-hidden strokeWidth={2.5} />
          <span>Add Category</span>
        </button>
      </div>

      <div className={styles.stack}>
        <div className={styles.filters}>
          <TextField label={t("admin.services.search")} type="search" value={q} onChange={setQ} />
          <SelectField
            label={t("admin.rides.status")}
            value={status}
            onChange={(value) => (setStatus(value), setPage(1))}
            options={[{ value: "", label: t("admin.users.any") }, ...STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))]}
          />
          <TextField label={t("admin.rides.date")} type="date" value={date} onChange={(value) => (setDate(value), setPage(1))} />
        </div>
        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={Briefcase} text={t("admin.services.empty")} />
            ) : (
              <>
                <p className={styles.muted}>{t("admin.services.count", { count: data.total })}</p>
                <ul className={styles.list}>
                  {data.items.map((row) => (
                    <li key={row.id}>
                      <Link to={`/admin/services/${row.id}`} className={styles.itemLink}>
                        <div className={styles.itemHeader}>
                          <span className={styles.itemTitle}>
                            {row.category?.code ?? row.categoryCode ?? ""} · {row.serviceTitle}
                          </span>
                          <span className={styles.chip}>{t(`status.${row.status}`)}</span>
                        </div>
                        <span className={styles.muted}>
                          {formatDateTime(row.createdAt, i18n.language)}
                          {row.deleted ? ` · ${t("admin.rides.deleted")}` : ""}
                          {row.isLateCancellation ? ` · ${t("admin.rides.late")}` : ""}
                        </span>
                        <span className={styles.muted}>
                          {[row.creator?.name, row.accepter?.name].filter(Boolean).join(" ↔ ")}
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

      {/* Category Management Sheet */}
      <ConfirmSheet
        title="Manage & Add Service Categories"
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        confirmLabel="Done"
        onConfirm={async () => setCategoryModalOpen(false)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {catError && <FormAlert>{catError}</FormAlert>}

          {/* Add Category Form */}
          <form onSubmit={(e) => void handleAddCategory(e)} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 500, display: "block", marginBottom: "4px" }}>
                New Category Name
              </label>
              <input
                type="text"
                placeholder="e.g. Photography & Media, Tutoring..."
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
              />
            </div>
            <button
              type="submit"
              disabled={catLoading || !newCatName.trim()}
              className={buttonStyles.primary}
              style={{ padding: "8px 16px", height: "38px" }}
            >
              {catLoading ? "Adding..." : "Add"}
            </button>
          </form>

          {/* Existing Categories List */}
          <div style={{ marginTop: "8px" }}>
            <h4 style={{ fontSize: "0.875rem", marginBottom: "8px", color: "var(--color-text-muted)" }}>
              Active Categories ({categories.length})
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "280px", overflowY: "auto" }}>
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Tag size={15} style={{ color: "var(--color-brand)" }} />
                    <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                      {categoryLabel(cat.code, t, cat.name)}
                    </span>
                    {cat.isCustom ? (
                      <span style={{ fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", background: "var(--color-brand-bg, rgba(59,130,246,0.1))", color: "var(--color-brand)" }}>
                        Custom
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", background: "var(--color-surface-hover, rgba(150,150,150,0.1))", color: "var(--color-text-muted)" }}>
                        Default
                      </span>
                    )}
                  </div>
                  {cat.isCustom && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteCategory(cat.id)}
                      title="Delete category"
                      style={{ background: "none", border: "none", color: "var(--status-red-fg, #ef4444)", cursor: "pointer", padding: "4px" }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </ConfirmSheet>
    </>
  );
}

export function AdminServiceDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminServiceApi.get(id), [id]);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t("admin.services.detailTitle")} />
      <Link to="/admin/services" className={styles.backLink}>
        {t("admin.services.back")}
      </Link>
      <Loaded state={state} reload={reload}>
        {(item: AdminService) => (
          <div className={styles.stack}>
            <Section title={item.serviceTitle}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>
                  {t(`status.${item.status}`)}
                  {item.subStatus ? ` (${item.subStatus})` : ""}
                  {item.deleted ? ` · ${t("admin.rides.deleted")}` : ""}
                  {item.isLateCancellation ? ` · ${t("admin.rides.late")}` : ""}
                </dd>
                <dt>{t("admin.services.category")}</dt>
                <dd>{item.category.name ?? item.category.code}</dd>
                {item.taskTitle && (
                  <>
                    <dt>{t("admin.services.taskTitle")}</dt>
                    <dd>{item.taskTitle}</dd>
                  </>
                )}
                {item.description && (
                  <>
                    <dt>{t("admin.services.description")}</dt>
                    <dd>{item.description}</dd>
                  </>
                )}
                {item.preferredDate && (
                  <>
                    <dt>{t("admin.services.preferredDate")}</dt>
                    <dd>
                      {item.preferredDate}
                      {item.hasPreferredTime ? "" : ` (${t("admin.services.anyTime")})`}
                    </dd>
                  </>
                )}
                {item.destinationAddress && (
                  <>
                    <dt>{t("admin.services.destination")}</dt>
                    <dd>{item.destinationAddress}</dd>
                  </>
                )}
                {item.pickupAddress && (
                  <>
                    <dt>{t("admin.services.pickup")}</dt>
                    <dd>{item.pickupAddress}</dd>
                  </>
                )}
                {item.offeredAmount != null && (
                  <>
                    <dt>{t("admin.services.offeredAmount")}</dt>
                    <dd>৳{item.offeredAmount}</dd>
                  </>
                )}
                {item.estimatedBudget != null && (
                  <>
                    <dt>{t("admin.services.estimatedBudget")}</dt>
                    <dd>৳{item.estimatedBudget}</dd>
                  </>
                )}
                {item.itemDetails && (
                  <>
                    <dt>{t("admin.services.itemDetails")}</dt>
                    <dd>
                      {item.itemDetails}
                      {item.quantity != null ? ` × ${item.quantity}` : ""}
                    </dd>
                  </>
                )}
                {item.instructions && (
                  <>
                    <dt>{t("admin.services.instructions")}</dt>
                    <dd>{item.instructions}</dd>
                  </>
                )}
                <Person label={t("admin.services.creator")} person={item.creator} />
                {item.accepter && <Person label={t("admin.services.accepter")} person={item.accepter} />}
                <dt>{t("admin.services.created")}</dt>
                <dd>{formatDateTime(item.createdAt, i18n.language)}</dd>
                {item.startedAt && (
                  <>
                    <dt>{t("admin.services.startedAt")}</dt>
                    <dd>{formatDateTime(item.startedAt, i18n.language)}</dd>
                  </>
                )}
                {item.completedAt && (
                  <>
                    <dt>{t("admin.services.completedAt")}</dt>
                    <dd>{formatDateTime(item.completedAt, i18n.language)}</dd>
                  </>
                )}
                {item.payment && (
                  <>
                    <dt>{t("admin.rides.payment")}</dt>
                    <dd>
                      {t(`payment.status.${item.payment.status}`)} · ৳{item.payment.amount}
                      {item.payment.method ? ` · ${item.payment.method}` : ""}
                    </dd>
                  </>
                )}
              </dl>
              {item.referenceImage && (
                <a href={item.referenceImage.url} target="_blank" rel="noreferrer">
                  {t("admin.services.referenceImage")}
                </a>
              )}
              {error && <p className={styles.muted}>{error}</p>}
              {RUNNING.includes(item.status) && (
                <CancelButton
                  label="admin.services.cancel"
                  onCancel={async (reason) => {
                    try {
                      await adminServiceApi.cancel(item.id, reason);
                      setError(null);
                      void reload();
                    } catch (failure) {
                      setError(adminError(failure, t));
                      throw failure;
                    }
                  }}
                />
              )}
            </Section>
            <History rows={item.history} />
            <Reviews reviews={item.reviews} onChanged={() => void reload()} />
          </div>
        )}
      </Loaded>
    </>
  );
}
