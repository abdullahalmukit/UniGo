import { rules } from "../../config/rules.js";
import type { NotificationChannel, NotificationDeliveryStatus, NotificationType, Prisma } from "../../generated/prisma/client.js";
import { jobsDriver, queueJob } from "../../jobs/scheduler.js";
import { prisma } from "../../lib/prisma.js";
import { emitToUser } from "../../sockets/registry.js";
import { runInBackground } from "../../utils/background.js";
import { accountStatusSelect, effectiveAccountStatus } from "../auth/account-status.js";
import { sendEmail, type EmailMessage } from "../email/email.service.js";
import { CATALOGUE, type NotificationData } from "./catalogue.js";
import { notificationLink } from "./link.js";
import { pushAvailable, sendPush, type PushPayload } from "./push.transport.js";
import { renderEmail, renderPush, renderText } from "./templates.js";

// Sending notifications (proposal section 14, B2c decisions).
// notify() writes one row per recipient per channel of the catalogue entry.
// The row is unique on (user, channel, dedupe key), so the same event never
// notifies anyone twice on a channel. In-app rows are delivered by being
// stored (and pushed to open tabs over Socket.IO); push and email rows are
// sent by the notification-deliver job, with retries, or directly when Redis
// is unavailable.

export type NotifyInput = {
  type: NotificationType;
  userIds: readonly (string | null | undefined)[];
  // The event. With the user and the channel it identifies the row.
  dedupeKey: string;
  activityId?: string | null;
  data?: NotificationData;
  // Per recipient values (e.g. the name of the *other* participant)
  dataFor?: (userId: string) => NotificationData;
  // Only these channels of the catalogue entry
  only?: readonly NotificationChannel[];
};

type NewRow = Prisma.NotificationCreateManyInput & { userId: string; channel: NotificationChannel };

// Returns the rows created now (none when they all existed already).
export async function notify(input: NotifyInput) {
  const entry = CATALOGUE[input.type];
  const channels = entry.channels.filter((channel) => !input.only || input.only.includes(channel));
  const userIds = [...new Set(input.userIds.filter((id): id is string => !!id))];
  if (userIds.length === 0 || channels.length === 0) return [];
  const now = new Date();

  const [users, existing] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, emailNotificationsEnabled: true, ...accountStatusSelect, _count: { select: { pushSubscriptions: true } } },
    }),
    prisma.notification.findMany({
      where: { userId: { in: userIds }, dedupeKey: input.dedupeKey, channel: { in: [...channels] } },
      select: { userId: true, channel: true },
    }),
  ]);
  const have = new Set(existing.map((row) => `${row.userId}:${row.channel}`));

  const rows: NewRow[] = [];
  for (const user of users) {
    const data = { ...input.data, ...input.dataFor?.(user.id) } as Prisma.InputJsonValue;
    for (const channel of channels) {
      if (have.has(`${user.id}:${channel}`)) continue;
      const { status, failureReason } = initialStatus(channel, input.type, user, now);
      rows.push({
        userId: user.id,
        type: input.type,
        channel,
        status,
        failureReason,
        activityId: input.activityId ?? null,
        data,
        dedupeKey: input.dedupeKey,
        sentAt: status === "SENT" ? now : null,
      });
    }
  }
  if (rows.length === 0) return [];

  await prisma.notification.createMany({ data: rows, skipDuplicates: true });
  // The rows that did not exist before this call (read back for their ids).
  const created = await prisma.notification.findMany({
    where: { dedupeKey: input.dedupeKey, userId: { in: [...new Set(rows.map((r) => r.userId))] }, channel: { in: [...channels] } },
    select: notificationSelect,
  });
  const wanted = new Set(rows.map((row) => `${row.userId}:${row.channel}`));
  const fresh = created.filter((row) => wanted.has(`${row.userId}:${row.channel}`));

  await announce(fresh.filter((row) => row.channel === "IN_APP"));
  for (const row of fresh) if (row.status === "PENDING") await enqueueDelivery(row.id);
  return fresh;
}

function initialStatus(
  channel: NotificationChannel,
  type: NotificationType,
  user: Parameters<typeof effectiveAccountStatus>[0] & { emailNotificationsEnabled: boolean; _count: { pushSubscriptions: number } },
  now: Date,
): { status: NotificationDeliveryStatus; failureReason: string | null } {
  if (channel === "IN_APP") return { status: "SENT", failureReason: null };
  if (channel === "EMAIL") {
    // The email switch covers activity emails only (A7 decision 6)
    if (CATALOGUE[type].email === "ACTIVITY" && !user.emailNotificationsEnabled) return { status: "SKIPPED", failureReason: "EMAIL_OFF" };
    return { status: "PENDING", failureReason: null };
  }
  if (!pushAvailable()) return { status: "SKIPPED", failureReason: "PUSH_OFF" };
  // A suspended or banned account cannot open the app a push leads to
  const status = effectiveAccountStatus(user, now);
  if (status === "SUSPENDED" || status === "BANNED") return { status: "SKIPPED", failureReason: "ACCOUNT_LOCKED" };
  if (user._count.pushSubscriptions === 0) return { status: "SKIPPED", failureReason: "NO_SUBSCRIPTION" };
  return { status: "PENDING", failureReason: null };
}

export const notificationSelect = {
  id: true,
  userId: true,
  type: true,
  channel: true,
  status: true,
  activityId: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

// --- In-app

// The Notifications page and the bell. Text in the user's saved language.
export async function notificationView(row: NotificationRow, language: "BN" | "EN") {
  const data = (row.data ?? {}) as NotificationData;
  const text = renderText(row.type, data, language);
  return {
    id: row.id,
    type: row.type,
    title: text.title,
    body: text.body,
    link: notificationLink(row.type, data, row.activityId),
    read: row.readAt !== null,
    createdAt: row.createdAt,
  };
}

export function unreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, channel: "IN_APP", readAt: null } });
}

// New in-app rows to the user's open tabs, with the new unread count.
export async function announce(rows: readonly NotificationRow[]) {
  const byUser = new Map<string, NotificationRow[]>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  for (const [userId, list] of byUser) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
      const unreadCount = await unreadNotificationCount(userId);
      for (const row of list) emitToUser(userId, "notification:new", { notification: await notificationView(row, user?.language ?? "EN"), unreadCount });
    } catch (error) {
      console.error(`Could not announce a notification: ${message(error)}`);
    }
  }
}

export async function announceUnread(userId: string) {
  emitToUser(userId, "notification:unread", { unreadCount: await unreadNotificationCount(userId) });
}

// --- Push and email delivery

// Tests: send through the job (recorded in memory) instead of directly.
let queueInTests = false;
export function useDeliveryQueueForTests(on: boolean) {
  queueInTests = on;
}

export const deliveryJobId = (notificationId: string) => `notification-deliver-${notificationId}`;

// Queues the delivery job (3 attempts with backoff). When Redis is
// unavailable the job is not queued and the row is sent directly, once, in
// the background (B2c decision; same idea as B2b decision 1). The sweeper
// sends rows still PENDING later.
export async function enqueueDelivery(notificationId: string) {
  const direct = () => runInBackground("notification delivery", () => deliverNotification(notificationId, { lastAttempt: true }));
  if (jobsDriver() === "memory" && !queueInTests) {
    direct();
    return;
  }
  const queued = await queueJob({
    name: "notification-deliver",
    jobId: deliveryJobId(notificationId),
    runAt: new Date(),
    data: { id: notificationId },
    attempts: rules.notifications.delivery.attempts,
    backoffMs: rules.notifications.delivery.backoffMs,
  });
  if (!queued) direct();
}

// Sends one PENDING push or email row and records SENT, SKIPPED or FAILED.
// A failure that will be retried leaves the row PENDING and throws, so the
// job tries again; the last attempt records FAILED. Idempotent: a row that
// is no longer PENDING is not sent again.
export async function deliverNotification(notificationId: string, options: { lastAttempt: boolean }) {
  const row = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      ...notificationSelect,
      user: {
        select: {
          email: true,
          language: true,
          profile: { select: { fullName: true } },
          pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } },
        },
      },
    },
  });
  if (!row || row.status !== "PENDING" || row.channel === "IN_APP") return false;
  const data = (row.data ?? {}) as NotificationData;
  const link = notificationLink(row.type, data, row.activityId);

  try {
    if (row.channel === "EMAIL") {
      await sendEmail({ to: row.user.email, ...renderEmail(row.type, data, row.user.language, row.user.profile?.fullName ?? "", link) });
      return finish(row.id, "SENT", null);
    }
    const sent = await pushToDevices(row.userId, row.user.pushSubscriptions, {
      ...renderPush(row.type, data, row.user.language, rules.notifications.textMaxLength),
      url: link,
      tag: row.type === "NEW_CHAT_MESSAGE" && data.chatId ? `chat-${data.chatId}` : `n-${row.id}`,
      renotify: row.type === "NEW_CHAT_MESSAGE" ? data.renotify === true : false,
      notificationId: row.id,
    });
    return finish(row.id, sent ? "SENT" : "SKIPPED", sent ? null : "NO_SUBSCRIPTION");
  } catch (error) {
    if (options.lastAttempt) return finish(row.id, "FAILED", message(error));
    await prisma.notification.updateMany({ where: { id: row.id, status: "PENDING" }, data: { failureReason: message(error).slice(0, 255) } });
    throw error;
  }
}

async function finish(id: string, status: NotificationDeliveryStatus, reason: string | null) {
  const updated = await prisma.notification.updateMany({
    where: { id, status: "PENDING" },
    data: { status, failureReason: reason?.slice(0, 255) ?? null, sentAt: status === "SENT" ? new Date() : null },
  });
  return updated.count === 1;
}

// Every device of the user. A subscription the push service no longer knows
// (404 or 410) is deleted. True when at least one device got it; throws when
// none did and at least one failed for another reason (retried).
async function pushToDevices(
  userId: string,
  subscriptions: readonly { id: string; endpoint: string; p256dh: string; auth: string }[],
  payload: PushPayload,
) {
  let sent = 0;
  let failure: unknown = null;
  const gone: string[] = [];
  for (const subscription of subscriptions) {
    try {
      const result = await sendPush(subscription, payload);
      if (result === "GONE") gone.push(subscription.id);
      else sent += 1;
    } catch (error) {
      failure = error;
    }
  }
  if (sent > 0) {
    await prisma.pushSubscription.updateMany({
      where: { id: { in: subscriptions.filter((s) => !gone.includes(s.id)).map((s) => s.id) } },
      data: { lastUsedAt: new Date() },
    });
  }
  if (gone.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    await syncPushEnabled(userId);
  }
  if (sent === 0 && failure) throw failure;
  return sent > 0;
}

// users.push_enabled: true while the account has at least one device subscribed.
export async function syncPushEnabled(userId: string) {
  const count = await prisma.pushSubscription.count({ where: { userId } });
  await prisma.user.updateMany({ where: { id: userId }, data: { pushEnabled: count > 0 } });
}

// The password reset email carries a single-use link that must never be
// stored, so it is sent at once with the given content (not by the job) and
// only its outcome is recorded. Throws when sending fails, as before (A4).
export async function notifyWithDirectEmail(input: { type: NotificationType; userId: string; dedupeKey: string; email: EmailMessage }) {
  await prisma.notification.createMany({
    data: [{ userId: input.userId, type: input.type, channel: "EMAIL", status: "PENDING", dedupeKey: input.dedupeKey, data: {} }],
    skipDuplicates: true,
  });
  const where = { userId_channel_dedupeKey: { userId: input.userId, channel: "EMAIL" as const, dedupeKey: input.dedupeKey } };
  const row = await prisma.notification.findUnique({ where, select: { id: true, status: true } });
  if (!row || row.status !== "PENDING") return;
  try {
    await sendEmail(input.email);
    await finish(row.id, "SENT", null);
  } catch (error) {
    await finish(row.id, "FAILED", message(error));
    throw error;
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
