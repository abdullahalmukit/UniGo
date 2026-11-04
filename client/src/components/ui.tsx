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

export function EmptyState({ icon: Icon, text, action }: { icon: LucideIcon; text: string; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <Icon className={styles.emptyIcon} aria-hidden strokeWidth={1.75} />
      <p className={styles.emptyText}>{text}</p>
      {action}
    </div>
  );
}

export const buttonStyles = { primary: styles.buttonPrimary, secondary: styles.buttonSecondary };
