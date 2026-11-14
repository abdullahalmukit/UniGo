import { Inbox, Search, SearchX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { featureList } from "../../app/feature-list";
import { useSession } from "../../app/use-session";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { SkeletonList } from "../account/SubPage";
import { listAllRequests, type ServiceFeature, type ServiceRequestCardItem } from "./all-services-api";
import { ServiceRequestCard } from "./ServiceRequestCard";
import styles from "./AllServicesPage.module.css";

const FEATURES: { key: ServiceFeature; labelKey: string }[] = [
  { key: "all", labelKey: "activity.filters.all" },
  { key: "ride", labelKey: "activity.filters.ride" },
  { key: "food", labelKey: "activity.filters.food" },
  { key: "carpool", labelKey: "activity.filters.carpool" },
  { key: "service", labelKey: "activity.filters.service" },
];

export function AllServicesPage() {
  const { t } = useTranslation();
  const isGuest = useSession().status !== "authenticated";
  const loginLink = `/login?next=${encodeURIComponent("/services")}`;

  const [feature, setFeature] = useState<ServiceFeature>("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ServiceRequestCardItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (nextPage: number, currentFeature: ServiceFeature, searchTerm: string) => {
      if (nextPage === 1) {
        setItems(null);
      } else {
        setLoadingMore(true);
      }
      setFailed(false);

      try {
        const result = await listAllRequests({
          feature: currentFeature,
          search: searchTerm.trim() || undefined,
          page: nextPage,
        });

        setItems((prev) => (nextPage === 1 ? result.items : [...(prev ?? []), ...result.items]));
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
      void load(1, feature, search);
    }, 200);
    return () => clearTimeout(timer);
  }, [feature, search, load]);

  return (
    <>
      <PageHeader title={t("services.title")} />

      {/* Top 4 Service Categories */}
      <div className={styles.grid}>
        {featureList.map(({ key, icon: Icon }) => (
          <article key={key} className={styles.tile}>
            <span className={styles.icon}>
              <Icon aria-hidden strokeWidth={1.9} />
            </span>
            <h2 className={styles.name}>{t(`features.${key}.name`)}</h2>
            <p className={styles.hint}>{t(`features.${key}.hint`)}</p>
            <div className={styles.actions}>
              {isGuest ? (
                <>
                  <Link to={loginLink} className={buttonStyles.primary}>
                    {t("services.create")}
                  </Link>
                  <Link to={loginLink} className={buttonStyles.secondary}>
                    {t("services.browse")}
                  </Link>
                </>
              ) : (
                <>
                  <Link to={key === "carpool" ? "/carpool/posts/new" : `/${key}/requests/new`} className={buttonStyles.primary}>
                    {t("services.create")}
                  </Link>
                  <Link to={`/${key}`} className={buttonStyles.secondary}>
                    {t("services.browse")}
                  </Link>
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      {/* Unified All-Service Requests Feed (feature/all-service-requests) */}
      <section className={styles.feedSection} aria-label={t("services.requestsTitle")}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{t("services.requestsTitle")}</h2>
          <p className={styles.sectionSubtitle}>{t("services.requestsSubtitle")}</p>
        </div>

        <div className={styles.feedControls}>
          <div className={styles.searchBar}>
            <Search className={styles.searchIcon} size={18} aria-hidden />
            <input
              type="search"
              className={styles.searchInput}
              placeholder={t("services.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("services.searchPlaceholder")}
            />
          </div>

          <div className={styles.chips} role="group" aria-label={t("services.requestsTitle")}>
            {FEATURES.map(({ key, labelKey }) => (
              <button
                key={key}
                type="button"
                className={styles.chip}
                aria-pressed={feature === key}
                onClick={() => setFeature(key)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* List of Requests */}
        {failed ? (
          <EmptyState
            icon={Inbox}
            text="Could not load requests"
            action={
              <button type="button" className={buttonStyles.secondary} onClick={() => void load(1, feature, search)}>
                Retry
              </button>
            }
          />
        ) : items === null ? (
          <SkeletonList rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            text={t("services.emptyRequests")}
            action={
              <Link to="/service/requests/new" className={buttonStyles.secondary} style={{ marginTop: "12px" }}>
                + {t("service.newRequest")}
              </Link>
            }
          />
        ) : (
          <>
            <div className={styles.requestsGrid}>
              {items.map((item) => (
                <ServiceRequestCard key={`${item.feature}-${item.id}`} item={item} />
              ))}
            </div>

            {hasMore && (
              <div className={styles.loadMoreContainer}>
                <button
                  type="button"
                  className={buttonStyles.secondary}
                  onClick={() => void load(page + 1, feature, search)}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading..." : t("services.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
