import { Repeat, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { TimeSelect } from "../../components/DateTimeInput";
import formStyles from "../../components/form.module.css";
import { BottomSheet, FormAlert } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { useMe } from "../account/account-api";
import { SkeletonList } from "../account/SubPage";
import { FeedCard } from "../activity/FeedCard";
import { listActivity, useFeedRefresh, type FeedItem, type Tab as FeedTab } from "../activity/feed-api";
import { useRiderStatus } from "../ride/ride-hooks";
import { PlaceField } from "../ride/Pickers";
import styles from "../ride/ride.module.css";
import { searchCarpools, WEEKDAYS, type CarpoolFilters, type CarpoolPost } from "./carpool-api";
import { CarpoolCard, useCarpoolConfig } from "./carpool-shared";

type Tab = "search" | "posts" | "bookings";

// The Carpool page (proposal 9.1): Search for everyone, My Carpool Posts for
// riders and My Bookings (the Activity feed for carpool, B3b-1). No map on
// the list; a map opens only inside the place picker (B3b-1 E).
export function CarpoolPage() {
  const { t } = useTranslation();
  const me = useMe();
  const rider = useRiderStatus();
  const tabs: Tab[] = me?.isVerifiedRider ? ["search", "posts", "bookings"] : ["search", "bookings"];
  const [tab, setTab] = useState<Tab>("search");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <PageHeader title={t("carpool.title")} />
        {rider?.canOffer && (
          <div className={styles.headerActions}>
            <Link to="/carpool/posts/new" className={buttonStyles.primary}>
              {t("carpool.newPost")}
            </Link>
          </div>
        )}
      </div>
      <div className={styles.tabs} role="tablist" aria-label={t("carpool.title")}>
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(key)}
          >
            {t(`carpool.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "search" ? <SearchList /> : <MyCarpool role={tab === "posts" ? "requested" : "accepted"} />}
    </div>
  );
}

function SearchList() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<CarpoolFilters>({});
  const [items, setItems] = useState<CarpoolPost[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const load = useCallback(
    async (nextPage: number) => {
      setFailed(false);
      try {
        const result = await searchCarpools({ ...filters, page: nextPage });
        setItems((current) => (nextPage === 1 ? result.items : [...(current ?? []), ...result.items]));
        setPage(nextPage);
        setHasMore(result.hasMore);
      } catch {
        setFailed(true);
      }
    },
    [filters],
  );

  useEffect(() => {
    setItems(null);
    void load(1);
  }, [load]);

  const filterCount = [filters.day !== undefined, filters.timeFrom || filters.timeTo, filters.pickup, filters.destination].filter(Boolean).length;

  return (
    <>
      <div className={styles.row}>
        <span className={styles.muted}>{t("carpool.searchHint")}</span>
        <button type="button" className={buttonStyles.secondary} onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal aria-hidden size={18} /> {filterCount > 0 ? t("ride.filters.titleCount", { count: filterCount }) : t("carpool.filters.title")}
        </button>
      </div>
      {failed && (
        <FormAlert>
          {t("carpool.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load(1)}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!items && !failed && <SkeletonList rows={3} />}
      {items && items.length === 0 && <EmptyState icon={Repeat} text={filterCount > 0 ? t("carpool.emptyFiltered") : t("carpool.empty")} />}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((post) => (
            <li key={post.id}>
              <CarpoolCard post={post} />
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <button type="button" className={buttonStyles.secondary} onClick={() => void load(page + 1)}>
          {t("ride.loadMore")}
        </button>
      )}
      <FilterSheet
        open={filterOpen}
        initial={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFilterOpen(false);
        }}
      />
    </>
  );
}

// My Carpool Posts (rider) and My Bookings (passenger): the Activity feed
function MyCarpool({ role }: { role: "requested" | "accepted" }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<FeedTab>("active");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setItems((await listActivity({ feature: "carpool", role, tab })).items);
    } catch {
      setFailed(true);
    }
  }, [role, tab]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);
  useFeedRefresh(useCallback(() => void load(), [load]));

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label={t(`carpool.tabs.${role === "requested" ? "posts" : "bookings"}`)}>
        {(["active", "history"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(key)}
          >
            {t(`activity.tabs.${key}`)}
          </button>
        ))}
      </div>
      {failed && <FormAlert>{t("activity.loadFailed")}</FormAlert>}
      {!items && !failed && <SkeletonList rows={3} />}
      {items && items.length === 0 && <EmptyState icon={Repeat} text={t(`activity.empty.${tab}`)} />}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <FeedCard item={item} mode="activity" onChanged={() => void load()} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FilterSheet({
  open,
  initial,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: CarpoolFilters;
  onClose: () => void;
  onApply: (filters: CarpoolFilters) => void;
}) {
  const { t } = useTranslation();
  const config = useCarpoolConfig();
  const [draft, setDraft] = useState(initial);

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const set = (patch: Partial<CarpoolFilters>) => setDraft((current) => ({ ...current, ...patch }));
  const radii = config?.searchRadiusKm ?? [1, 2, 5];

  return (
    <BottomSheet title={t("carpool.filters.title")} open={open} onClose={onClose}>
      <label className={formStyles.field}>
        <span className={formStyles.label}>{t("carpool.filters.day")}</span>
        <select
          className={styles.select}
          value={draft.day ?? ""}
          onChange={(event) => set({ day: event.target.value === "" ? undefined : Number(event.target.value) })}
        >
          <option value="">{t("carpool.filters.anyDay")}</option>
          {WEEKDAYS.map((day) => (
            <option key={day} value={day}>
              {t(`carpool.days.long.${day}`)}
            </option>
          ))}
        </select>
      </label>
      <TimeSelect label={t("ride.filters.from")} value={draft.timeFrom ?? ""} optional onChange={(timeFrom) => set({ timeFrom: timeFrom || undefined })} />
      <TimeSelect label={t("ride.filters.to")} value={draft.timeTo ?? ""} optional onChange={(timeTo) => set({ timeTo: timeTo || undefined })} />
      <PlaceField label={t("ride.pickup")} value={draft.pickup ?? null} onChange={(pickup) => set({ pickup })} />
      <PlaceField label={t("ride.destination")} value={draft.destination ?? null} onChange={(destination) => set({ destination })} />
      <label className={formStyles.field}>
        <span className={formStyles.label}>{t("ride.filters.radius")}</span>
        <select
          className={styles.select}
          value={draft.radiusKm ?? config?.defaultSearchRadiusKm ?? 2}
          onChange={(event) => set({ radiusKm: Number(event.target.value) })}
        >
          {radii.map((km) => (
            <option key={km} value={km}>
              {t("ride.filters.km", { count: km })}
            </option>
          ))}
        </select>
      </label>
      <div className={formStyles.sheetButtons}>
        <button type="button" className={buttonStyles.secondary} onClick={() => onApply({})}>
          {t("ride.filters.clear")}
        </button>
        <button type="button" className={buttonStyles.primary} onClick={() => onApply(draft)}>
          {t("ride.filters.apply")}
        </button>
      </div>
    </BottomSheet>
  );
}
