import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import styles from "./settings.module.css";

// Title of an Account & Settings sub-page, with a way back.
export function SubPageHeader({ title, back = "/account", action }: { title: string; back?: string; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={styles.header}>
      <Link to={back} className={styles.back} aria-label={t("common.back")}>
        <ArrowLeft aria-hidden size={22} />
      </Link>
      <h1 className={styles.title}>{title}</h1>
      {action}
    </div>
  );
}

// A loading placeholder in the shape of a list (skeleton loader).
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className={styles.skeletonList} role="status" aria-label={t("app.loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className={styles.skeleton} />
      ))}
    </div>
  );
}
