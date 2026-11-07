import { CalendarClock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { SkeletonList } from "../account/SubPage";
import { FeedCard } from "../activity/FeedCard";
import { listUpcoming, useFeedRefresh, type Feature, type FeedItem, type Role } from "../activity/feed-api";
import styles from "../activity/feed.module.css";
import { useCountdown } from "./countdown";

const FEATURES: Feature[] = ["all", "ride", "carpool", "food", "service"];
const ROLES: Role[] = ["all", "requested", "accepted"];

// Upcoming (proposal 12.3, B3b-1 B): future accepted activities, nearest
// first, with a countdown on the nearest that updates every minute.
export function UpcomingPage() {
  const { t } = useTranslation();
  const [feature, setFeature] = useState<Feature>("all");
  const [role, setRole] = useState<Role>("all");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setItems((await listUpcoming({ feature, role })).items);
    } catch {
      setFailed(true);
    }
  }, [feature, role]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);
  useFeedRefresh(useCallback(() => void load(), [load]));
  const countdown = useCountdown(items?.[0]?.time ?? null);

  return (
    <div className={styles.page}>
      <PageHeader title={t("upcoming.title")} />
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
      {failed && (
        <FormAlert>
          {t("upcoming.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load()}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!items && !failed && <SkeletonList rows={3} />}
      {items && items.length === 0 && <EmptyState icon={CalendarClock} text={t("upcoming.empty")} />}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item, index) => (
            <li key={`${item.kind}-${item.id}`}>
              <FeedCard item={item} mode="upcoming" countdown={index === 0 ? countdown : null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
