import {
  CarFront,
  ExternalLink,
  HousePlus,
  Info,
  LifeBuoy,
  Map as MapIcon,
  MapPin,
  Star,
  TicketPercent,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { featureList } from "../../app/feature-list";
import { BottomSheet } from "../../components/form";
import { buttonStyles, Section } from "../../components/ui";
import type { Banner, SpotlightItem } from "../content/content-api";
import { getBanners, getSpotlight } from "../content/content-api";
import { HomeUpcoming } from "../upcoming/HomeUpcoming";
import styles from "./HomePage.module.css";

const SEEN_STORIES_KEY = "unigo_seen_stories";

const quickActions: { key: string; icon: typeof Info; to?: string }[] = [
  { key: "about", icon: Info },
  { key: "savedAddresses", icon: MapPin, to: "/account/addresses" },
  { key: "addHome", icon: HousePlus, to: "/account/addresses/new?label=HOME" },
  { key: "subAreas", icon: MapIcon, to: "/account/sub-areas" },
  { key: "promos", icon: TicketPercent, to: "/promos" },
  { key: "drive", icon: CarFront, to: "/drive" },
  { key: "support", icon: LifeBuoy, to: "/account/support" },
  { key: "rateUs", icon: Star },
];

export function HomePage() {
  const { t } = useTranslation();
  const [spotlight, setSpotlight] = useState<SpotlightItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [activeStory, setActiveStory] = useState<SpotlightItem | null>(null);
  const [seenIds, setSeenIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(SEEN_STORIES_KEY) ?? "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    getSpotlight()
      .then((items) => setSpotlight(items))
      .catch(() => setSpotlight([]));

    getBanners()
      .then((items) => setBanners(items))
      .catch(() => setBanners([]));
  }, []);

  const openStory = (item: SpotlightItem) => {
    setActiveStory(item);
    if (!seenIds.includes(item.id)) {
      const next = [...seenIds, item.id];
      setSeenIds(next);
      try {
        localStorage.setItem(SEEN_STORIES_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
    }
  };

  return (
    <>
      <Section title={t("home.featuresTitle")}>
        <div className={styles.features}>
          {featureList.map(({ key, picture }) => (
            <Link key={key} to={`/${key}`} className={styles.featureCard}>
              <span className={styles.featureName}>{t(`features.${key}.name`)}</span>
              <span className={styles.featureHint}>{t(`features.${key}.hint`)}</span>
              <span className={styles.featureTag}>{t(`features.${key}.tag`)}</span>
              <span className={styles.featureArt}>
                <img
                  src={picture.src}
                  srcSet={picture.srcSet}
                  sizes={picture.sizes}
                  width={picture.width}
                  height={picture.height}
                  alt=""
                  decoding="async"
                />
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {banners.length > 0 && (
        <Section title={t("home.bannersTitle")}>
          <ul className={styles.banners}>
            {banners.map((b) => {
              const cardContent = (
                <>
                  <img src={b.imageUrl} alt={b.title} className={styles.bannerImage} loading="lazy" />
                  <div className={styles.bannerOverlay}>
                    <p className={styles.bannerTitle}>{b.title}</p>
                  </div>
                </>
              );
              return (
                <li key={b.id}>
                  {b.linkUrl ? (
                    <a href={b.linkUrl} target="_blank" rel="noopener noreferrer" className={styles.bannerCard}>
                      {cardContent}
                    </a>
                  ) : (
                    <div className={styles.bannerCard}>{cardContent}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section
        title={t("home.upcomingTitle")}
        action={
          <Link to="/upcoming" className={styles.seeAll}>
            {t("home.seeAll")}
          </Link>
        }
      >
        <HomeUpcoming />
      </Section>

      <Section title={t("home.quickActionsTitle")}>
        <ul className={styles.quickActions}>
          {quickActions.map(({ key, icon: Icon, to }) => {
            const content = (
              <>
                <span className={styles.quickIcon}>
                  <Icon aria-hidden strokeWidth={1.9} />
                </span>
                <span>{t(`home.quick.${key}`)}</span>
              </>
            );
            return (
              <li key={key}>
                {to ? (
                  <Link to={to} className={styles.quickAction}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" className={styles.quickAction} disabled>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {spotlight.length > 0 && (
        <Section title={t("home.spotlightTitle")}>
          <ul className={styles.stories}>
            {spotlight.map((item) => {
              const isSeen = seenIds.includes(item.id);
              return (
                <li key={item.id} className={styles.story}>
                  <button type="button" className={styles.storyButton} onClick={() => openStory(item)}>
                    <span className={`${styles.storyRing} ${isSeen ? styles.storyRingSeen : ""}`}>
                      {item.mediaType === "IMAGE" ? (
                        <img
                          src={item.mediaUrl}
                          alt={item.title ?? ""}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <video
                          src={item.mediaUrl}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          muted
                          playsInline
                        />
                      )}
                    </span>
                    <span className={styles.storyTitle}>{item.title ?? t("home.spotlight.viewStory")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {activeStory && (
        <BottomSheet
          title={activeStory.title ?? t("home.spotlightTitle")}
          open={Boolean(activeStory)}
          onClose={() => setActiveStory(null)}
        >
          <div style={{ display: "grid", gap: "var(--space-3)", padding: "var(--space-2) 0" }}>
            <div style={{ borderRadius: "var(--radius-card)", overflow: "hidden", maxHeight: "400px", background: "var(--color-surface-muted)", display: "flex", justifyContent: "center" }}>
              {activeStory.mediaType === "IMAGE" ? (
                <img
                  src={activeStory.mediaUrl}
                  alt={activeStory.title ?? ""}
                  style={{ width: "100%", maxHeight: "380px", objectFit: "contain", display: "block" }}
                />
              ) : (
                <video
                  src={activeStory.mediaUrl}
                  controls
                  autoPlay
                  playsInline
                  style={{ width: "100%", maxHeight: "380px", objectFit: "contain", display: "block" }}
                />
              )}
            </div>
            {activeStory.title && (
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: "bold", color: "var(--color-text)" }}>
                {activeStory.title}
              </h3>
            )}
            {activeStory.linkUrl && (
              <a
                href={activeStory.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonStyles.primary}
                style={{ textAlign: "center", display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
              >
                <span>{activeStory.linkLabel || t("home.spotlight.visitLink")}</span>
                <ExternalLink size={16} aria-hidden />
              </a>
            )}
          </div>
        </BottomSheet>
      )}
    </>
  );
}
