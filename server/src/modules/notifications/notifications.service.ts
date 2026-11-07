import { rules } from "../../config/rules.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { announceUnread, notificationSelect, notificationView, syncPushEnabled, unreadNotificationCount } from "./notify.service.js";

// The Notifications page and the bell (proposal section 14): in-app rows
// only, newest first, text in the user's saved language.

export async function listNotifications(userId: string, before?: string) {
  const take = rules.notifications.pageSize;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { language: true } });
  const cursor = before
    ? await prisma.notification.findFirst({ where: { id: before, userId, channel: "IN_APP" }, select: { id: true } })
    : null;
  if (before && !cursor) throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields: { before: ["Unknown notification"] } });

  const rows = await prisma.notification.findMany({
    where: { userId, channel: "IN_APP" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor && { cursor: { id: cursor.id }, skip: 1 }),
    take: take + 1,
    select: notificationSelect,
  });
  const page = rows.slice(0, take);
  return {
    notifications: await Promise.all(page.map((row) => notificationView(row, user.language))),
    nextCursor: rows.length > take ? page[page.length - 1]!.id : null,
    unreadCount: await unreadNotificationCount(userId),
  };
}

export async function unreadCount(userId: string) {
  return { unreadCount: await unreadNotificationCount(userId) };
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const row = await prisma.notification.findFirst({ where: { id: notificationId, userId, channel: "IN_APP" }, select: { id: true } });
  if (!row) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "This notification was not found");
  await prisma.notification.updateMany({ where: { id: row.id, readAt: null }, data: { readAt: new Date() } });
  await announceUnread(userId);
  return unreadCount(userId);
}

export async function markAllNotificationsRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, channel: "IN_APP", readAt: null }, data: { readAt: new Date() } });
  await announceUnread(userId);
  return unreadCount(userId);
}

// --- Web Push subscriptions: one per device (the endpoint is unique)

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

// Saves this device for the user. A device that was subscribed for another
// account (shared computer) moves to this one.
export async function savePushSubscription(userId: string, input: SubscriptionInput, userAgent: string | undefined) {
  const previous = await prisma.pushSubscription.findUnique({ where: { endpoint: input.endpoint }, select: { userId: true } });
  const values = { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 255) ?? null };
  await prisma.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...values }, update: values });
  await syncPushEnabled(userId);
  if (previous && previous.userId !== userId) await syncPushEnabled(previous.userId);
  return { pushEnabled: true };
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  await syncPushEnabled(userId);
  const count = await prisma.pushSubscription.count({ where: { userId } });
  return { pushEnabled: count > 0 };
}

// Log out of all devices, password reset and password change end the other
// devices' sessions, so they stop receiving pushes too. This device
// subscribes again after a password change (the client re-saves it).
export async function removeAllPushSubscriptions(userId: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId } });
  await prisma.user.updateMany({ where: { id: userId }, data: { pushEnabled: false } });
}
