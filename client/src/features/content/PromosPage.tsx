import { Copy, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/ui";
import { useToast } from "../../components/toast";
import { formatDate } from "../../lib/dates";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import { getPromos, type Promo } from "./content-api";
import styles from "./PromosPage.module.css";

// Promos page (proposal section 5 / B8): active offers with start and end date,
// optional promo code and description.
export function PromosPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [promos, setPromos] = useState<Promo[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getPromos()
      .then((items) => {
        setPromos(items);
        setError(false);
      })
      .catch(() => {
        setPromos([]);
        setError(true);
      });
  }, []);

  const copyCode = (code: string) => {
    void navigator.clipboard.writeText(code).then(() => {
      toast.show(t("promos.codeCopied"));
    });
  };

  return (
    <div className={styles.page}>
      <SubPageHeader title={t("promos.title")} back="/account" />

      {promos === null ? (
        <SkeletonList rows={3} />
      ) : promos.length === 0 ? (
        <EmptyState icon={Tag} text={error ? t("promos.loadFailed") : t("promos.empty")} />
      ) : (
        <ul className={styles.list}>
          {promos.map((promo) => (
            <li key={promo.id} className={styles.card}>
              {promo.imageUrl && (
                <div className={styles.imageWrapper}>
                  <img src={promo.imageUrl} alt={promo.title} className={styles.image} loading="lazy" />
                </div>
              )}
              <div className={styles.content}>
                <div className={styles.header}>
                  <h2 className={styles.title}>{promo.title}</h2>
                  <span className={styles.badge}>{t("promos.active")}</span>
                </div>
                {promo.description && <p className={styles.description}>{promo.description}</p>}
                <div className={styles.footer}>
                  {promo.promoCode && (
                    <button
                      type="button"
                      className={styles.codeButton}
                      onClick={() => copyCode(promo.promoCode!)}
                      title={t("promos.copyCode")}
                    >
                      <span className={styles.codeText}>{promo.promoCode}</span>
                      <Copy size={15} aria-hidden />
                    </button>
                  )}
                  <span className={styles.validity}>
                    {t("promos.validUntil", { date: formatDate(promo.endsAt, i18n.language) })}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

