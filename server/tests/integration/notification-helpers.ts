import { randomUUID } from "node:crypto";
import type { NotificationType } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/lib/prisma.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";

// Notifications are written after the change commits, in the background.
export const settle = settleBackgroundTasks;

// A browser on this device subscribed to Web Push for the user.
export async function subscribeDevice(userId: string) {
  return prisma.pushSubscription.create({
    data: { userId, endpoint: `https://push.example.test/${randomUUID()}`, p256dh: "BPublicKey", auth: "authSecret" },
  });
}

export async function rowsOf(userId: string, type?: NotificationType) {
  return prisma.notification.findMany({ where: { userId, ...(type && { type }) }, orderBy: [{ createdAt: "asc" }, { channel: "asc" }] });
}

// The channels the user got this type on, sorted.
export async function channelsOf(userId: string, type: NotificationType) {
  return (await rowsOf(userId, type)).map((row) => row.channel).sort();
}

export const sorted = (channels: readonly string[]) => [...channels].sort();
