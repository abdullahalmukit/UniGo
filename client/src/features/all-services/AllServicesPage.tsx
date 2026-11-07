import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { featureList } from "../../app/feature-list";
import { useSession } from "../../app/use-session";
import { buttonStyles, PageHeader } from "../../components/ui";
import styles from "./AllServicesPage.module.css";

// Public page (A5a decision). Guests who tap Create or Browse go to log in; for
// logged-in users the features are not built yet.
export function AllServicesPage() {
  const { t } = useTranslation();
  const isGuest = useSession().status !== "authenticated";
  const loginLink = `/login?next=${encodeURIComponent("/services")}`;

  return (
    <>
      <PageHeader title={t("services.title")} />
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
              ) : key === "ride" ? (
                // Ride Sharing is open since B3a
                <>
                  <Link to="/ride/requests/new" className={buttonStyles.primary}>
                    {t("services.create")}
                  </Link>
                  <Link to="/ride" className={buttonStyles.secondary}>
                    {t("services.browse")}
                  </Link>
                </>
              ) : (
                <>
                  <button type="button" className={buttonStyles.primary} disabled>
                    {t("services.create")}
                  </button>
                  <button type="button" className={buttonStyles.secondary} disabled>
                    {t("services.browse")}
                  </button>
                </>
              )}
            </div>
            {!isGuest && key !== "ride" && <p className={styles.soon}>{t("services.comingSoon")}</p>}
          </article>
        ))}
      </div>
    </>
  );
}
