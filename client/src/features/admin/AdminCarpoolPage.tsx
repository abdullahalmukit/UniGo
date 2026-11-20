import { CarFront } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { TextField } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader, Section } from "../../components/ui";
import { api } from "../../lib/api";
import { formatRideTime } from "../../lib/dates";
import { showDate } from "../carpool/carpool-shared";
import type { AdminPerson, AdminReview, HistoryRow } from "./admin-rides-api";
import { adminError, DateTimeField, formatDateTime, Loaded, Pager, SelectField, TextAreaField, toIso, useAdminRole, useLoad } from "./admin-ui";
import { CancelButton, History, Person, Reviews } from "./AdminRideDetailPage";
import styles from "./admin.module.css";

// Admin › Carpool (proposal 17, B6b): posts, booking requests and contracts,
// with sessions, monthly payment records and each rider's session
// cancellation history. Moderators and Super Admins view and close posts;
// suspending or reinstating carpool access is Super Admin only.

type Kind = "posts" | "bookings" | "contracts";
const STATUSES: Record<Kind, string[]> = {
  posts: ["OPEN", "FULL", "CLOSED"],
  bookings: ["OPEN", "ACCEPTED", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED"],
  contracts: ["ACTIVE", "ENDED", "TERMINATED"],
};

type Row = {
  kind: "POST" | "BOOKING" | "CONTRACT";
  id: string;
  activityId?: string;
  status: string;
  paused?: boolean;
  time?: string;
  pickup: string;
  destination: string;
  seats?: string;
  startDate?: string | null;
  endDate?: string;
  monthlyPrice?: number | null;
  paidMonths?: number;
  unpaidMonths?: number;
  terminationRequested?: boolean;
  rider: AdminPerson;
  passenger?: AdminPerson;
};

type Payment = { id: string; monthNumber: number; periodStart: string; periodEnd: string; amount: number; method: string | null; status: string; paidAt: string | null };
type RiderRecord = {
  rider: AdminPerson;
  carpoolSuspendedUntil: string | null;
  sessionCancellations: { activityId: string; startTime: string; cancelledAt: string | null; reason: string | null; late: boolean; passenger: { id: string; name: string } | null }[];
};
type AdminPost = {
  id: string;
  status: string;
  closeReason: string | null;
  pausedAt: string | null;
  daysOfWeek: number;
  time: string;
  pickupAddress: string;
  destinationAddress: string;
  totalSeats: number;
  seatsAvailable: number;
  validFrom: string;
  validUntil: string | null;
  notes: string | null;
  vehicle: { type: string; brand: string; model: string; colour: string; registrationNumber: string; seatCapacity: number };
  prices: { durationMonths: number; monthlyPrice: number }[];
  bookings: { activityId: string; startDate: string; durationMonths: number; status: string; subStatus: string | null; passenger: AdminPerson; contract: { id: string; status: string; endDate: string } | null }[];
  record: RiderRecord;
};
type AdminBooking = {
  activityId: string;
  postId: string;
  status: string;
  subStatus: string | null;
  closureReason: string | null;
  cancellationReason: string | null;
  startDate: string;
  durationMonths: number;
  monthlyPrice: number;
  holdExpiresAt: string | null;
  isRenewal: boolean;
  rejectionReason: string | null;
  rider: AdminPerson;
  passenger: AdminPerson;
  contract: {
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    terminationRequestedById: string | null;
    terminationReason: string | null;
    terminatedAt: string | null;
    endedAt: string | null;
    sessions: { activityId: string; date: string; startTime: string; status: string; cancelledById: string | null; cancellationReason: string | null; late: boolean; closureReason: string | null }[];
    payments: Payment[];
  } | null;
  history: HistoryRow[];
  reviews: AdminReview[];
};

const enc = encodeURIComponent;
function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `?${search}`;
}

export const adminCarpoolApi = {
  list: (filters: { kind: Kind; status?: string; q?: string; page: number }) =>
    api<{ items: Row[]; total: number; page: number; pageSize: number }>(`/admin/carpool${query(filters)}`),
  post: (id: string) => api<{ post: AdminPost }>(`/admin/carpool/posts/${enc(id)}`).then((r) => r.post),
  booking: (id: string) => api<{ booking: AdminBooking }>(`/admin/carpool/bookings/${enc(id)}`).then((r) => r.booking),
  close: (id: string, reason: string) => api(`/admin/carpool/posts/${enc(id)}/close`, { method: "POST", body: { reason } }),
  suspend: (riderId: string, reason: string, endsAt: string) => api<RiderRecord>(`/admin/carpool/riders/${enc(riderId)}/suspend`, { method: "POST", body: { reason, endsAt } }),
  reinstate: (riderId: string, reason: string) => api<RiderRecord>(`/admin/carpool/riders/${enc(riderId)}/reinstate`, { method: "POST", body: { reason } }),
};

const WEEKDAY_KEYS = [0, 1, 2, 3, 4, 5, 6];

export function AdminCarpoolPage() {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<Kind>("posts");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { state, reload } = useLoad(() => adminCarpoolApi.list({ kind, status, q: search, page }), [kind, status, search, page]);
  const statusLabel = (value: string) => (kind === "contracts" ? t(`admin.carpool.contractStatus.${value}`) : t(`status.${value}`, { defaultValue: t(`ride.postStatus.${value}`) }));

  return (
    <>
      <PageHeader title={t("admin.nav.carpool")} />
      <div className={styles.stack}>
        <div className={styles.filters}>
          <SelectField
            label={t("admin.carpool.kind")}
            value={kind}
            onChange={(value) => (setKind(value as Kind), setStatus(""), setPage(1))}
            options={(["posts", "bookings", "contracts"] as const).map((value) => ({ value, label: t(`admin.carpool.kinds.${value}`) }))}
          />
          <SelectField
            label={t("admin.rides.status")}
            value={status}
            onChange={(value) => (setStatus(value), setPage(1))}
            options={[{ value: "", label: t("admin.users.any") }, ...STATUSES[kind].map((value) => ({ value, label: statusLabel(value) }))]}
          />
          <TextField label={t("admin.carpool.search")} type="search" value={q} onChange={setQ} />
        </div>
        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={CarFront} text={t("admin.carpool.empty")} />
            ) : (
              <>
                <p className={styles.muted}>{t("admin.carpool.count", { count: data.total })}</p>
                <ul className={styles.list}>
                  {data.items.map((row) => (
                    <li key={row.id}>
                      <Link to={row.kind === "POST" ? `/admin/carpool/posts/${row.id}` : `/admin/carpool/bookings/${row.activityId ?? row.id}`} className={styles.itemLink}>
                        <div className={styles.itemHeader}>
                          <span className={styles.itemTitle}>
                            {row.pickup} → {row.destination}
                          </span>
                          <span className={styles.chip}>
                            {statusLabel(row.status)}
                            {row.paused ? ` · ${t("admin.carpool.paused")}` : ""}
                          </span>
                        </div>
                        <span className={styles.muted}>
                          {row.kind === "POST" && `${row.time} · ${t("admin.carpool.seats", { seats: row.seats })}`}
                          {row.kind !== "POST" && row.startDate && `${showDate(row.startDate, i18n.language)}${row.endDate ? ` – ${showDate(row.endDate, i18n.language)}` : ""}`}
                          {row.monthlyPrice ? ` · ৳${row.monthlyPrice}/${t("admin.carpool.month")}` : ""}
                          {row.kind === "CONTRACT" && ` · ${t("admin.carpool.paymentsLine", { paid: row.paidMonths ?? 0, unpaid: row.unpaidMonths ?? 0 })}`}
                          {row.terminationRequested ? ` · ${t("admin.carpool.terminationAsked")}` : ""}
                        </span>
                        <span className={styles.muted}>{[row.rider?.name, row.passenger?.name].filter(Boolean).join(" ↔ ")}</span>
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

export function AdminCarpoolPostPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminCarpoolApi.post(id), [id]);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t("admin.carpool.postTitle")} />
      <Link to="/admin/carpool" className={styles.backLink}>
        {t("admin.carpool.back")}
      </Link>
      <Loaded state={state} reload={reload}>
        {(post: AdminPost) => (
          <div className={styles.stack}>
            <Section title={`${post.pickupAddress} → ${post.destinationAddress}`}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>
                  {t(`ride.postStatus.${post.status}`)}
                  {post.pausedAt ? ` · ${t("admin.carpool.paused")}` : ""}
                  {post.closeReason ? ` · ${post.closeReason}` : ""}
                </dd>
                <dt>{t("admin.carpool.schedule")}</dt>
                <dd>
                  {WEEKDAY_KEYS.filter((day) => (post.daysOfWeek & (1 << day)) !== 0)
                    .map((day) => t(`carpool.days.short.${day}`))
                    .join(", ")}{" "}
                  · {post.time}
                </dd>
                <dt>{t("admin.carpool.dates")}</dt>
                <dd>
                  {showDate(post.validFrom, i18n.language)} – {post.validUntil ? showDate(post.validUntil, i18n.language) : t("admin.carpool.noEnd")}
                </dd>
                <dt>{t("admin.carpool.seatsTitle")}</dt>
                <dd>{t("admin.carpool.seats", { seats: `${post.totalSeats - post.seatsAvailable}/${post.totalSeats}` })}</dd>
                <dt>{t("admin.rides.vehicle")}</dt>
                <dd>
                  {post.vehicle.brand} {post.vehicle.model} · {post.vehicle.colour} · {post.vehicle.registrationNumber}
                </dd>
                <dt>{t("admin.carpool.prices")}</dt>
                <dd>{post.prices.map((p) => `${t("carpool.months", { count: p.durationMonths })}: ৳${p.monthlyPrice}`).join(" · ")}</dd>
                <Person label={t("ride.role.rider")} person={post.record.rider} />
              </dl>
              {error && <p className={styles.muted}>{error}</p>}
              {post.status !== "CLOSED" && (
                <CancelButton
                  label="admin.carpool.close"
                  onCancel={async (reason) => {
                    try {
                      await adminCarpoolApi.close(post.id, reason);
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
            <Section title={t("admin.carpool.bookings")}>
              {post.bookings.length === 0 ? (
                <p className={styles.muted}>{t("admin.carpool.noBookings")}</p>
              ) : (
                <ul className={styles.list}>
                  {post.bookings.map((b) => (
                    <li key={b.activityId}>
                      <Link to={`/admin/carpool/bookings/${b.activityId}`} className={styles.itemLink}>
                        <span className={styles.itemTitle}>
                          {b.passenger?.name ?? "—"} · {t(`status.${b.status}`)}
                          {b.contract ? ` · ${t(`admin.carpool.contractStatus.${b.contract.status}`)}` : ""}
                        </span>
                        <span className={styles.muted}>
                          {showDate(b.startDate, i18n.language)} · {t("carpool.months", { count: b.durationMonths })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <RiderRecordSection record={post.record} onChanged={() => void reload()} />
          </div>
        )}
      </Loaded>
    </>
  );
}

function RiderRecordSection({ record, onChanged }: { record: RiderRecord; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const role = useAdminRole();
  const [reason, setReason] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const riderId = record.rider?.id;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setReason("");
      setEndsAt("");
      onChanged();
    } catch (failure) {
      setError(adminError(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t("admin.carpool.riderRecord")}>
      <p>
        {record.carpoolSuspendedUntil
          ? t("admin.carpool.suspendedUntil", { date: formatDateTime(record.carpoolSuspendedUntil, i18n.language) })
          : t("admin.carpool.notSuspended")}
      </p>
      <h3 className={styles.itemTitle}>{t("admin.carpool.cancellations", { count: record.sessionCancellations.length })}</h3>
      <ul className={styles.list}>
        {record.sessionCancellations.map((c) => (
          <li key={c.activityId} className={styles.item}>
            <span className={styles.itemTitle}>
              {formatRideTime(c.startTime, i18n.language)}
              {c.late ? ` · ${t("admin.rides.late")}` : ""}
            </span>
            <span className={styles.muted}>
              {c.passenger?.name ?? "—"}
              {c.reason ? ` · ${c.reason}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {role === "SUPER_ADMIN" && riderId && (
        <div className={styles.stack}>
          <TextAreaField label={t("admin.carpool.reason")} value={reason} onChange={setReason} />
          {!record.carpoolSuspendedUntil && <DateTimeField label={t("admin.carpool.until")} value={endsAt} onChange={setEndsAt} />}
          {error && <p className={styles.muted}>{error}</p>}
          {record.carpoolSuspendedUntil ? (
            <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => void act(() => adminCarpoolApi.reinstate(riderId, reason.trim()))}>
              {t("admin.carpool.reinstate")}
            </button>
          ) : (
            <button
              type="button"
              className={`${buttonStyles.secondary} ${styles.danger}`}
              disabled={busy || !endsAt}
              onClick={() => void act(() => adminCarpoolApi.suspend(riderId, reason.trim(), toIso(endsAt)!))}
            >
              {t("admin.carpool.suspend")}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

export function AdminCarpoolBookingPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminCarpoolApi.booking(id), [id]);

  return (
    <>
      <PageHeader title={t("admin.carpool.bookingTitle")} />
      <Link to="/admin/carpool" className={styles.backLink}>
        {t("admin.carpool.back")}
      </Link>
      <Loaded state={state} reload={reload}>
        {(item: AdminBooking) => (
          <div className={styles.stack}>
            <Section title={t("admin.carpool.bookingTitle")}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>
                  {t(`status.${item.status}`)}
                  {item.subStatus ? ` (${item.subStatus})` : ""}
                  {item.closureReason ? ` · ${item.closureReason}` : ""}
                  {item.isRenewal ? ` · ${t("admin.carpool.renewal")}` : ""}
                </dd>
                <dt>{t("admin.carpool.dates")}</dt>
                <dd>
                  {showDate(item.startDate, i18n.language)} · {t("carpool.months", { count: item.durationMonths })} · ৳{item.monthlyPrice}/{t("admin.carpool.month")}
                </dd>
                <Person label={t("ride.role.rider")} person={item.rider} />
                <Person label={t("ride.role.passenger")} person={item.passenger} />
                {item.cancellationReason && (
                  <>
                    <dt>{t("admin.carpool.reason")}</dt>
                    <dd>{item.cancellationReason}</dd>
                  </>
                )}
                <dt>{t("admin.carpool.post")}</dt>
                <dd>
                  <Link to={`/admin/carpool/posts/${item.postId}`}>{t("admin.carpool.openPost")}</Link>
                </dd>
              </dl>
            </Section>
            {item.contract && (
              <>
                <Section title={t("admin.carpool.contract")}>
                  <dl className={styles.keyValues}>
                    <dt>{t("admin.rides.status")}</dt>
                    <dd>{t(`admin.carpool.contractStatus.${item.contract.status}`)}</dd>
                    <dt>{t("admin.carpool.dates")}</dt>
                    <dd>
                      {showDate(item.contract.startDate, i18n.language)} – {showDate(item.contract.endDate, i18n.language)}
                    </dd>
                    {item.contract.terminationReason && (
                      <>
                        <dt>{t("admin.carpool.terminationAsked")}</dt>
                        <dd>{item.contract.terminationReason}</dd>
                      </>
                    )}
                  </dl>
                </Section>
                <Section title={t("carpool.payments.title")}>
                  <ul className={styles.list}>
                    {item.contract.payments.map((p) => (
                      <li key={p.id} className={styles.item}>
                        <span className={styles.itemTitle}>
                          {t("carpool.payments.month", { number: p.monthNumber })} · ৳{p.amount} · {t(`payment.status.${p.status}`)}
                        </span>
                        <span className={styles.muted}>
                          {showDate(p.periodStart, i18n.language)} – {showDate(p.periodEnd, i18n.language)}
                          {p.method ? ` · ${t(`payment.methods.${p.method}`)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
                <Section title={t("carpool.sessions.title", { count: item.contract.sessions.length })}>
                  <ul className={styles.list}>
                    {item.contract.sessions.map((s) => (
                      <li key={s.activityId} className={styles.item}>
                        <span className={styles.itemTitle}>
                          {formatRideTime(s.startTime, i18n.language)} · {t(`status.${s.status}`)}
                          {s.late ? ` · ${t("admin.rides.late")}` : ""}
                        </span>
                        {(s.cancellationReason || s.closureReason) && (
                          <span className={styles.muted}>
                            {s.cancelledById === item.rider?.id ? t("ride.role.rider") : s.cancelledById === item.passenger?.id ? t("ride.role.passenger") : ""}
                            {s.cancellationReason ? ` · ${s.cancellationReason}` : ""}
                            {s.closureReason ? ` · ${s.closureReason}` : ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              </>
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
