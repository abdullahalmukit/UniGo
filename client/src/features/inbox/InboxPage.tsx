import { MessageCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useSession } from "../../app/use-session";
import { Avatar } from "../../components/Avatar";
import { FormAlert } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { formatShortTime } from "../../lib/dates";
import { chatSocket } from "../../lib/socket";
import { SkeletonList } from "../account/SubPage";
import { linkUrl, listInbox, type InboxItem } from "./chat-api";
import styles from "./chat.module.css";
import { systemMessageKey } from "./system-text";

// Inbox (proposal section 13): the other person, activity type, last message
// and unread count, latest first. Updated live from the socket.
export function InboxPage() {
  const { t, i18n } = useTranslation();
  const state = useSession();
  const myId = state.status === "authenticated" ? state.session.user.id : "";
  const [chats, setChats] = useState<InboxItem[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const page = await listInbox();
      setChats(page.chats);
      setNextBefore(page.nextBefore);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    // A new message or a read anywhere: reload the list (small, one request).
    const stops = [chatSocket.on("inbox:update", () => void load()), chatSocket.on("chat:changed", () => void load())];
    return () => stops.forEach((stop) => stop());
  }, [load]);

  const more = async () => {
    if (!nextBefore) return;
    const page = await listInbox(nextBefore);
    setChats((current) => [...(current ?? []), ...page.chats]);
    setNextBefore(page.nextBefore);
  };

  return (
    <div className={styles.page}>
      <PageHeader title={t("inbox.title")} />
      {failed && (
        <FormAlert>
          {t("inbox.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load()}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!chats && !failed && <SkeletonList rows={3} />}
      {chats && chats.length === 0 && <EmptyState icon={MessageCircle} text={t("inbox.empty")} />}
      {chats && chats.length > 0 && (
        <ul className={styles.list}>
          {chats.map((chat) => (
            <li key={chat.chatId}>
              <Link to={`/inbox/${chat.chatId}`} className={styles.item}>
                <Avatar name={chat.otherUser.name} src={linkUrl(chat.otherUser.photo)} size={44} />
                <span className={styles.itemText}>
                  <span className={styles.itemTop}>
                    <span className={styles.name}>{chat.otherUser.name || t("chat.someone")}</span>
                    {chat.lastMessage && <span className={styles.muted}>{formatShortTime(chat.lastMessage.createdAt, i18n.language)}</span>}
                  </span>
                  <span className={styles.muted}>{t(`chat.type.${chat.activity.type}`)}</span>
                  <span className={chat.unreadCount > 0 ? `${styles.preview} ${styles.previewUnread}` : styles.preview}>
                    {preview(chat, myId, t)}
                  </span>
                </span>
                {chat.unreadCount > 0 && (
                  <span className={styles.count}>
                    {chat.unreadCount}
                    <span className="visually-hidden"> {t("nav.unread", { count: chat.unreadCount })}</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextBefore && (
        <button type="button" className={buttonStyles.secondary} onClick={() => void more()}>
          {t("inbox.more")}
        </button>
      )}
    </div>
  );
}

function preview(chat: InboxItem, myId: string, t: (key: string, options?: Record<string, unknown>) => string) {
  const last = chat.lastMessage;
  if (!last) return "";
  if (last.kind === "IMAGE") return t("chat.photo");
  if (last.kind === "SYSTEM") {
    const { key, fallbackKey } = systemMessageKey(last, myId, chat.activity.type);
    return t(key, { defaultValue: t(fallbackKey) });
  }
  return last.senderId === myId ? t("chat.youSaid", { text: last.body ?? "" }) : (last.body ?? "");
}
