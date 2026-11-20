import { z } from "zod";
import { rules } from "../../config/rules.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { isBlockedBetween } from "../users/blocks.service.js";

// Live location during a ride. A participant turns sharing on for one
// activity; each position goes over the socket to the other participant's
// tabs only. Nothing is stored, logged or sent to anyone else. Allowed while
// the ride is ACCEPTED (on the way to the pickup) or IN_PROGRESS, between the
// two participants, when neither has blocked the other.

export const locationSchema = z.object({
  activityId: z.string().trim().min(1).max(64),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  speed: z.number().min(0).max(200).nullable().optional(),
});
export const stopSchema = z.object({ activityId: z.string().trim().min(1).max(64) });

export type LocationUpdate = z.infer<typeof locationSchema> & { userId: string; at: string };

// The other participant, when the user may share their location on this activity.
export async function liveLocationPeer(userId: string, activityId: string): Promise<string> {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, deletedAt: null },
    select: { type: true, status: true, creatorId: true, accepterId: true },
  });
  const isParticipant = activity && (activity.creatorId === userId || activity.accepterId === userId);
  if (!activity || !isParticipant || !activity.accepterId) throw new AppError(404, "NOT_FOUND", "Not found");
  const typeAllowed = (rules.liveLocation.types as readonly string[]).includes(activity.type);
  const statusAllowed = (rules.liveLocation.statuses as readonly string[]).includes(activity.status);
  if (!typeAllowed || !statusAllowed) {
    throw new AppError(409, "LIVE_LOCATION_NOT_AVAILABLE", "Live location is only for an accepted or started ride");
  }
  const peer = activity.creatorId === userId ? activity.accepterId : activity.creatorId;
  if (await isBlockedBetween(prisma, userId, peer)) throw new AppError(409, "NOT_AVAILABLE", "Not available");
  return peer;
}

// Per socket: remembers recent checks and drops updates that come too fast.
export function createLiveLocationGate(userId: string, now: () => number = Date.now) {
  const access = new Map<string, { peer: string; until: number }>();
  const lastSent = new Map<string, number>();

  return {
    async peer(activityId: string) {
      const cached = access.get(activityId);
      if (cached && cached.until > now()) return cached.peer;
      const peer = await liveLocationPeer(userId, activityId);
      access.set(activityId, { peer, until: now() + rules.liveLocation.accessCacheTtl });
      return peer;
    },
    // False when the previous update for this activity was too recent.
    take(activityId: string) {
      const last = lastSent.get(activityId) ?? 0;
      if (now() - last < rules.liveLocation.minInterval) return false;
      lastSent.set(activityId, now());
      return true;
    },
    forget(activityId: string) {
      access.delete(activityId);
      lastSent.delete(activityId);
    },
  };
}
