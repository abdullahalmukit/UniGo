import { Car, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import formStyles from "../../components/form.module.css";
import { TimeSelect } from "../../components/DateTimeInput";
import { BottomSheet, FormAlert, TextField } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { SkeletonList } from "../account/SubPage";
import { useRiderStatus } from "./ride-hooks";
import { listRides, type RideFilters, type RideItem } from "./ride-api";
import { RideCard } from "./RideCard";
import { PlaceField, SubAreaField } from "./Pickers";
import styles from "./ride.module.css";

type Tab = "all" | "requests" | "offers";
const TABS: Tab[] = ["all", "requests", "offers"];
const RADII = [1, 2, 5];

// The Ride page (proposal 8.1, changed in B3b-1 E): a list of every open
// request and offer, with no map. Search a Ride uses the filters, alone or
// together; a map opens only inside the place picker.
export function RidePage() {
  const { t } = useTranslation();
  const rider = useRiderStatus();
  const [tab, setTab] = useState<Tab>("all");
  const [filters, setFilters] = useState<Omit<RideFilters, "type" | "page">>({});
  const [subArea, setSubArea] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<RideItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const load = useCallback(
    async (nextPage: number) => {
      setFailed(false);
      try {
        const result = await listRides({ ...filters, type: tab, page: nextPage });
        setItems((current) => (nextPage === 1 ? result.items : [...(current ?? []), ...result.items]));
        setPage(nextPage);
        setHasMore(result.hasMore);
      } catch {
        setFailed(true);
      }
    },
    [filters, tab],
  );

  useEffect(() => {
    setItems(null);
    void load(1);
  }, [load]);

  const filterCount = [filters.pickup, filters.destination, filters.date, filters.timeFrom || filters.timeTo, filters.subAreaId].filter(Boolean).length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <PageHeader title={t("ride.title")} />
        <div className={styles.headerActions}>
          <Link to="/ride/requests/new" className={buttonStyles.primary}>
            {t("ride.needRide")}
          </Link>
          {rider?.canOffer && (
            <Link to="/ride/offers/new" className={buttonStyles.secondary}>
              {t("ride.offerRide")}
            </Link>
          )}
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.tabs} role="tablist" aria-label={t("ride.title")}>
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTab(key)}
            >
              {t(`ride.tabs.${key}`)}
            </button>
          ))}
        </div>
        <button type="button" className={buttonStyles.secondary} onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal aria-hidden size={18} /> {filterCount > 0 ? t("ride.filters.titleCount", { count: filterCount }) : t("ride.filters.title")}
        </button>
      </div>

      {failed && (
        <FormAlert>
          {t("ride.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load(1)}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!items && !failed && <SkeletonList rows={3} />}
      {items && items.length === 0 && <EmptyState icon={Car} text={filterCount > 0 ? t("ride.emptyFiltered") : t("ride.empty")} />}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <RideCard item={item} />
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
    </div>
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
  initial: Omit<RideFilters, "type" | "page">;
  subArea: { id: string; name: string } | null;
  onClose: () => void;
  onApply: (filters: Omit<RideFilters, "type" | "page">, subArea: { id: string; name: string } | null) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [subArea, setSubArea] = useState(initialSubArea);

  useEffect(() => {
    if (open) {
      setDraft(initial);
      setSubArea(initialSubArea);
    }
  }, [open, initial, initialSubArea]);

  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <BottomSheet title={t("ride.filters.title")} open={open} onClose={onClose}>
      <PlaceField label={t("ride.pickup")} value={draft.pickup ?? null} onChange={(pickup) => set({ pickup })} />
      <PlaceField label={t("ride.destination")} value={draft.destination ?? null} onChange={(destination) => set({ destination })} />
      <label className={formStyles.field}>
        <span className={formStyles.label}>{t("ride.filters.radius")}</span>
        <select className={styles.select} value={draft.radiusKm ?? 2} onChange={(event) => set({ radiusKm: Number(event.target.value) })}>
          {RADII.map((km) => (
            <option key={km} value={km}>
              {t("ride.filters.km", { count: km })}
            </option>
          ))}
        </select>
      </label>
      <TextField label={t("ride.filters.date")} type="date" value={draft.date ?? ""} onChange={(date) => set({ date: date || undefined })} />
      <div className={styles.grid2}>
        <TimeSelect label={t("ride.filters.from")} optional value={draft.timeFrom ?? ""} onChange={(timeFrom) => set({ timeFrom: timeFrom || undefined })} />
        <TimeSelect label={t("ride.filters.to")} optional value={draft.timeTo ?? ""} onChange={(timeTo) => set({ timeTo: timeTo || undefined })} />
      </div>
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
