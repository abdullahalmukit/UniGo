import { ArrowLeft, Car, CarFront, Coins, GraduationCap, IdCard, LayoutDashboard, MapPin, Menu, ScrollText, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { Splash } from "../../app/RequireAuth";
import { useSession } from "../../app/use-session";
import { isAdminRole, NotAllowed, useAdminRole } from "./admin-ui";
import styles from "./admin.module.css";

const items = [
  { to: "/admin", labelKey: "admin.nav.dashboard", icon: LayoutDashboard, end: true, superAdminOnly: false },
  { to: "/admin/verifications", labelKey: "admin.nav.verifications", icon: IdCard, end: false, superAdminOnly: false },
  { to: "/admin/rider-requests", labelKey: "admin.nav.riderRequests", icon: CarFront, end: false, superAdminOnly: false },
  { to: "/admin/users", labelKey: "admin.nav.users", icon: Users, end: false, superAdminOnly: false },
  { to: "/admin/rides", labelKey: "admin.nav.rides", icon: Car, end: false, superAdminOnly: false },
  { to: "/admin/universities", labelKey: "admin.nav.universities", icon: GraduationCap, end: false, superAdminOnly: true },
  { to: "/admin/sub-areas", labelKey: "admin.nav.subAreas", icon: MapPin, end: false, superAdminOnly: true },
  { to: "/admin/fare-settings", labelKey: "admin.nav.fareSettings", icon: Coins, end: false, superAdminOnly: true },
  { to: "/admin/audit-log", labelKey: "admin.nav.auditLog", icon: ScrollText, end: false, superAdminOnly: true },
];

// The admin area (A8): Moderators and Super Admins only. Hiding links is only
// for looks; the server checks every request.
export function AdminLayout() {
  const { t } = useTranslation();
  const session = useSession();
  const role = useAdminRole();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  if (session.status === "unknown") return <Splash />;
  if (session.status === "guest") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (!isAdminRole(role)) {
    return (
      <main className={styles.main} style={{ paddingLeft: undefined }}>
        <NotAllowed />
      </main>
    );
  }

  const visible = items.filter((item) => !item.superAdminOnly || role === "SUPER_ADMIN");

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls="admin-menu"
          aria-label={t(open ? "admin.closeMenu" : "admin.openMenu")}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden size={22} /> : <Menu aria-hidden size={22} />}
        </button>
        <span className={styles.topTitle}>{t("admin.title")}</span>
      </header>

      <aside id="admin-menu" className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
        <span className={styles.sidebarTitle}>{t("admin.title")}</span>
        <nav aria-label={t("admin.menu")} className={styles.nav}>
          {visible.map(({ to, labelKey, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
            >
              <Icon aria-hidden size={20} />
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
        <NavLink to="/" className={styles.backLink}>
          <ArrowLeft aria-hidden size={20} />
          {t("admin.backToApp")}
        </NavLink>
      </aside>
      {open && <div className={styles.backdrop} aria-hidden onClick={() => setOpen(false)} />}

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

// Pages for Super Admins only (A8 decisions 3 and 4).
export function RequireSuperAdmin() {
  return useAdminRole() === "SUPER_ADMIN" ? <Outlet /> : <NotAllowed />;
}
