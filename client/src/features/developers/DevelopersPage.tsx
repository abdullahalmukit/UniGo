import { Globe, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GithubIcon } from "../../components/GithubIcon";
import { SubPageHeader } from "../account/SubPage";
import { DEVELOPERS, githubHandle, siteLabel } from "./developers";
import styles from "./DevelopersPage.module.css";

// Meet the Developers: the three people who build UniGo, with their photo,
// role, email, GitHub and portfolio (where they have one). Public page.
export function DevelopersPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <SubPageHeader title={t("developers.title")} back="/" />
      <section className={styles.hero}>
        <p className={styles.eyebrow}>{t("developers.eyebrow")}</p>
        <h2 className={styles.heroTitle}>{t("developers.heading")}</h2>
        <p className={styles.lead}>{t("developers.lead")}</p>
      </section>

      <ul className={styles.grid}>
        {DEVELOPERS.map((developer) => (
          <li key={developer.id} className={styles.card}>
            <div className={styles.photoRing}>
              <img
                src={developer.photo.large}
                srcSet={`${developer.photo.small} 160w, ${developer.photo.large} 320w`}
                sizes="128px"
                alt={t("developers.photoOf", { name: developer.name })}
                width={128}
                height={128}
                loading="lazy"
                className={styles.photo}
              />
            </div>
            <h3 className={styles.name}>{developer.name}</h3>
            <p className={styles.role}>{t(`developers.roles.${developer.role}`)}</p>

            <ul className={styles.links}>
              <li>
                <a href={`mailto:${developer.email}`} className={styles.link}>
                  <Mail aria-hidden size={18} />
                  <span className={styles.linkText}>
                    <span className={styles.linkLabel}>{t("developers.email")}</span>
                    <span className={styles.linkValue}>{developer.email}</span>
                  </span>
                </a>
              </li>
              <li>
                <a href={developer.github} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  <GithubIcon size={18} />
                  <span className={styles.linkText}>
                    <span className={styles.linkLabel}>GitHub</span>
                    <span className={styles.linkValue}>@{githubHandle(developer.github)}</span>
                  </span>
                </a>
              </li>
              {developer.portfolio && (
                <li>
                  <a href={developer.portfolio} target="_blank" rel="noopener noreferrer" className={styles.link}>
                    <Globe aria-hidden size={18} />
                    <span className={styles.linkText}>
                      <span className={styles.linkLabel}>{t("developers.portfolio")}</span>
                      <span className={styles.linkValue}>{siteLabel(developer.portfolio)}</span>
                    </span>
                  </a>
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
