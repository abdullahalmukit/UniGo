import {
  ExternalLink,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { featureList } from "../../app/feature-list";
import aboutArt from "../../assets/quick-actions/about.svg";
import savedAddressesArt from "../../assets/quick-actions/saved-addresses.svg";
import addHomeArt from "../../assets/quick-actions/add-home.svg";
import subAreasArt from "../../assets/quick-actions/sub-areas.svg";
import promosArt from "../../assets/quick-actions/promos.svg";
import driveArt from "../../assets/quick-actions/drive.svg";
import supportArt from "../../assets/quick-actions/support.svg";
import rateUsArt from "../../assets/quick-actions/rate-us.svg";
import { BottomSheet } from "../../components/form";
import { buttonStyles, Section } from "../../components/ui";
import type { Banner, SpotlightItem } from "../content/content-api";
import { getBanners, getSpotlight } from "../content/content-api";
import { HomeUpcoming } from "../upcoming/HomeUpcoming";
import styles from "./HomePage.module.css";

const SEEN_STORIES_KEY = "unigo_seen_stories";

const quickActions: {
  key: string;
  image: string;
  to?: string;
  accentClass: string;
}[] = [
  { key: "about", image: aboutArt, to: "/about", accentClass: "qaAbout" },
  { key: "savedAddresses", image: savedAddressesArt, to: "/account/addresses", accentClass: "qaSavedAddresses" },
  { key: "addHome", image: addHomeArt, to: "/account/addresses/new?label=HOME", accentClass: "qaAddHome" },
  { key: "subAreas", image: subAreasArt, to: "/account/sub-areas", accentClass: "qaSubAreas" },
  { key: "promos", image: promosArt, to: "/promos", accentClass: "qaPromos" },
  { key: "drive", image: driveArt, to: "/drive", accentClass: "qaDrive" },
  { key: "support", image: supportArt, to: "/account/support", accentClass: "qaSupport" },
  { key: "rateUs", image: rateUsArt, to: "/account/rate-us", accentClass: "qaRateUs" },
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
        <div className={styles.quickActionsContainer}>
          <ul className={styles.quickActions}>
            {quickActions.map(({ key, image, to, accentClass }) => {
              const content = (
                <>
                  <div className={`${styles.quickIconContainer} ${styles[accentClass] || ""}`}>
                    <img
                      src={image}
                      alt=""
                      aria-hidden
                      className={styles.quickArtImage}
                      width={52}
                      height={52}
                      loading="lazy"
                    />
                  </div>
                  <span className={styles.quickLabel}>{t(`home.quick.${key}`)}</span>
                </>
              );
              return (
                <li key={key}>
                  {to ? (
                    <Link to={to} className={`${styles.quickAction} ${styles[accentClass] || ""}`}>
                      {content}
                    </Link>
                  ) : (
                    <button type="button" className={`${styles.quickAction} ${styles[accentClass] || ""}`} disabled>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
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
