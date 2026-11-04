import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import type { NavItem } from "./nav-items";
import styles from "./layout.module.css";

// An icon-only link with an aria-label, a tooltip on hover and keyboard focus,
// and an unread badge when `unread` is above 0.
export function IconLink({ item, unread = 0 }: { item: NavItem; unread?: number }) {
  const { t } = useTranslation();
  const label = t(item.labelKey);
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={unread > 0 ? `${label}, ${t("nav.unread", { count: unread })}` : label}
      data-tooltip={label}
      className={({ isActive }) => (isActive ? `${styles.iconButton} ${styles.active}` : styles.iconButton)}
    >
      <Icon aria-hidden strokeWidth={1.9} />
      {unread > 0 && (
        <span className={styles.iconBadge} aria-hidden>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </NavLink>
  );
}
