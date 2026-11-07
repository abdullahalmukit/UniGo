import { SlidersHorizontal, UtensilsCrossed } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import formStyles from "../../components/form.module.css";
import { BottomSheet, FormAlert, TextField } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { SkeletonList } from "../account/SubPage";
import { FeedCard } from "../activity/FeedCard";
import { listActivity, useFeedRefresh, type FeedItem, type Tab as FeedTab } from "../activity/feed-api";
import { PlaceField, SubAreaField } from "../ride/Pickers";
import styles from "../ride/ride.module.css";
import { listFood, type FoodCardItem, type FoodFilters } from "./food-api";
import { FoodCard } from "./FoodCard";
import { useFoodConfig } from "./food-shared";

type Tab = "available" | "mine" | "accepted";
const TABS: Tab[] = ["available", "mine", "accepted"];

// The Food page (proposal 10.1): All Available with Search filters, My Orders
// and Accepted Orders (the Activity feed for food, B3b-1). No map on the list;
// a map opens only inside the place picker (B3b-1 E).
export function FoodPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("available");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <PageHeader title={t("food.title")} />
        <div className={styles.headerActions}>
          <Link to="/food/requests/new" className={buttonStyles.primary}>
            {t("food.newRequest")}
          </Link>
        </div>
      </div>
      <div className={styles.tabs} role="tablist" aria-label={t("food.title")}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(key)}
          >
            {t(`food.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "available" ? <AvailableList /> : <MyOrders role={tab === "mine" ? "requested" : "accepted"} />}
    </div>
  );
}

function AvailableList() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Omit<FoodFilters, "page">>({});
  const [subArea, setSubArea] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<FoodCardItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const load = useCallback(
    async (nextPage: number) => {
      setFailed(false);
      try {
        const result = await listFood({ ...filters, page: nextPage });
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

  const filterCount = [filters.restaurant, filters.delivery, filters.date, filters.subAreaId].filter(Boolean).length;

  return (
    <>
      <div className={styles.row}>
        <span className={styles.muted}>{t("food.availableHint")}</span>
        <button type="button" className={buttonStyles.secondary} onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal aria-hidden size={18} /> {filterCount > 0 ? t("ride.filters.titleCount", { count: filterCount }) : t("food.filters.title")}
        </button>
      </div>
      {failed && (
        <FormAlert>
          {t("food.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load(1)}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!items && !failed && <SkeletonList rows={3} />}
      {items && items.length === 0 && <EmptyState icon={UtensilsCrossed} text={filterCount > 0 ? t("food.emptyFiltered") : t("food.empty")} />}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <FoodCard item={item} />
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
        subArea={subArea}
        onClose={() => setFilterOpen(false)}
        onApply={(next, area) => {
          setFilters(next);
          setSubArea(area);
          setFilterOpen(false);
        }}
      />
    </>
  );
}

// My Orders / Accepted Orders: the Activity feed for food (B3b-1 cards and actions)
function MyOrders({ role }: { role: "requested" | "accepted" }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<FeedTab>("active");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setItems((await listActivity({ feature: "food", role, tab })).items);
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
      <div className={styles.tabs} role="tablist" aria-label={t(`food.tabs.${role === "requested" ? "mine" : "accepted"}`)}>
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
      {items && items.length === 0 && <EmptyState icon={UtensilsCrossed} text={t(`activity.empty.${tab}`)} />}
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
  subArea: initialSubArea,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: Omit<FoodFilters, "page">;
  subArea: { id: string; name: string } | null;
  onClose: () => void;
  onApply: (filters: Omit<FoodFilters, "page">, subArea: { id: string; name: string } | null) => void;
}) {
  const { t } = useTranslation();
  const config = useFoodConfig();
  const [draft, setDraft] = useState(initial);
  const [subArea, setSubArea] = useState(initialSubArea);

  useEffect(() => {
    if (open) {
      setDraft(initial);
      setSubArea(initialSubArea);
    }
  }, [open, initial, initialSubArea]);

  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const radii = config?.searchRadiusKm ?? [1, 2, 5];

  return (
    <BottomSheet title={t("food.filters.title")} open={open} onClose={onClose}>
      <PlaceField label={t("food.filters.restaurantNear")} value={draft.restaurant ?? null} onChange={(restaurant) => set({ restaurant })} />
      <PlaceField label={t("food.filters.deliveryNear")} value={draft.delivery ?? null} onChange={(delivery) => set({ delivery })} />
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
      <TextField label={t("ride.filters.date")} type="date" value={draft.date ?? ""} onChange={(date) => set({ date: date || undefined })} />
      <SubAreaField label={t("ride.subArea.label")} value={subArea} optional onChange={(area) => (setSubArea(area), set({ subAreaId: area?.id }))} />
      <div className={formStyles.sheetButtons}>
        <button type="button" className={buttonStyles.secondary} onClick={() => onApply({}, null)}>
          {t("ride.filters.clear")}
        </button>
        <button type="button" className={buttonStyles.primary} onClick={() => onApply(draft, subArea)}>
          {t("ride.filters.apply")}
        </button>
      </div>
    </BottomSheet>
  );
}
