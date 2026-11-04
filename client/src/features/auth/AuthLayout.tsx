import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { BrandLogo } from "../../components/Brand";
import { setLanguage } from "../../i18n";
import styles from "./auth.module.css";

// The simple layout for auth pages (A5b decision): no navbar or bottom tabs;
// "Back to Home", a language switch and the full logo with its tagline.
export function AuthLayout() {
  const { t, i18n } = useTranslation();
  const other = i18n.language === "bn" ? "en" : "bn";

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link to="/" className={styles.back}>
          <ArrowLeft aria-hidden size={20} />
          {t("auth.backHome")}
        </Link>
        <button type="button" className={styles.language} lang={other} onClick={() => setLanguage(other)}>
          {t(`account.languages.${other}`)}
        </button>
      </header>
      <main className={styles.main}>
        <BrandLogo className={styles.logo} />
        <Outlet />
      </main>
    </div>
  );
}

// The title, optional subtitle and content of one auth page.
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      {children}
    </section>
  );
}
