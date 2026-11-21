import { ArrowUpRight, Headphones, Mail, MapPin, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BrandLogo } from "../../components/Brand";
import { GithubIcon } from "../../components/GithubIcon";
import { DEVELOPERS } from "../../features/developers/developers";
import styles from "./Footer.module.css";

// The site footer (every page in the main layout): the brand and contact,
// links to the services, the most used pages, the account and support pages,
// the development team and the legal line. On phones the columns stack and
// the footer ends above the bottom tabs.

const CONTACT_EMAIL = "abdullahalmukit287@gmail.com";

type FooterLink = { to: string; key: string };
const COLUMNS: { key: string; links: FooterLink[] }[] = [
  {
    key: "services",
    links: [
      { to: "/ride", key: "ride" },
      { to: "/carpool", key: "carpool" },
      { to: "/food", key: "food" },
      { to: "/service", key: "service" },
      { to: "/services", key: "allServices" },
      { to: "/drive", key: "drive" },
    ],
  },
  {
    key: "quick",
    links: [
      { to: "/", key: "home" },
      { to: "/upcoming", key: "upcoming" },
      { to: "/activity", key: "activity" },
      { to: "/inbox", key: "inbox" },
      { to: "/notifications", key: "notifications" },
      { to: "/promos", key: "promos" },
    ],
  },
  {
    key: "account",
    links: [
      { to: "/account", key: "settings" },
      { to: "/account/profile", key: "profile" },
      { to: "/verify-student?next=%2Faccount", key: "verification" },
      { to: "/account/addresses", key: "addresses" },
      { to: "/account/sub-areas", key: "subAreas" },
      { to: "/account/payment-methods", key: "paymentMethods" },
    ],
  },
  {
    key: "support",
    links: [
      { to: "/account/support", key: "help" },
      { to: "/about", key: "about" },
      { to: "/developers", key: "developers" },
      { to: "/policy", key: "policy" },
      { to: "/account/rate-us", key: "rateUs" },
    ],
  },
];

export function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <section className={styles.brand} aria-label="UniGo">
            <Link to="/" className={styles.logo} aria-label={t("footer.home")}>
              <BrandLogo className={styles.brandLogo} />
            </Link>
            <p className={styles.tagline}>{t("footer.tagline")}</p>
            <ul className={styles.contact}>
              <li>
                <Mail aria-hidden size={16} />
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </li>
              <li>
                <Headphones aria-hidden size={16} />
                <Link to="/account/support">{t("footer.contact.support")}</Link>
              </li>
              <li>
                <MapPin aria-hidden size={16} />
                <span>{t("footer.contact.location")}</span>
              </li>
            </ul>
            <p className={styles.trust}>
              <ShieldCheck aria-hidden size={16} />
              {t("footer.trust")}
            </p>
          </section>

          <nav className={styles.columns} aria-label={t("footer.navLabel")}>
            {COLUMNS.map((column) => (
              <div key={column.key} className={styles.column}>
                <h2 className={styles.heading}>{t(`footer.columns.${column.key}`)}</h2>
                <ul className={styles.links}>
                  {column.links.map((link) => (
                    <li key={link.to}>
                      <Link to={link.to} className={styles.link}>
                        {t(`footer.links.${link.key}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <section className={styles.team} aria-labelledby="footer-team">
          <div className={styles.teamText}>
            <h2 id="footer-team" className={styles.heading}>
              {t("footer.team.title")}
            </h2>
            <p className={styles.muted}>{t("footer.team.text")}</p>
          </div>
          <ul className={styles.teamList}>
            {DEVELOPERS.map((developer) => (
              <li key={developer.id} className={styles.member}>
                <img src={developer.photo.small} alt="" width={40} height={40} loading="lazy" className={styles.avatar} />
                <span className={styles.memberName}>{developer.name}</span>
                <a href={developer.github} target="_blank" rel="noopener noreferrer" className={styles.iconLink} aria-label={t("developers.githubOf", { name: developer.name })}>
                  <GithubIcon size={16} />
                </a>
              </li>
            ))}
          </ul>
          <Link to="/developers" className={styles.teamLink}>
            {t("footer.team.meet")} <ArrowUpRight aria-hidden size={16} />
          </Link>
        </section>

        <div className={styles.bottom}>
          <p>{t("footer.copyright", { year })}</p>
          <ul className={styles.legal}>
            <li>
              <Link to="/policy#policy-terms">{t("footer.legal.terms")}</Link>
            </li>
            <li>
              <Link to="/policy#policy-privacy">{t("footer.legal.privacy")}</Link>
            </li>
            <li>
              <Link to="/policy#policy-safety">{t("footer.legal.safety")}</Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
