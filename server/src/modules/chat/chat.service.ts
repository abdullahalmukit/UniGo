import sharp from "sharp";
import { rules } from "../../config/rules.js";
import type { ActivityStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { deletePrivateFile, putPrivateFile } from "../../lib/private-storage.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { consumeChatSend } from "../../middleware/rate-limit.js";
import { AppError } from "../../utils/app-error.js";
import { assertCanAccess, effectiveAccountStatus } from "../auth/account-status.js";
import { isBlockedBetween } from "../users/blocks.service.js";
import { photoLink } from "../users/photo.js";
import { publishChatEvents } from "./chat-events.js";
import { sanitizeMessageText } from "./chat-text.js";

// Inbox and chat (proposal section 13, B2b decisions). Every function checks
// that the user takes part in the chat's activity. No payload ever contains an
// email address; the phone number only while the chat is active and nobody
// has blocked the other (B2b decision 9).

type Tx = Prisma.TransactionClient;

// Messages can be sent while the activity runs; every other status is final
const ACTIVE_STATUSES: readonly ActivityStatus[] = ["ACCEPTED", "IN_PROGRESS", "DISPUTED"];

export type ReadOnlyReason = "FINISHED" | "BLOCKED";

const chatActivitySelect = {
  id: true,
  activityId: true,
  lastMessageAt: true,
  activity: { select: { id: true, type: true, status: true, subStatus: true, startTime: true, creatorId: true, accepterId: true } },
} as const satisfies Prisma.ChatSelect;

type ChatWithActivity = Prisma.ChatGetPayload<{ select: typeof chatActivitySelect }>;

function otherParticipant(chat: ChatWithActivity, userId: string) {
  return chat.activity.creatorId === userId ? chat.activity.accepterId : chat.activity.creatorId;
}

function participants(chat: ChatWithActivity) {
  return [chat.activity.creatorId, chat.activity.accepterId].filter((id): id is string => !!id);
}

// The chat, if the user takes part in it. Non-participants get NOT_PARTICIPANT.
export async function chatForParticipant(userId: string, chatId: string, db: Tx | typeof prisma = prisma) {
  const chat = await db.chat.findUnique({ where: { id: chatId }, select: chatActivitySelect });
  if (!chat) throw new AppError(404, "CHAT_NOT_FOUND", "This chat was not found");
  if (chat.activity.creatorId !== userId && chat.activity.accepterId !== userId) {
    throw new AppError(403, "NOT_PARTICIPANT", "You are not part of this chat");
  }
  return chat;
}

export function readOnlyReason(status: ActivityStatus, blocked: boolean): ReadOnlyReason | null {
  if (!ACTIVE_STATUSES.includes(status)) return "FINISHED";
  if (blocked) return "BLOCKED";
  return null;
}

// --- Views. Built field by field, so nothing else (never an email) can leak.

const userCardSelect = {
  id: true,
  phone: true,
  university: { select: { name: true, shortName: true } },
  profile: { select: { fullName: true, photoKey: true } },
} as const satisfies Prisma.UserSelect;

type UserCard = Prisma.UserGetPayload<{ select: typeof userCardSelect }>;

async function userCard(user: UserCard | null, showPhone: boolean) {
  return {
    id: user?.id ?? null,
    name: user?.profile?.fullName ?? "",
    university: user?.university ?? null,
    photo: await photoLink(user?.profile?.photoKey),
    phone: showPhone ? (user?.phone ?? null) : null,
  };
}

const messageSelect = {
  id: true,
  chatId: true,
  kind: true,
  senderId: true,
  body: true,
  systemCode: true,
  attachmentKey: true,
  refId: true,
  createdAt: true,
} as const satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

export async function messageView(message: MessageRow) {
  return {
    id: message.id,
    chatId: message.chatId,
    kind: message.kind,
    senderId: message.senderId,
    body: message.body,
    systemCode: message.systemCode,
    // A short-lived link, given only to participants (B2b decision 10)
    image:
      message.kind === "IMAGE" && message.attachmentKey
        ? await signPrivateFileUrl(message.attachmentKey, Date.now(), rules.chat.image.signedUrlLifetime)
        : null,
    // B4: an over-budget approval card, with its current state
    approval: message.kind === "APPROVAL" && message.refId ? await approvalCard(message.refId) : null,
    createdAt: message.createdAt,
  };
}

async function approvalCard(approvalId: string) {
  const approval = await prisma.foodBudgetApproval.findUnique({
    where: { id: approvalId },
    select: { id: true, amount: true, previousAmount: true, status: true, decidedAt: true, requestedById: true },
  });
  if (!approval) return null;
  return {
    id: approval.id,
    amount: Number(approval.amount),
    previousAmount: Number(approval.previousAmount),
    status: approval.status,
    decidedAt: approval.decidedAt,
    requestedById: approval.requestedById,
  };
}

export async function messageViewById(messageId: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: messageSelect });
  return message ? messageView(message) : null;
}

// --- Inbox

type InboxRow = { chatId: string; lastMessageAt: Date | null; unread: bigint | number };

// The user's chats, latest message first, each with its unread count.
export async function listInbox(userId: string, before?: Date) {
  const take = rules.chat.inboxPageSize;
  const rows = await prisma.$queryRaw<InboxRow[]>`
    SELECT c.id AS chatId, c.last_message_at AS lastMessageAt,
      (SELECT COUNT(*) FROM messages m
        WHERE m.chat_id = c.id
          AND (m.sender_id IS NULL OR m.sender_id <> ${userId})
          AND m.created_at > COALESCE(cr.last_read_at, '1970-01-01')) AS unread
    FROM chats c
    JOIN activities a ON a.id = c.activity_id
    LEFT JOIN chat_reads cr ON cr.chat_id = c.id AND cr.user_id = ${userId}
    WHERE (a.creator_id = ${userId} OR a.accepter_id = ${userId})
      AND (${before ?? null} IS NULL OR c.last_message_at < ${before ?? null})
    ORDER BY c.last_message_at DESC, c.id DESC
    LIMIT ${take}`;

  const chats = await prisma.chat.findMany({ where: { id: { in: rows.map((row) => row.chatId) } }, select: chatActivitySelect });
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const otherIds = chats.map((chat) => otherParticipant(chat, userId)).filter((id): id is string => !!id);
  const [users, blocks] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: otherIds } }, select: userCardSelect }),
    blockPairs(userId, otherIds),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));

  const items = await Promise.all(
    rows.map(async (row) => {
      const chat = byId.get(row.chatId)!;
      const otherId = otherParticipant(chat, userId);
      const last = await prisma.message.findFirst({
        where: { chatId: chat.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { kind: true, senderId: true, body: true, systemCode: true, createdAt: true },
      });
      const blocked = otherId ? blocks.has(otherId) : false;
      return {
        chatId: chat.id,
        activity: { id: chat.activity.id, type: chat.activity.type, status: chat.activity.status },
        otherUser: await userCard(otherId ? (usersById.get(otherId) ?? null) : null, false),
        lastMessage: last
          ? {
              kind: last.kind,
              senderId: last.senderId,
              systemCode: last.systemCode,
              // Images have no text; system messages show their code, not the private reason
              body: last.kind === "TEXT" ? (last.body ?? "").slice(0, rules.chat.previewLength) : null,
              createdAt: last.createdAt,
            }
          : null,
        unreadCount: Number(row.unread),
        readOnly: readOnlyReason(chat.activity.status, blocked),
      };
    }),
  );
  const next = rows.length === take ? rows[rows.length - 1].lastMessageAt : null;
  return { chats: items, nextBefore: next };
}

// Users among `otherIds` with a block either way.
async function blockPairs(userId: string, otherIds: string[]) {
  if (otherIds.length === 0) return new Set<string>();
  const rows = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: otherIds } },
        { blockedId: userId, blockerId: { in: otherIds } },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)));
}

// The Inbox tab badge: unread messages across all the user's chats.
export async function unreadTotal(userId: string) {
  const [row] = await prisma.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT COUNT(*) AS total
    FROM messages m
    JOIN chats c ON c.id = m.chat_id
    JOIN activities a ON a.id = c.activity_id
    LEFT JOIN chat_reads cr ON cr.chat_id = c.id AND cr.user_id = ${userId}
    WHERE (a.creator_id = ${userId} OR a.accepter_id = ${userId})
      AND (m.sender_id IS NULL OR m.sender_id <> ${userId})
      AND m.created_at > COALESCE(cr.last_read_at, '1970-01-01')`;
  return Number(row?.total ?? 0);
}

// --- One chat

export async function getChat(userId: string, chatId: string) {
  const chat = await chatForParticipant(userId, chatId);
  const otherId = otherParticipant(chat, userId);
  const [other, blockedByMe, blocked] = await Promise.all([
    otherId ? prisma.user.findUnique({ where: { id: otherId }, select: userCardSelect }) : null,
    otherId ? prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: userId, blockedId: otherId } }, select: { blockerId: true } }) : null,
    otherId ? isBlockedBetween(prisma, userId, otherId) : false,
  ]);
  const readOnly = readOnlyReason(chat.activity.status, blocked);
  // Phone and Call only while the activity runs and nobody blocked the other.
  const showPhone = ACTIVE_STATUSES.includes(chat.activity.status) && !blocked;
  return {
    id: chat.id,
    activity: {
      id: chat.activity.id,
      type: chat.activity.type,
      status: chat.activity.status,
      subStatus: chat.activity.subStatus,
      startTime: chat.activity.startTime,
      role: chat.activity.creatorId === userId ? ("CREATOR" as const) : ("ACCEPTER" as const),
    },
    otherUser: await userCard(other, showPhone),
    readOnly,
    blockedByMe: !!blockedByMe,
    canSendImages: chat.activity.type === "FOOD" && readOnly === null,
  };
}

// Messages, newest page first; `before` is the id of the oldest message shown.
export async function listMessages(userId: string, chatId: string, before?: string) {
  await chatForParticipant(userId, chatId);
  const take = rules.chat.messagesPageSize;
  let cursor: Prisma.MessageWhereInput = {};
  if (before) {
    const anchor = await prisma.message.findFirst({ where: { id: before, chatId }, select: { id: true, createdAt: true } });
    if (!anchor) throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields: { before: ["Unknown message"] } });
    cursor = { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] };
  }
  const rows = await prisma.message.findMany({
    where: { chatId, ...cursor },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: messageSelect,
  });
  const messages = await Promise.all(rows.reverse().map(messageView));
  return { messages, hasMore: rows.length === take };
}

// --- Sending

async function assertCanSendNow(userId: string) {
  // Re-read on every send (also over the socket): a suspension or ban applies at once.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true, suspendedFrom: true, suspendedUntil: true, restrictedUntil: true },
  });
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Log in to continue");
  assertCanAccess(effectiveAccountStatus(user));
}

// Checks, inside the sending transaction, that the chat still accepts
// messages. The activity row is read FOR SHARE, so a status change (or a
// block, which cancels the activity) waits for this send or happens first.
async function assertChatOpen(tx: Tx, chat: ChatWithActivity, userId: string) {
  const [row] = await tx.$queryRaw<{ status: ActivityStatus }[]>`
    SELECT status FROM activities WHERE id = ${chat.activity.id} FOR SHARE`;
  const otherId = otherParticipant(chat, userId);
  if (otherId && (await isBlockedBetween(tx, userId, otherId))) {
    throw new AppError(403, "CHAT_BLOCKED", "You cannot send messages in this chat");
  }
  if (readOnlyReason(row.status, false)) {
    throw new AppError(409, "CHAT_READ_ONLY", "This chat is closed because the activity has ended");
  }
}

async function insertMessage(tx: Tx, chatId: string, data: Omit<Prisma.MessageUncheckedCreateInput, "chatId">) {
  const message = await tx.message.create({ data: { chatId, ...data }, select: messageSelect });
  await tx.chat.update({ where: { id: chatId }, data: { lastMessageAt: message.createdAt } });
  return message;
}

export async function sendTextMessage(userId: string, chatId: string, rawBody: unknown) {
  await assertCanSendNow(userId);
  const body = sanitizeMessageText(rawBody);
  const chat = await chatForParticipant(userId, chatId);

  const message = await prisma.$transaction(async (tx) => {
    await assertChatOpen(tx, chat, userId);
    // Counted only for messages that would be sent
    consumeChatSend(userId);
    return insertMessage(tx, chat.id, { senderId: userId, kind: "TEXT", body });
  });

  publishChatEvents([{ kind: "message", chatId: chat.id, messageId: message.id, participantIds: participants(chat) }]);
  return messageView(message);
}

// Food chats only: receipt and bill photos (proposal 10.3, B2b decision 10).
// The upload middleware has checked JPG/PNG, 5 MB and the file's first bytes;
// re-encoding drops EXIF data (a phone's GPS position) and proves it is an image.
export async function sendImageMessage(userId: string, chatId: string, file: Uint8Array) {
  await assertCanSendNow(userId);
  const chat = await chatForParticipant(userId, chatId);
  if (chat.activity.type !== "FOOD") {
    throw new AppError(403, "CHAT_IMAGES_NOT_ALLOWED", "Images can be sent only in food delivery chats");
  }
  // Fail early, before the image is processed; checked again in the transaction.
  await prisma.$transaction((tx) => assertChatOpen(tx, chat, userId));

  const key = await putPrivateFile("chat-images", await encodeChatImage(file), "image/jpeg");

  let message: MessageRow;
  try {
    message = await prisma.$transaction(async (tx) => {
      await assertChatOpen(tx, chat, userId);
      consumeChatSend(userId);
      return insertMessage(tx, chat.id, { senderId: userId, kind: "IMAGE", attachmentKey: key, attachmentMimeType: "image/jpeg" });
    });
  } catch (error) {
    await deletePrivateFile(key);
    throw error;
  }

  publishChatEvents([{ kind: "message", chatId: chat.id, messageId: message.id, participantIds: participants(chat) }]);
  return messageView(message);
}

// Re-encodes a food chat photo (a chat image or a B4 receipt): at most
// 1600 px, JPEG, no EXIF. Proves the file is an image.
export async function encodeChatImage(file: Uint8Array) {
  const { maxSidePx, jpegQuality } = rules.chat.image;
  try {
    return await sharp(file, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize(maxSidePx, maxSidePx, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new AppError(415, "IMAGE_UNREADABLE", "This image could not be read. Try another photo");
  }
}

// --- Reading

// Marks the chat read up to a message (default: the latest). Never moves back.
export async function markChatRead(userId: string, chatId: string, upTo?: string) {
  const chat = await chatForParticipant(userId, chatId);
  const message = await prisma.message.findFirst({
    where: upTo ? { id: upTo, chatId } : { chatId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  if (!message) {
    if (upTo) throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields: { upTo: ["Unknown message"] } });
    return { unreadTotal: await unreadTotal(userId) };
  }
  await prisma.$executeRaw`
    INSERT INTO chat_reads (chat_id, user_id, last_read_at, created_at, updated_at)
    VALUES (${chat.id}, ${userId}, ${message.createdAt}, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE last_read_at = GREATEST(last_read_at, VALUES(last_read_at)), updated_at = NOW(3)`;
  publishChatEvents([{ kind: "read", chatId: chat.id, userId }]);
  return { unreadTotal: await unreadTotal(userId) };
}

// For the socket layer: the user may join this chat's room.
export async function assertChatParticipant(userId: string, chatId: string) {
  await chatForParticipant(userId, chatId);
}

// Post a system-generated message into a chat (e.g., dispute raised, resolved).
// Used by disputes and other server-side events that need to notify chat participants.
export async function postSystemMessage(
  chatId: string,
  data: { code: string; text: string; metadata?: Record<string, unknown> },
) {
  return prisma.$transaction(async (tx) => {
    return insertMessage(tx, chatId, {
      senderId: null,
      kind: "SYSTEM",
      body: data.text,
      systemCode: data.code,
    });
  });
}
