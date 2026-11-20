// Small shared building blocks for pages: page title, section, card, empty state.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

export function PageHeader({ title }: { title: string }) {
  return <h1 className={styles.pageTitle}>{title}</h1>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.card} ${className}`}>{children}</div>;
}

export function EmptyState({
  icon: Icon,
  illustration,
  text,
  subtitle,
  action,
  className = "",
}: {
  icon?: LucideIcon;
  illustration?: string;
  text: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.empty} ${className}`}>
      {illustration ? (
        <div className={styles.emptyArtContainer}>
          <img src={illustration} alt="" aria-hidden className={styles.emptyArt} width={76} height={76} />
        </div>
      ) : Icon ? (
        <div className={styles.emptyIconContainer}>
          <Icon className={styles.emptyIcon} aria-hidden strokeWidth={1.75} />
        </div>
      ) : null}
      <div className={styles.emptyContent}>
        <p className={styles.emptyText}>{text}</p>
        {subtitle && <p className={styles.emptySubtitle}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const buttonStyles = { primary: styles.buttonPrimary, secondary: styles.buttonSecondary };
