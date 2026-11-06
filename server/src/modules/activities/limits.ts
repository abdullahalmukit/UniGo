import { rules } from "../../config/rules.js";
import { AppError } from "../../utils/app-error.js";
import { startOfDhakaDay } from "../../utils/time.js";
import { lockUsers, type Tx } from "./transaction.js";
import { OPEN_REQUEST_TYPES } from "./transitions.js";

// Open and daily creation limits (proposal 15.5, A2 decision 10, B2a decision 8).
// They cover passenger requests, ride offers, food and service requests.
// Carpool posts and bookings are excluded: carpool bookings are filtered out
// by type, because their creator is the rider.
//
// Call inside the creation transaction (runActivityTransaction). The creator's
// row is locked first, so two creations sent together cannot both pass.
export async function assertCreationLimits(tx: Tx, userId: string, now = new Date()) {
  await lockUsers(tx, [userId]);

  // OPEN only: a FULL ride offer does not count (B2a decision 8). Deleted
  // requests are CANCELLED, so they do not count either.
  const [openActivities, openOffers] = await Promise.all([
    tx.activity.count({ where: { creatorId: userId, type: { in: [...OPEN_REQUEST_TYPES] }, status: "OPEN", deletedAt: null } }),
    tx.rideOffer.count({ where: { riderId: userId, status: "OPEN" } }),
  ]);
  if (openActivities + openOffers >= rules.limits.maxOpenRequestsPerUser) {
    throw new AppError(409, "OPEN_LIMIT_REACHED", "You already have the most open requests allowed", {
      data: { max: rules.limits.maxOpenRequestsPerUser },
    });
  }

  // Since midnight Asia/Dhaka (18:00 UTC), deleted items included.
  const since = startOfDhakaDay(now);
  const [todayActivities, todayOffers] = await Promise.all([
    tx.activity.count({ where: { creatorId: userId, type: { in: [...OPEN_REQUEST_TYPES] }, createdAt: { gte: since } } }),
    tx.rideOffer.count({ where: { riderId: userId, createdAt: { gte: since } } }),
  ]);
  if (todayActivities + todayOffers >= rules.limits.maxNewRequestsPerDay) {
    throw new AppError(409, "DAILY_LIMIT_REACHED", "You have created the most requests allowed today", {
      data: { max: rules.limits.maxNewRequestsPerDay },
    });
  }
}
