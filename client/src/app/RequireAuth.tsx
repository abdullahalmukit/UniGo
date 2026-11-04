import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation } from "react-router";
import { BrandLogo } from "../components/Brand";
import type { SessionManager } from "../lib/session";
import { useSession } from "./use-session";
import styles from "./layout/layout.module.css";

// Guests are sent to /login?next=<where they were going>. While the session is
// still being restored (page load), the splash is shown instead. Inside the auth
// layout the full logo is already on the page, so the splash leaves it out.
export function RequireAuth({ manager, showLogo = true }: { manager?: SessionManager; showLogo?: boolean }) {
  const state = useSession(manager);
  const location = useLocation();

  if (state.status === "unknown") return <Splash showLogo={showLogo} />;
  if (state.status === "guest") {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

export function Splash({ showLogo = true }: { showLogo?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={styles.splash}>
      {showLogo && <BrandLogo className={styles.splashLogo} />}
      <p role="status">{t("app.loading")}</p>
    </div>
  );
}
