import { ArrowRight, Car, Compass, Repeat, UtensilsCrossed, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useSession } from "../../app/use-session";
import upcomingArt from "../../assets/upcoming-calendar.svg";
import { SkeletonList } from "../account/SubPage";
import { FeedCard } from "../activity/FeedCard";
import { listUpcoming, useFeedRefresh, type FeedItem } from "../activity/feed-api";
import styles from "./HomeUpcoming.module.css";
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
      <div className={styles.card}>
        <div className={styles.artWrapper}>
          <img
            src={upcomingArt}
            alt=""
            aria-hidden
            className={styles.artImage}
            width={76}
            height={76}
          />
        </div>
        <div className={styles.textGroup}>
          <h3 className={styles.title}>{t("home.upcomingEmpty")}</h3>
          <p className={styles.subtitle}>{t("home.upcomingSubtitle")}</p>
        </div>
        <div className={styles.actions}>
          <Link to="/services" className={styles.ctaButton}>
            <Compass size={18} aria-hidden />
            <span>{t("home.browseServices")}</span>
            <ArrowRight size={16} aria-hidden />
          </Link>
          <div className={styles.quickBar}>
            <span className={styles.quickLabel}>{t("home.quickExplore")}</span>
            <Link to="/ride" className={styles.quickChip}>
              <Car size={13} aria-hidden />
              <span>{t("features.ride.name")}</span>
            </Link>
            <Link to="/food" className={styles.quickChip}>
              <UtensilsCrossed size={13} aria-hidden />
              <span>{t("features.food.name")}</span>
            </Link>
            <Link to="/carpool" className={styles.quickChip}>
              <Repeat size={13} aria-hidden />
              <span>{t("features.carpool.name")}</span>
            </Link>
            <Link to="/service" className={styles.quickChip}>
              <Wrench size={13} aria-hidden />
              <span>{t("features.service.name")}</span>
            </Link>
          </div>
        </div>
      </div>
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
