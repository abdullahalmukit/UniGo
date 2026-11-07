import { prisma } from "../../lib/prisma.js";
import { isUserViewingChat } from "../../sockets/registry.js";
import { announce, announceUnread, notificationSelect, notify } from "./notify.service.js";

// New chat messages (proposal section 14, B2c decisions):
// - nothing while the receiver has that chat open and visible;
// - in-app: one row per chat per unread run (key NEW_CHAT_MESSAGE:<chat>:<the
//   receiver's last read time>), updated by later messages and marked read
//   when the chat is read, so the Notifications page does not fill up;
// - push: one per message, tag chat-<chat> on the device, alerting
//   (renotify) only for the first message of the run; later ones replace it
//   silently;
// - never the message text.
// System messages notify nobody here: their activity notification does.

export const chatRunKeyPrefix = (chatId: string) => `NEW_CHAT_MESSAGE:${chatId}:`;

export async function notifyChatMessage(event: { chatId: string; messageId: string; participantIds: readonly string[] }) {
  const message = await prisma.message.findUnique({
    where: { id: event.messageId },
    select: { senderId: true, kind: true, chat: { select: { activityId: true } } },
  });
  // System lines and B4 approval cards have their own notifications (or none)
  if (!message || message.kind === "SYSTEM" || message.kind === "APPROVAL" || !message.senderId) return;
  const senderId = message.senderId;
  const sender = await prisma.profile.findUnique({ where: { userId: senderId }, select: { fullName: true } });
  const name = sender?.fullName ?? "";

  for (const recipient of event.participantIds) {
    if (recipient === senderId) continue;
    if (await isUserViewingChat(recipient, event.chatId)) continue;

    const read = await prisma.chatRead.findUnique({
      where: { chatId_userId: { chatId: event.chatId, userId: recipient } },
      select: { lastReadAt: true },
    });
    const runKey = `${chatRunKeyPrefix(event.chatId)}${read?.lastReadAt.getTime() ?? 0}`;
    const { first, count } = await addToRun(recipient, runKey, event.chatId, name, message.chat.activityId);

    await notify({
      type: "NEW_CHAT_MESSAGE",
      userIds: [recipient],
      dedupeKey: `NEW_CHAT_MESSAGE:${event.messageId}`,
      activityId: message.chat.activityId,
      only: ["PUSH"],
      data: { chatId: event.chatId, name, count, renotify: first },
    });
  }
}

// The in-app row of this unread run: created by the first message, then each
// later message adds one, takes the latest sender's name, moves it to the top
// and makes it unread again.
async function addToRun(userId: string, runKey: string, chatId: string, name: string, activityId: string) {
  const bump = () => prisma.$executeRaw`
    UPDATE notifications
    SET data = JSON_SET(COALESCE(data, JSON_OBJECT()), '$.count', COALESCE(JSON_EXTRACT(data, '$.count'), 1) + 1, '$.name', ${name}),
        read_at = NULL, created_at = ${new Date()}, updated_at = ${new Date()}
    WHERE user_id = ${userId} AND channel = 'IN_APP' AND dedupe_key = ${runKey}`;

  let first = false;
  if ((await bump()) === 0) {
    const created = await notify({
      type: "NEW_CHAT_MESSAGE",
      userIds: [userId],
      dedupeKey: runKey,
      activityId,
      only: ["IN_APP"],
      data: { chatId, name, count: 1 },
    });
    first = created.length > 0;
    // Another message created it at the same moment: count this one too.
    if (!first) await bump();
  }

  const row = await prisma.notification.findUnique({
    where: { userId_channel_dedupeKey: { userId, channel: "IN_APP", dedupeKey: runKey } },
    select: notificationSelect,
  });
  if (row && !first) await announce([row]);
  const count = Number((row?.data as { count?: unknown } | null)?.count ?? 1);
  return { first, count };
}

// Reading a chat marks its chat notifications read.
export async function markChatNotificationsRead(userId: string, chatId: string) {
  const updated = await prisma.notification.updateMany({
    where: { userId, channel: "IN_APP", type: "NEW_CHAT_MESSAGE", readAt: null, dedupeKey: { startsWith: chatRunKeyPrefix(chatId) } },
    data: { readAt: new Date() },
  });
  if (updated.count > 0) await announceUnread(userId);
}
