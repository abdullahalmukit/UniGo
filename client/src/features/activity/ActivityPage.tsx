import { ListChecks } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { SkeletonList } from "../account/SubPage";
import { FeedCard } from "./FeedCard";
import { listActivity, useFeedRefresh, type Feature, type FeedItem, type Role, type Tab } from "./feed-api";
import styles from "./feed.module.css";

const FEATURES: Feature[] = ["all", "ride", "carpool", "food", "service"];
const ROLES: Role[] = ["all", "requested", "accepted"];
const TABS: Tab[] = ["active", "ongoing", "history"];

// Activity (proposal 12.2, B3b-1 A): feature and role chips, Active / Ongoing /
// History tabs, and the actions each status allows. Refreshes itself when a
// notification about an activity arrives or the tab becomes visible.
export function ActivityPage() {
  const { t } = useTranslation();
  const [feature, setFeature] = useState<Feature>("all");
  const [role, setRole] = useState<Role>("all");
  const [tab, setTab] = useState<Tab>("active");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (nextPage = 1) => {
      setFailed(false);
      try {
        const result = await listActivity({ feature, role, tab, page: nextPage });
        setItems((current) => (nextPage === 1 ? result.items : [...(current ?? []), ...result.items]));
        setPage(nextPage);
        setHasMore(result.hasMore);
      } catch {
        setFailed(true);
      }
    },
    [feature, role, tab],
  );

  useEffect(() => {
    setItems(null);
    void load(1);
  }, [load]);
  useFeedRefresh(useCallback(() => void load(1), [load]));

  const comingLater = feature === "carpool" || feature === "service";

  return (
    <div className={styles.page}>
      <PageHeader title={t("activity.title")} />
      <div className={styles.chips} role="group" aria-label={t("activity.featureFilter")}>
        {FEATURES.map((key) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={feature === key} onClick={() => setFeature(key)}>
            {t(`activity.filters.${key}`)}
          </button>
        ))}
      </div>
      <div className={styles.chips} role="group" aria-label={t("activity.roleFilter")}>
        {ROLES.map((key) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={role === key} onClick={() => setRole(key)}>
            {t(`activity.roles.${key}`)}
          </button>
        ))}
      </div>
      <div className={styles.tabs} role="tablist" aria-label={t("activity.title")}>
        {TABS.map((key) => (
          <button key={key} type="button" role="tab" className={styles.tab} aria-selected={tab === key} onClick={() => setTab(key)}>
            {t(`activity.tabs.${key}`)}
          </button>
        ))}
      </div>

      {failed && (
        <FormAlert>
          {t("activity.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load(1)}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!items && !failed && <SkeletonList rows={3} />}
      {items && items.length === 0 && <EmptyState icon={ListChecks} text={comingLater ? t("activity.comingLater") : t(`activity.empty.${tab}`)} />}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <FeedCard item={item} mode="activity" onChanged={() => void load(1)} />
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <button type="button" className={buttonStyles.secondary} onClick={() => void load(page + 1)}>
          {t("activity.loadMore")}
        </button>
      )}
    </div>
  );
}
