import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { FormAlert } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { formatShortTime } from "../../lib/dates";
import { chatSocket } from "../../lib/socket";
import { SkeletonList } from "../account/SubPage";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setNotificationUnread,
  type AppNotification,
} from "./notifications-api";
import styles from "./notifications.module.css";

// Notifications (proposal section 14): newest first, "Load more" for older
// ones. Tapping one marks it read and opens its page. New ones arrive live.
export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const page = await listNotifications();
      setItems(page.notifications);
      setNextCursor(page.nextCursor);
      setNotificationUnread(page.unreadCount);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const stops = [
      // A new one, or a chat notification that moved to the top: show it first.
      chatSocket.on("notification:new", (event: { notification: AppNotification }) => {
        setItems((current) => (current ? [event.notification, ...current.filter((n) => n.id !== event.notification.id)] : current));
      }),
      // Read in another tab
      chatSocket.on("notification:unread", () => void load()),
      chatSocket.on("connect", () => void load()),
    ];
    return () => stops.forEach((stop) => stop());
  }, [load]);

  const more = async () => {
    if (!nextCursor) return;
    const page = await listNotifications(nextCursor);
    setItems((current) => [...(current ?? []), ...page.notifications.filter((n) => !current?.some((c) => c.id === n.id))]);
    setNextCursor(page.nextCursor);
  };

  const open = (item: AppNotification) => {
    if (!item.read) {
      setItems((current) => current?.map((n) => (n.id === item.id ? { ...n, read: true } : n)) ?? current);
      markNotificationRead(item.id)
        .then((r) => setNotificationUnread(r.unreadCount))
        .catch(() => undefined);
    }
    void navigate(item.link);
  };

  const readAll = async () => {
    setBusy(true);
    try {
      const r = await markAllNotificationsRead();
      setNotificationUnread(r.unreadCount);
      setItems((current) => current?.map((n) => ({ ...n, read: true })) ?? current);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const hasUnread = items?.some((n) => !n.read) ?? false;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <PageHeader title={t("notifications.title")} />
        {hasUnread && (
          <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => void readAll()}>
            {t("notifications.markAllRead")}
          </button>
        )}
      </div>
      {failed && (
        <FormAlert>
          {t("notifications.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load()}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!items && !failed && <SkeletonList rows={4} />}
      {items && items.length === 0 && <EmptyState icon={Bell} text={t("notifications.empty")} />}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className={item.read ? styles.item : `${styles.item} ${styles.unread}`} onClick={() => open(item)}>
                <span className={styles.dot} aria-hidden />
                <span className={styles.text}>
                  <span className={styles.top}>
                    <span className={styles.title}>{item.title}</span>
                    <span className={styles.time}>{formatShortTime(item.createdAt, i18n.language)}</span>
                  </span>
                  <span className={styles.body}>{item.body}</span>
                  {!item.read && <span className="visually-hidden">{t("notifications.unreadLabel")}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {nextCursor && (
        <button type="button" className={buttonStyles.secondary} onClick={() => void more()}>
          {t("notifications.loadMore")}
        </button>
      )}
    </div>
  );
}
