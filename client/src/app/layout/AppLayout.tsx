import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router";
import { useUnreadTotal } from "../../features/inbox/unread";
import { IconLink } from "./IconLink";
import { Logo } from "./Logo";
import { accountLink, bottomTabs, desktopLinks, notificationsLink } from "./nav-items";
import styles from "./layout.module.css";

// Phone (under 768 px): top bar + bottom tabs. Desktop: one top navbar and
// content centred at about 1100 px (proposal sections 3 and 5). Both are in the
// page; CSS shows the one that fits.
export function AppLayout() {
  const { t } = useTranslation();
  // Unread chat messages (B2b); notifications arrive in B2c.
  const unread = { messages: useUnreadTotal(), notifications: 0 };

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <Logo />
        <div className={styles.iconLinks}>
          <IconLink item={notificationsLink} unread={unread.notifications} />
          <IconLink item={accountLink} />
        </div>
      </header>

      <header className={styles.desktopBar}>
        <div className={styles.desktopInner}>
          <Logo />
          <nav aria-label={t("nav.main")} className={styles.desktopNav}>
            {desktopLinks.map(({ to, labelKey, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => linkClass(styles.desktopLink, isActive)}>
                {t(labelKey)}
                {to === "/inbox" && unread.messages > 0 && (
                  <span className={styles.inlineBadge}>
                    {unread.messages}
                    <span className="visually-hidden"> {t("nav.unread", { count: unread.messages })}</span>
                  </span>
                )}
              </NavLink>
            ))}
            <span className={styles.divider} aria-hidden />
            <IconLink item={notificationsLink} unread={unread.notifications} />
            <IconLink item={accountLink} />
          </nav>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav aria-label={t("nav.tabs")} className={styles.bottomTabs}>
        {bottomTabs.map(({ to, labelKey, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => linkClass(styles.tab, isActive)}>
            <span className={styles.tabIcon}>
              <Icon aria-hidden strokeWidth={1.9} />
              {to === "/inbox" && unread.messages > 0 && (
                <span className={styles.badge}>
                  {unread.messages}
                  <span className="visually-hidden"> {t("nav.unread", { count: unread.messages })}</span>
                </span>
              )}
            </span>
            <span className={styles.tabLabel}>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function linkClass(base: string, isActive: boolean) {
  return isActive ? `${base} ${styles.active}` : base;
}
