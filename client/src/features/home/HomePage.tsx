import {
  CalendarDays,
  CarFront,
  Handshake,
  HousePlus,
  Info,
  LifeBuoy,
  Map as MapIcon,
  MapPin,
  Megaphone,
  ShieldCheck,
  Star,
  TicketPercent,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { featureList } from "../../app/feature-list";
import { Section } from "../../components/ui";
import { HomeUpcoming } from "../upcoming/HomeUpcoming";
import styles from "./HomePage.module.css";

// `to`: the page it opens; the others arrive in later steps.
const quickActions: { key: string; icon: typeof Info; to?: string }[] = [
  { key: "about", icon: Info },
  { key: "savedAddresses", icon: MapPin, to: "/account/addresses" },
  { key: "addHome", icon: HousePlus, to: "/account/addresses/new?label=HOME" },
  { key: "subAreas", icon: MapIcon, to: "/account/sub-areas" },
  { key: "promos", icon: TicketPercent },
  { key: "drive", icon: CarFront, to: "/drive" },
  { key: "support", icon: LifeBuoy },
  { key: "rateUs", icon: Star },
];

// Placeholder stories until admins publish Spotlight content (B8).
const spotlightSamples = [
  { key: "offers", icon: TicketPercent },
  { key: "events", icon: CalendarDays },
  { key: "news", icon: Megaphone },
  { key: "safety", icon: ShieldCheck },
  { key: "partners", icon: Handshake },
] as const;

// Home (proposal section 5): service cards, Upcoming, quick actions and
// Spotlight. Real data arrives with the features.
export function HomePage() {
  const { t } = useTranslation();

  return (
    <>
      <Section title={t("home.featuresTitle")}>
        <div className={styles.features}>
          {featureList.map(({ key, picture }) => (
            <Link key={key} to={key === "service" ? "/services" : `/${key}`} className={styles.featureCard}>
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

      <Section title={t("home.spotlightTitle")}>
        <ul className={styles.stories}>
          {spotlightSamples.map(({ key, icon: Icon }) => (
            <li key={key} className={styles.story}>
              <span className={styles.storyRing}>
                <Icon aria-hidden strokeWidth={1.75} />
              </span>
              <span className={styles.storyTitle}>{t(`home.spotlight.${key}`)}</span>
              <span className={styles.storyNote}>{t("home.spotlight.sample")}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
