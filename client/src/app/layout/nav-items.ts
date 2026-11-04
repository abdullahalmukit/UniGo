import { Bell, CalendarClock, CircleUserRound, House, LayoutGrid, ListChecks, MessageCircle, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; labelKey: string; icon: LucideIcon; end?: boolean };

// Phone bottom tabs (proposal section 5): Home, Activity, Upcoming, All Services, Inbox.
export const bottomTabs: NavItem[] = [
  { to: "/", labelKey: "nav.home", icon: House, end: true },
  { to: "/activity", labelKey: "nav.activity", icon: ListChecks },
  { to: "/upcoming", labelKey: "nav.upcoming", icon: CalendarClock },
  { to: "/services", labelKey: "nav.allServices", icon: LayoutGrid },
  { to: "/inbox", labelKey: "nav.inbox", icon: MessageCircle },
];

// Desktop top navbar, in the proposal's order: text links, then Notifications
// and Account & Settings as icons (A5a polish).
export const desktopLinks: NavItem[] = [
  { to: "/", labelKey: "nav.home", icon: House, end: true },
  { to: "/services", labelKey: "nav.allServices", icon: LayoutGrid },
  { to: "/upcoming", labelKey: "nav.upcoming", icon: CalendarClock },
  { to: "/activity", labelKey: "nav.activity", icon: ListChecks },
  { to: "/inbox", labelKey: "nav.inbox", icon: MessageCircle },
];

export const notificationsLink: NavItem = { to: "/notifications", labelKey: "nav.notifications", icon: Bell };
export const accountLink: NavItem = { to: "/account", labelKey: "nav.account", icon: CircleUserRound };
