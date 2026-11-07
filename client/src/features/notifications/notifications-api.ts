import { useEffect, useSyncExternalStore } from "react";
import { useSession } from "../../app/use-session";
import { api } from "../../lib/api";
import { chatSocket } from "../../lib/socket";

// In-app notifications (proposal section 14, B2c). The server builds the
// title, text and link in the user's saved language.

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  // A path in this app
  link: string;
  read: boolean;
  createdAt: string;
};

export type NotificationPage = { notifications: AppNotification[]; nextCursor: string | null; unreadCount: number };

export const listNotifications = (before?: string) =>
  api<NotificationPage>(`/notifications${before ? `?before=${encodeURIComponent(before)}` : ""}`);
export const getNotificationUnread = () => api<{ unreadCount: number }>("/notifications/unread-count");
export const markNotificationRead = (id: string) => api<{ unreadCount: number }>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
export const markAllNotificationsRead = () => api<{ unreadCount: number }>("/notifications/read-all", { method: "POST" });

// --- The bell's unread count, shared by every component

let unread = 0;
const listeners = new Set<() => void>();

export function setNotificationUnread(value: number) {
  if (value === unread) return;
  unread = value;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

chatSocket.on("notification:new", (event: { unreadCount: number }) => setNotificationUnread(event.unreadCount));
chatSocket.on("notification:unread", (event: { unreadCount: number }) => setNotificationUnread(event.unreadCount));

// Used once by the app layout: loads the count after login and after a
// reconnect; resets it on logout.
export function useNotificationUnread() {
  const state = useSession();
  const userId = state.status === "authenticated" ? state.session.user.id : null;

  useEffect(() => {
    if (!userId) {
      setNotificationUnread(0);
      return;
    }
    chatSocket.start();
    let cancelled = false;
    const load = () =>
      getNotificationUnread()
        .then((r) => !cancelled && setNotificationUnread(r.unreadCount))
        .catch(() => undefined);
    void load();
    const stop = chatSocket.on("connect", () => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, [userId]);

  return useSyncExternalStore(subscribe, () => unread);
}
