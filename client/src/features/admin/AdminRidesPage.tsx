import { Car } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { TextField } from "../../components/form";
import { EmptyState, PageHeader } from "../../components/ui";
import { formatRideTime } from "../../lib/dates";
import { adminRidesApi, type RideKind } from "./admin-rides-api";
import { Loaded, Pager, SelectField, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

const KINDS: RideKind[] = ["requests", "offers", "bookings"];
const ACTIVITY_STATUSES = ["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"];
const OFFER_STATUSES = ["OPEN", "FULL", "CLOSED"];

// Admin › Ride Sharing (proposal 17, B3b-2): every request, offer and booking,
// filtered by status, a person, the Asia/Dhaka day.
export function AdminRidesPage() {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<RideKind>("requests");
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

  const { state, reload } = useLoad(() => adminRidesApi.list({ kind, status, q: search, date, page }), [kind, status, search, date, page]);
  const statuses = kind === "offers" ? OFFER_STATUSES : ACTIVITY_STATUSES;

  return (
    <>
      <PageHeader title={t("admin.nav.rides")} />
      <div className={styles.stack}>
        <div className={styles.tabs} role="tablist" aria-label={t("admin.nav.rides")}>
          {KINDS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={kind === key}
              className={styles.tab}
              onClick={() => {
                setKind(key);
                setStatus("");
                setPage(1);
              }}
            >
              {t(`admin.rides.kinds.${key}`)}
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          <TextField label={t("admin.rides.search")} type="search" value={q} onChange={setQ} hint={t("admin.users.searchHint")} />
          <SelectField
            label={t("admin.rides.status")}
            value={status}
            onChange={(value) => (setStatus(value), setPage(1))}
            options={[{ value: "", label: t("admin.users.any") }, ...statuses.map((value) => ({ value, label: t(kind === "offers" ? `ride.postStatus.${value}` : `status.${value}`) }))]}
          />
          <TextField label={t("admin.rides.date")} type="date" value={date} onChange={(value) => (setDate(value), setPage(1))} />
        </div>
        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={Car} text={t("admin.rides.empty")} />
            ) : (
              <>
                <p className={styles.muted}>{t("admin.rides.count", { count: data.total })}</p>
                <ul className={styles.list}>
                  {data.items.map((row) => (
                    <li key={row.id}>
                      <Link to={row.kind === "OFFER" ? `/admin/rides/offers/${row.id}` : `/admin/rides/activities/${row.id}`} className={styles.itemLink}>
                        <div className={styles.itemHeader}>
                          <span className={styles.itemTitle}>
                            {row.pickup} → {row.destination}
                          </span>
                          <span className={styles.chip}>{t(row.kind === "OFFER" ? `ride.postStatus.${row.status}` : `status.${row.status}`)}</span>
                        </div>
                        <span className={styles.muted}>
                          {formatRideTime(row.time, i18n.language)} · ৳{row.amount}
                          {row.seats ? ` · ${t("admin.rides.seats", { seats: row.seats })}` : ""}
                          {row.deleted ? ` · ${t("admin.rides.deleted")}` : ""}
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
    </>
  );
}
