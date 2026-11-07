import { UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { TextField } from "../../components/form";
import { EmptyState, PageHeader, Section } from "../../components/ui";
import { api } from "../../lib/api";
import { formatRideTime } from "../../lib/dates";
import { linkUrl } from "../inbox/chat-api";
import type { AdminPerson, AdminReview, HistoryRow } from "./admin-rides-api";
import { adminError, formatDateTime, Loaded, Pager, SelectField, useLoad } from "./admin-ui";
import { CancelButton, History, Person, Reviews } from "./AdminRideDetailPage";
import styles from "./admin.module.css";

// Admin › Food (proposal 17, B4): every food request with filters, details
// (order, approvals, receipts, payment, reviews, history) and admin cancel.
// Moderators and Super Admins. No-Show reports come in B7.

const STATUSES = ["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"];
const RUNNING = ["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED"];

type AdminFoodRow = {
  id: string;
  status: string;
  subStatus: string | null;
  deleted: boolean;
  time: string;
  restaurantName: string;
  delivery: string;
  foodPrice: number;
  deliveryCharge: number;
  requester: AdminPerson;
  accepter: AdminPerson;
};

type AdminFood = {
  id: string;
  status: string;
  subStatus: string | null;
  startTime: string;
  isLateCancellation: boolean;
  deletedAt: string | null;
  requester: AdminPerson;
  accepter: AdminPerson;
  food: {
    restaurantName: string;
    restaurantAddress: string;
    items: string;
    details: string;
    quantity: number;
    estimatedBudget: number;
    pickupAddress: string;
    deliveryAddress: string;
    deliveryCharge: number;
    subArea: { id: string; name: string } | null;
  };
  order: { version: number; items: string | null; foodPrice: number | null; deliveryCharge: number | null; paymentMethod: string | null } | null;
  approvals: { id: string; amount: number; previousAmount: number; status: string; decidedAt: string | null; createdAt: string }[];
  receipts: { id: string; actualCost: number | null; image: { url: string; expiresAt: string }; createdAt: string }[];
  payment: { amount: number; foodCost: number | null; deliveryCharge: number | null; method: string | null; status: string } | null;
  history: HistoryRow[];
  reviews: AdminReview[];
};

const enc = encodeURIComponent;
function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `?${search}`;
}

export const adminFoodApi = {
  list: (filters: { status?: string; q?: string; date?: string; page: number }) =>
    api<{ items: AdminFoodRow[]; total: number; page: number; pageSize: number }>(`/admin/food${query(filters)}`),
  get: (id: string) => api<{ food: AdminFood }>(`/admin/food/${enc(id)}`).then((r) => r.food),
  cancel: (id: string, reason: string) => api(`/admin/food/${enc(id)}/cancel`, { method: "POST", body: { reason } }),
};

export function AdminFoodPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { state, reload } = useLoad(() => adminFoodApi.list({ status, q: search, date, page }), [status, search, date, page]);

  return (
    <>
      <PageHeader title={t("admin.nav.food")} />
      <div className={styles.stack}>
        <div className={styles.filters}>
          <TextField label={t("admin.food.search")} type="search" value={q} onChange={setQ} />
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
              <EmptyState icon={UtensilsCrossed} text={t("admin.food.empty")} />
            ) : (
              <>
                <p className={styles.muted}>{t("admin.food.count", { count: data.total })}</p>
                <ul className={styles.list}>
                  {data.items.map((row) => (
                    <li key={row.id}>
                      <Link to={`/admin/food/${row.id}`} className={styles.itemLink}>
                        <div className={styles.itemHeader}>
                          <span className={styles.itemTitle}>
                            {row.restaurantName} → {row.delivery}
                          </span>
                          <span className={styles.chip}>{t(`status.${row.status}`)}</span>
                        </div>
                        <span className={styles.muted}>
                          {formatRideTime(row.time, i18n.language)} · ৳{row.foodPrice} + ৳{row.deliveryCharge}
                          {row.deleted ? ` · ${t("admin.rides.deleted")}` : ""}
                        </span>
                        <span className={styles.muted}>{[row.requester?.name, row.accepter?.name].filter(Boolean).join(" ↔ ")}</span>
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

export function AdminFoodDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminFoodApi.get(id), [id]);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t("admin.food.detailTitle")} />
      <Link to="/admin/food" className={styles.backLink}>
        {t("admin.food.back")}
      </Link>
      <Loaded state={state} reload={reload}>
        {(item: AdminFood) => (
          <div className={styles.stack}>
            <Section title={item.food.restaurantName}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>
                  {t(`status.${item.status}`)}
                  {item.subStatus ? ` (${item.subStatus})` : ""}
                  {item.deletedAt ? ` · ${t("admin.rides.deleted")}` : ""}
                  {item.isLateCancellation ? ` · ${t("admin.rides.late")}` : ""}
                </dd>
                <dt>{t("food.form.deliveryTime")}</dt>
                <dd>{formatRideTime(item.startTime, i18n.language)}</dd>
                <dt>{t("food.form.restaurantLocation")}</dt>
                <dd>{item.food.restaurantAddress}</dd>
                <dt>{t("admin.rides.route")}</dt>
                <dd>
                  {item.food.pickupAddress} → {item.food.deliveryAddress}
                </dd>
                <dt>{t("food.form.items")}</dt>
                <dd>
                  {item.food.items} × {item.food.quantity}
                  <br />
                  {item.food.details}
                </dd>
                <dt>{t("food.form.budget")}</dt>
                <dd>
                  ৳{item.food.estimatedBudget} + ৳{item.food.deliveryCharge}
                </dd>
                <Person label={t("food.role.requester")} person={item.requester} />
                <Person label={t("food.role.accepter")} person={item.accepter} />
                <dt>{t("food.order.title")}</dt>
                <dd>
                  {item.order
                    ? `${item.order.items} · ৳${item.order.foodPrice} + ৳${item.order.deliveryCharge} · ${item.order.paymentMethod ? t(`payment.methods.${item.order.paymentMethod}`) : "—"}`
                    : "—"}
                </dd>
                <dt>{t("admin.rides.payment")}</dt>
                <dd>
                  {item.payment
                    ? `${t(`payment.status.${item.payment.status}`)} · ${t("payment.foodSplit", { food: item.payment.foodCost ?? 0, charge: item.payment.deliveryCharge ?? 0 })} · ${item.payment.method ? t(`payment.methods.${item.payment.method}`) : t("payment.noMethod")}`
                    : "—"}
                </dd>
              </dl>
              {error && <p className={styles.muted}>{error}</p>}
              {RUNNING.includes(item.status) && (
                <CancelButton
                  label="admin.food.cancel"
                  onCancel={async (reason) => {
                    try {
                      await adminFoodApi.cancel(item.id, reason);
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
            {item.approvals.length > 0 && (
              <Section title={t("food.approval.title")}>
                <ul className={styles.list}>
                  {item.approvals.map((a) => (
                    <li key={a.id} className={styles.item}>
                      <span className={styles.itemTitle}>
                        {t("food.approval.line", { from: a.previousAmount, to: a.amount })} · {t(`food.approval.status.${a.status}`)}
                      </span>
                      <span className={styles.muted}>{formatDateTime(a.createdAt, i18n.language)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {item.receipts.length > 0 && (
              <Section title={t("food.receipt.title")}>
                <ul className={styles.list}>
                  {item.receipts.map((r) => (
                    <li key={r.id} className={styles.item}>
                      <a href={linkUrl(r.image) ?? undefined} target="_blank" rel="noreferrer">
                        {t("admin.food.openReceipt")}
                      </a>
                      {r.actualCost !== null && <span className={styles.muted}>{t("food.receipt.cost", { amount: r.actualCost })}</span>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <History rows={item.history} />
            <Reviews reviews={item.reviews} onChanged={() => void reload()} />
            <p className={styles.muted}>{t("admin.rides.chatPrivate")}</p>
          </div>
        )}
      </Loaded>
    </>
  );
}
