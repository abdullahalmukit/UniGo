import { Briefcase, Inbox, Search, SearchX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { FormAlert } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { SkeletonList } from "../account/SubPage";
import { FeedCard } from "../activity/FeedCard";
import { listActivity, useFeedRefresh, type FeedItem, type Tab as FeedTab } from "../activity/feed-api";
import styles from "./ServicePage.module.css";
import {
  listServiceCategories,
  listServiceRequests,
  type ServiceCardItem,
  type ServiceCategory,
  type ServiceFilters,
} from "./service-api";
import { categoryLabel, ServiceCard } from "./ServiceCard";

type Tab = "available" | "mine" | "accepted";
const TABS: Tab[] = ["available", "mine", "accepted"];

export function ServicePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("available");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <PageHeader title={t("service.title")} />
        <div className={styles.headerActions}>
          <Link to="/service/requests/new" className={buttonStyles.primary}>
            {t("service.newRequest")}
          </Link>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label={t("service.title")}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(key)}
          >
            {t(`service.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === "available" ? (
        <AvailableList />
      ) : (
        <MyServiceActivities role={tab === "mine" ? "requested" : "accepted"} />
      )}
    </div>
  );
}

function AvailableList() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ServiceCardItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    listServiceCategories().then((res) => {
      setCategories(res.categories);
    }).catch(() => undefined);
  }, []);

  const load = useCallback(
    async (nextPage: number, catId: string, queryStr: string) => {
      if (nextPage === 1) {
        setItems(null);
      } else {
        setLoadingMore(true);
      }
      setFailed(false);

      try {
        const filters: ServiceFilters = {
          categoryId: catId !== "all" ? catId : undefined,
          search: queryStr.trim() || undefined,
          page: nextPage,
        };
        const result = await listServiceRequests(filters);
        setItems((current) => (nextPage === 1 ? result.items : [...(current ?? []), ...result.items]));
        setPage(nextPage);
        setHasMore(result.hasMore);
      } catch {
        setFailed(true);
      } finally {
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(1, selectedCategoryId, search);
    }, 300);
    return () => clearTimeout(timer);
  }, [load, selectedCategoryId, search]);

  return (
    <>
      <div className={styles.filterSection}>
        {/* Search Bar */}
        <div className={styles.searchBar}>
          <Search size={18} aria-hidden className={styles.searchIcon} />
          <input
            type="search"
            placeholder={t("service.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        {/* Category Filter Chips */}
        <div className={styles.chips} role="group" aria-label={t("service.category")}>
          <button
            type="button"
            className={selectedCategoryId === "all" ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => setSelectedCategoryId("all")}
          >
            {t("activity.filters.all")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={selectedCategoryId === cat.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              onClick={() => setSelectedCategoryId(cat.id)}
            >
              {categoryLabel(cat.code, t, cat.name)}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <FormAlert>
          {t("service.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load(1, selectedCategoryId, search)}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      ) : items === null ? (
        <SkeletonList rows={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={selectedCategoryId !== "all" || search ? SearchX : Briefcase}
          text={selectedCategoryId !== "all" || search ? t("service.emptyFiltered") : t("service.empty")}
        />
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id}>
                <ServiceCard item={item} />
              </li>
            ))}
          </ul>

          {hasMore && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
              <button
                type="button"
                className={buttonStyles.secondary}
                onClick={() => void load(page + 1, selectedCategoryId, search)}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : t("services.loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function MyServiceActivities({ role }: { role: "requested" | "accepted" }) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<FeedTab>("active");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await listActivity({ feature: "service", role, tab: subTab });
      setItems(res.items);
    } catch {
      setFailed(true);
    }
  }, [role, subTab]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  useFeedRefresh(useCallback(() => void load(), [load]));

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label={t(`service.tabs.${role === "requested" ? "mine" : "accepted"}`)}>
        {(["active", "history"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={subTab === key}
            className={subTab === key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setSubTab(key)}
          >
            {t(`activity.tabs.${key}`)}
          </button>
        ))}
      </div>

      {failed ? (
        <FormAlert>
          {t("service.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load()}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      ) : items === null ? (
        <SkeletonList rows={3} />
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} text={t(`activity.empty.${subTab}`)} />
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <FeedCard item={item} mode="activity" onChanged={load} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

