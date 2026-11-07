import { ApprovalCard } from "../food/ApprovalCard";
import { ArrowLeft, ImagePlus, MoreVertical, Phone, SendHorizontal } from "lucide-react";
import { activityPath, profilePath } from "../../lib/activity-links";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useSession } from "../../app/use-session";
import { Avatar } from "../../components/Avatar";
import { BottomSheet, FormAlert } from "../../components/form";
import { StatusChip } from "../../components/StatusChip";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { formatShortTime } from "../../lib/dates";
import { formErrors } from "../../lib/errors";
import { chatSocket } from "../../lib/socket";
import { SkeletonList } from "../account/SubPage";
import { shrinkImage } from "../profile/shrink-image";
import {
  blockInChat,
  getBlockImpact,
  getChat,
  linkUrl,
  listMessages,
  markRead,
  report,
  REPORT_REASONS,
  sendImage,
  sendMessage,
  type BlockImpact,
  type ChatDetails,
  type ChatMessage,
  type ReportReason,
  type SignedLink,
} from "./chat-api";
import styles from "./chat.module.css";
import { systemMessageDetail, systemMessageKey } from "./system-text";
import { setUnreadTotal } from "./unread";

// Expired image links are fetched again at most this often (B2b decision 10).
const LINK_REFRESH_MIN_MS = 15_000;

// One chat (proposal section 13): messages in real time, Call while the
// activity runs, food receipts, Report and Block, read-only when it has ended.
export function ChatPage() {
  const { chatId = "" } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const state = useSession();
  const myId = state.status === "authenticated" ? state.session.user.id : "";

  const [chat, setChat] = useState<ChatDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"menu" | "report" | "block" | null>(null);
  const lastLinkRefresh = useRef(0);
  const messagesLoadedBefore = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadChat = useCallback(async () => {
    try {
      setChat(await getChat(chatId));
    } catch (error) {
      setLoadError(formErrors(error, t).form ?? t("errors.generic"));
    }
  }, [chatId, t]);

  // The newest page; merged by id so older pages and live messages stay.
  const loadLatest = useCallback(async () => {
    const page = await listMessages(chatId);
    setMessages((current) => mergeMessages(current ?? [], page.messages));
    setHasMore((had) => (messagesLoadedBefore.current ? had : page.hasMore));
    messagesLoadedBefore.current = true;
  }, [chatId]);

  useEffect(() => {
    messagesLoadedBefore.current = false;
    setChat(null);
    setMessages(null);
    void loadChat();
    loadLatest().catch((error) => setLoadError(formErrors(error, t).form ?? t("errors.generic")));

    const leave = chatSocket.joinChat(chatId);
    // No push or notification for this chat while it is on screen (B2c)
    chatSocket.setViewingChat(chatId);
    const stops = [
      chatSocket.on("message:new", (message: ChatMessage) => {
        if (message.chatId !== chatId) return;
        setMessages((current) => mergeMessages(current ?? [], [message]));
        // A system message may change the status (read-only, phone); a
        // decided approval also changes its card (B4)
        if (message.kind === "SYSTEM") {
          void loadChat();
          void loadLatest().catch(() => undefined);
        }
      }),
      chatSocket.on("chat:changed", (change: { chatId: string }) => {
        if (change.chatId === chatId) void loadChat();
      }),
      // Messages sent while disconnected
      chatSocket.on("connect", () => void loadLatest().catch(() => undefined)),
    ];
    return () => {
      chatSocket.setViewingChat(null);
      leave();
      stops.forEach((stop) => stop());
    };
  }, [chatId, loadChat, loadLatest, t]);

  // Mark read up to the newest message, and keep the view at the bottom.
  const newestId = messages?.at(-1)?.id;
  useEffect(() => {
    if (!newestId) return;
    bottom.current?.scrollIntoView?.({ block: "end" });
    markRead(chatId, newestId)
      .then((r) => setUnreadTotal(r.unreadTotal))
      .catch(() => undefined);
  }, [chatId, newestId]);

  const loadOlder = async () => {
    const oldest = messages?.[0]?.id;
    if (!oldest) return;
    const page = await listMessages(chatId, oldest);
    setMessages((current) => mergeMessages(current ?? [], page.messages));
    setHasMore(page.hasMore);
  };

  // An image link expired (or failed): fetch fresh links instead of showing a
  // broken image. Re-reads every loaded page, newest first.
  const refreshLinks = useCallback(async () => {
    if (Date.now() - lastLinkRefresh.current < LINK_REFRESH_MIN_MS) return false;
    lastLinkRefresh.current = Date.now();
    const loaded = messages?.length ?? 0;
    let fresh: ChatMessage[] = [];
    let before: string | undefined;
    do {
      const page = await listMessages(chatId, before);
      fresh = [...page.messages, ...fresh];
      before = page.messages[0]?.id;
      if (!page.hasMore) break;
    } while (fresh.length < loaded);
    setMessages((current) => mergeMessages(current ?? [], fresh));
    return true;
  }, [chatId, messages?.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await sendMessage(chatId, body);
      setMessages((current) => mergeMessages(current ?? [], [message]));
      setDraft("");
    } catch (error) {
      setSendError(formErrors(error, t).form ?? t("errors.generic"));
      void loadChat();
    } finally {
      setSending(false);
    }
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await sendImage(chatId, await shrinkImage(file, 1600));
      setMessages((current) => mergeMessages(current ?? [], [message]));
    } catch (error) {
      setSendError(formErrors(error, t).form ?? t("errors.generic"));
    } finally {
      setSending(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (loadError && !chat) {
    return (
      <div className={styles.page}>
        <FormAlert>{loadError}</FormAlert>
        <Link to="/inbox" className={buttonStyles.secondary}>
          {t("chat.backToInbox")}
        </Link>
      </div>
    );
  }

  const other = chat?.otherUser;
  return (
    <div className={styles.chat}>
      <header className={styles.chatHeader}>
        <Link to="/inbox" className={styles.iconButton} aria-label={t("chat.backToInbox")}>
          <ArrowLeft aria-hidden />
        </Link>
        {/* The name and photo open the other person's profile (B3b-1 G) */}
        {other?.id ? (
          <Link to={profilePath(other.id)} className={styles.headerPerson} aria-label={t("profile.open", { name: other.name || t("chat.someone") })}>
            <Avatar name={other.name} src={linkUrl(other.photo)} size={40} />
          </Link>
        ) : (
          <Avatar name={other?.name ?? ""} src={linkUrl(other?.photo)} size={40} />
        )}
        <span className={styles.headerText}>
          {other?.id ? (
            <Link to={profilePath(other.id)} className={`${styles.name} ${styles.headerName}`}>
              {other.name || t("chat.someone")}
            </Link>
          ) : (
            <span className={styles.name}>{other?.name || (chat ? t("chat.someone") : "")}</span>
          )}
          {chat && (
            <span className={styles.headerMeta}>
              <span className={styles.muted}>{t(`chat.type.${chat.activity.type}`)}</span>
              <StatusChip status={chat.activity.status} />
              <Link to={activityPath(chat.activity.type, chat.activity.id)} className={styles.detailsLink}>
                {t("chat.viewDetails")}
              </Link>
            </span>
          )}
          {/* The phone as text, after acceptance and while the activity runs (B3b-1 D) */}
          {other?.phone && (
            <span className={styles.headerPhone} dir="ltr">
              {other.phone}
            </span>
          )}
        </span>
        {other?.phone && (
          <a href={`tel:${other.phone}`} className={`${styles.iconButton} ${styles.call}`} aria-label={t("chat.call", { phone: other.phone })}>
            <Phone aria-hidden />
          </a>
        )}
        {chat && (
          <button type="button" className={styles.iconButton} aria-label={t("chat.menu")} onClick={() => setSheet("menu")}>
            <MoreVertical aria-hidden />
          </button>
        )}
      </header>

      <div className={styles.messages} aria-live="polite">
        {!messages && <SkeletonList rows={3} />}
        {hasMore && (
          <button type="button" className={`${buttonStyles.secondary} ${styles.older}`} onClick={() => void loadOlder()}>
            {t("chat.older")}
          </button>
        )}
        {messages?.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            myId={myId}
            chat={chat}
            language={i18n.language}
            onImageExpired={refreshLinks}
            onApprovalDecided={() => void loadLatest().catch(() => undefined)}
          />
        ))}
        <div ref={bottom} />
      </div>

      {chat?.readOnly ? (
        <p className={styles.banner} role="status">
          {chat.readOnly === "FINISHED" ? t("chat.readOnlyFinished") : chat.blockedByMe ? t("chat.readOnlyBlockedByMe") : t("chat.readOnlyBlocked")}
        </p>
      ) : (
        chat && (
          <form className={styles.composer} onSubmit={(event) => void submit(event)}>
            {chat.canSendImages && (
              <>
                <button type="button" className={styles.iconButton} aria-label={t("chat.addPhoto")} onClick={() => fileInput.current?.click()} disabled={sending}>
                  <ImagePlus aria-hidden />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png"
                  hidden
                  onChange={(event) => void pickImage(event.target.files?.[0])}
                />
              </>
            )}
            <textarea
              className={styles.input}
              value={draft}
              rows={1}
              maxLength={1000}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit(event);
                }
              }}
            />
            <button type="submit" className={`${styles.iconButton} ${styles.send}`} aria-label={t("chat.send")} disabled={sending || !draft.trim()}>
              <SendHorizontal aria-hidden />
            </button>
          </form>
        )
      )}
      {sendError && <FormAlert>{sendError}</FormAlert>}

      <BottomSheet title={t("chat.menu")} open={sheet === "menu"} onClose={() => setSheet(null)}>
        <div className={styles.menu}>
          <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("report")}>
            {t("chat.report")}
          </button>
          {chat?.blockedByMe ? (
            <Link to="/account/blocked" className={buttonStyles.secondary}>
              {t("chat.manageBlocked")}
            </Link>
          ) : (
            <button type="button" className={`${buttonStyles.secondary} ${styles.danger}`} onClick={() => setSheet("block")}>
              {t("chat.block")}
            </button>
          )}
        </div>
      </BottomSheet>

      {chat && (
        <ReportSheet
          open={sheet === "report"}
          onClose={() => setSheet(null)}
          activityId={chat.activity.id}
          name={other?.name ?? ""}
          onDone={() => {
            setSheet(null);
            toast.show(t("chat.reported"));
          }}
        />
      )}
      {chat && (
        <BlockSheet
          open={sheet === "block"}
          onClose={() => setSheet(null)}
          chatId={chatId}
          name={other?.name ?? ""}
          onReport={() => setSheet("report")}
          onDone={() => {
            setSheet(null);
            toast.show(t("chat.blocked", { name: other?.name ?? "" }));
            void loadChat();
          }}
        />
      )}
    </div>
  );
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function MessageBubble({
  message,
  myId,
  chat,
  language,
  onImageExpired,
  onApprovalDecided,
}: {
  message: ChatMessage;
  myId: string;
  chat: ChatDetails | null;
  language: string;
  onImageExpired: () => Promise<boolean>;
  onApprovalDecided: () => void;
}) {
  const { t } = useTranslation();
  if (message.kind === "APPROVAL" && message.approval && chat) {
    return <ApprovalCard approval={message.approval} activityId={chat.activity.id} canDecide={chat.activity.role === "CREATOR" && !chat.readOnly} onDecided={onApprovalDecided} />;
  }
  if (message.kind === "SYSTEM") {
    const { key, fallbackKey } = systemMessageKey(message, myId, chat?.activity.type ?? "FOOD");
    const detail = systemMessageDetail(message);
    return (
      <p className={styles.system}>
        {t(key, { defaultValue: t(fallbackKey, { defaultValue: "" }) })}
        {detail && <span className={styles.time}>{t("chat.reason", { reason: detail })}</span>}
      </p>
    );
  }
  const mine = message.senderId === myId;
  return (
    <div className={`${styles.bubble} ${mine ? styles.mine : styles.theirs}`}>
      {message.kind === "IMAGE" && message.image ? (
        <ChatImage link={message.image} onExpired={onImageExpired} />
      ) : (
        // Plain text only: React escapes it, nothing is read as HTML.
        message.body
      )}
      <span className={styles.time}>{formatShortTime(message.createdAt, language)}</span>
    </div>
  );
}

// Shows a receipt through its short-lived link. An expired link (before or
// while loading) asks for fresh links instead of showing a broken image; if a
// fresh link fails too, a "Try again" button is shown.
export function ChatImage({ link, onExpired }: { link: SignedLink; onExpired: () => Promise<boolean> }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const expired = useMemo(() => new Date(link.expiresAt).getTime() <= Date.now(), [link.expiresAt]);

  useEffect(() => {
    setFailed(false);
    if (expired) void onExpired();
  }, [link.url, expired, onExpired]);

  if (expired || failed) {
    return (
      <span className={styles.imageMissing}>
        {t("chat.photoExpired")}
        <button
          type="button"
          className={buttonStyles.secondary}
          onClick={() => {
            void onExpired();
          }}
        >
          {t("auth.retry")}
        </button>
      </span>
    );
  }
  return (
    <img
      className={styles.image}
      src={linkUrl(link) ?? undefined}
      alt={t("chat.photo")}
      onError={() => {
        setFailed(true);
        void onExpired();
      }}
    />
  );
}

function ReportSheet({
  open,
  onClose,
  activityId,
  name,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  activityId: string;
  name: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setDescription("");
    setError(null);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason) {
      setError(t("chat.reportPickReason"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await report({ reason, description: description.trim() || undefined, activityId });
      onDone();
    } catch (failure) {
      const errors = formErrors(failure, t);
      setError(errors.fields.description ?? errors.form ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={t("chat.reportTitle", { name })} open={open} onClose={onClose}>
      <form className={styles.menu} onSubmit={(event) => void submit(event)}>
        <fieldset className={styles.reasons}>
          <legend className="visually-hidden">{t("chat.reportReason")}</legend>
          {REPORT_REASONS.map((value) => (
            <label key={value} className={styles.reason}>
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              {t(`chat.reasons.${value}`)}
            </label>
          ))}
        </fieldset>
        <textarea
          className={styles.textarea}
          value={description}
          maxLength={1000}
          placeholder={reason === "OTHER" ? t("chat.reportDescribeRequired") : t("chat.reportDescribe")}
          aria-label={t("chat.reportDescribe")}
          onChange={(event) => setDescription(event.target.value)}
        />
        {error && <FormAlert>{error}</FormAlert>}
        <button type="submit" className={buttonStyles.primary} disabled={busy}>
          {t("chat.reportSend")}
        </button>
      </form>
    </BottomSheet>
  );
}

// Block from chat (B2b decision 8): shows what blocking will cancel first.
// With a carpool contract it is refused; the sheet points to early
// termination or a complaint and offers Report.
function BlockSheet({
  open,
  onClose,
  chatId,
  name,
  onReport,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  chatId: string;
  name: string;
  onReport: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [impact, setImpact] = useState<BlockImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setImpact(null);
    setError(null);
    getBlockImpact(chatId)
      .then(setImpact)
      .catch((failure) => setError(formErrors(failure, t).form ?? t("errors.generic")));
  }, [open, chatId, t]);

  const block = async () => {
    setBusy(true);
    setError(null);
    try {
      await blockInChat(chatId);
      onDone();
    } catch (failure) {
      setError(formErrors(failure, t).form ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={t("chat.blockTitle", { name })} open={open} onClose={onClose}>
      <div className={styles.menu}>
        {!impact && !error && <SkeletonList rows={1} />}
        {impact?.refusedForCarpoolContract && <p>{t("chat.blockCarpool")}</p>}
        {impact && !impact.refusedForCarpoolContract && (
          <>
            <p>{t("chat.blockText", { name })}</p>
            {impact.cancels.length > 0 && (
              <>
                <p>{t("chat.blockCancels", { count: impact.cancels.length })}</p>
                <ul className={styles.impact}>
                  {impact.cancels.map((activity) => (
                    <li key={activity.id}>
                      {t(`chat.type.${activity.type}`)} · {formatShortTime(activity.startTime, i18n.language)}
                    </li>
                  ))}
                </ul>
                <p className={styles.muted}>{t("chat.blockLateNote")}</p>
              </>
            )}
          </>
        )}
        {error && <FormAlert>{error}</FormAlert>}
        {impact && !impact.refusedForCarpoolContract && (
          <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void block()}>
            {t("chat.blockConfirm")}
          </button>
        )}
        <button type="button" className={buttonStyles.secondary} onClick={onReport}>
          {t("chat.report")}
        </button>
      </div>
    </BottomSheet>
  );
}
