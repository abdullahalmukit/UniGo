import { CalendarClock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useSession } from "../../app/use-session";
import { buttonStyles, EmptyState } from "../../components/ui";
import { SkeletonList } from "../account/SubPage";
import { FeedCard } from "../activity/FeedCard";
import { listUpcoming, useFeedRefresh, type FeedItem } from "../activity/feed-api";
import styles from "../activity/feed.module.css";
import { useCountdown } from "./countdown";

const HOME_COUNT = 3;

// The Home "Upcoming" section (B3b-1 B): the next 3 accepted activities.
// Guests and anyone with nothing upcoming see the empty state.
export function HomeUpcoming() {
  const { t } = useTranslation();
  const state = useSession();
  const loggedIn = state.status === "authenticated";
  const [items, setItems] = useState<FeedItem[] | null>(null);

  const load = useCallback(async () => {
    if (!loggedIn) return;
    try {
      setItems((await listUpcoming({ limit: HOME_COUNT })).items);
    } catch {
      setItems([]);
    }
  }, [loggedIn]);

  useEffect(() => {
    if (loggedIn) void load();
    else setItems([]);
  }, [loggedIn, load]);
  useFeedRefresh(useCallback(() => void load(), [load]));
  const countdown = useCountdown(items?.[0]?.time ?? null);

  if (!items) return <SkeletonList rows={1} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        text={t("home.upcomingEmpty")}
        action={
          <Link to="/services" className={buttonStyles.secondary}>
            {t("home.browseServices")}
          </Link>
        }
      />
    );
  }
  return (
    <ul className={styles.list}>
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.id}`}>
          <FeedCard item={item} mode="upcoming" countdown={index === 0 ? countdown : null} />
        </li>
      ))}
    </ul>
  );
}
