import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

// Profile stats and badges (proposal 15.2, B3b-2). One place for profiles,
// ride cards, detail pages and the Rider Dashboard, computed from the common
// activities table, so Food, Service and Carpool sessions count as soon as
// they exist. Thresholds are in rules.stats.
//
// User profile definitions (B3b-2 Q2; the platform KPI in proposal 22.1
// keeps completed ÷ accepted):
// - accepted = activities the user took part in after acceptance that have
//   finished as COMPLETED, or were CANCELLED by the user. NOT_MARKED, those
//   still running, and cancellations by the other user, the system or an
//   admin are left out;
// - completion rate = completed ÷ accepted;
// - late cancellation rate = the user's late cancellations ÷ accepted;
// - rating = average of published, not hidden reviews about the user.
// Below the minimum counts the value is null, shown as "New".

export type Badge = "VERIFIED_STUDENT" | "VERIFIED_RIDER" | "TOP_RATED" | "RELIABLE";

export type UserStats = {
  rating: number | null;
  reviewCount: number;
  completed: number;
  cancellations: number;
  accepted: number;
  completionRate: number | null;
  lateCancellationRate: number | null;
  lateCancellationWarning: boolean;
  badges: Badge[];
};

type Counts = { completed: number; cancelled: number; late: number };

// Carpool bookings never count: their sessions do (B6).
const COUNTED_TYPES = ["RIDE_REQUEST", "RIDE_BOOKING", "FOOD", "SERVICE", "CARPOOL_SESSION"];

async function activityCounts(userIds: readonly string[], types: readonly string[] = COUNTED_TYPES, side?: { role: "creator" | "accepter"; types: string[] }[]) {
  const result = new Map<string, Counts>();
  if (userIds.length === 0) return result;
  const ids = Prisma.join([...userIds]);
  const parts = side ?? [
    { role: "creator" as const, types: [...types] },
    { role: "accepter" as const, types: [...types] },
  ];
  const selects = parts.map(({ role, types: t }) => {
    const column = Prisma.raw(role === "creator" ? "creator_id" : "accepter_id");
    return Prisma.sql`
      SELECT ${column} AS user_id, status, cancelled_by_id, is_late_cancellation
      FROM activities
      WHERE ${column} IN (${ids}) AND accepter_id IS NOT NULL AND accepted_at IS NOT NULL AND deleted_at IS NULL
        AND type IN (${Prisma.join(t)}) AND status IN ('COMPLETED', 'CANCELLED')`;
  });
  const rows = await prisma.$queryRaw<{ userId: string; completed: bigint | number; cancelled: bigint | number; late: bigint | number }[]>`
    SELECT x.user_id AS userId,
      SUM(x.status = 'COMPLETED') AS completed,
      SUM(x.status = 'CANCELLED' AND x.cancelled_by_id = x.user_id) AS cancelled,
      SUM(x.status = 'CANCELLED' AND x.cancelled_by_id = x.user_id AND x.is_late_cancellation) AS late
    FROM (${Prisma.join(selects, " UNION ALL ")}) x
    GROUP BY x.user_id`;
  for (const row of rows) result.set(row.userId, { completed: Number(row.completed ?? 0), cancelled: Number(row.cancelled ?? 0), late: Number(row.late ?? 0) });
  return result;
}

async function ratings(userIds: readonly string[]) {
  if (userIds.length === 0) return new Map<string, { avg: number; count: number }>();
  const rows = await prisma.review.groupBy({
    by: ["revieweeId"],
    where: { revieweeId: { in: [...userIds] }, publishedAt: { not: null }, hiddenAt: null },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.revieweeId, { avg: row._avg.rating ?? 0, count: row._count._all }]));
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

// Rates from counts, with the "New" rule and the badges.
export function computeStats(counts: Counts, rating: { avg: number; count: number } | undefined, flags: { verifiedStudent: boolean; verifiedRider: boolean }): UserStats {
  const s = rules.stats;
  const accepted = counts.completed + counts.cancelled;
  const enough = accepted >= s.minAcceptedForRates;
  const completionRate = enough ? round(counts.completed / accepted, 4) : null;
  const lateCancellationRate = enough ? round(counts.late / accepted, 4) : null;
  const reviewCount = rating?.count ?? 0;
  const average = rating && reviewCount >= s.minReviewsForRating ? round(rating.avg, 2) : null;

  const badges: Badge[] = [];
  if (flags.verifiedStudent) badges.push("VERIFIED_STUDENT");
  if (flags.verifiedRider) badges.push("VERIFIED_RIDER");
  if (rating && reviewCount >= s.topRated.minReviews && rating.avg >= s.topRated.minRating) badges.push("TOP_RATED");
  if (
    accepted >= s.reliable.minAccepted &&
    counts.completed / accepted >= s.reliable.minCompletionRate &&
    counts.late / accepted < s.reliable.maxLateCancellationRate
  ) {
    badges.push("RELIABLE");
  }
  return {
    rating: average,
    reviewCount,
    completed: counts.completed,
    cancellations: counts.cancelled,
    accepted,
    completionRate,
    lateCancellationRate,
    lateCancellationWarning: lateCancellationRate !== null && lateCancellationRate >= s.lateCancellationWarning,
    badges,
  };
}

// Stats for many users at once (ride lists use one call per page).
export async function statsFor(userIds: readonly string[]) {
  const ids = [...new Set(userIds)];
  const [counts, reviews, users] = await Promise.all([
    activityCounts(ids),
    ratings(ids),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, studentVerificationStatus: true, isVerifiedRider: true } }),
  ]);
  const result = new Map<string, UserStats>();
  for (const user of users) {
    result.set(
      user.id,
      computeStats(counts.get(user.id) ?? { completed: 0, cancelled: 0, late: 0 }, reviews.get(user.id), {
        verifiedStudent: user.studentVerificationStatus === "VERIFIED",
        verifiedRider: user.isVerifiedRider,
      }),
    );
  }
  return result;
}

export async function userStats(userId: string) {
  return (await statsFor([userId])).get(userId)!;
}

// The rider's side of rides only (Rider Dashboard): requests they accepted and
// bookings on their offers.
export async function riderRideCounts(riderId: string) {
  return (
    (
      await activityCounts([riderId], [], [
        { role: "accepter", types: ["RIDE_REQUEST"] },
        { role: "creator", types: ["RIDE_BOOKING"] },
      ])
    ).get(riderId) ?? { completed: 0, cancelled: 0, late: 0 }
  );
}

// --- Mini profiles in API answers

type MiniProfile = { id: string; rating: number | null; completionRate: number | null; badges: string[]; isVerifiedRider?: boolean; ratingCount?: number };

function isMiniProfile(value: unknown): value is MiniProfile {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "rating" in value &&
    "completionRate" in value &&
    "badges" in value &&
    "isVerifiedRider" in value &&
    Array.isArray((value as MiniProfile).badges)
  );
}

// Fills rating, completion rate and badges into every mini profile
// (ride.views miniProfile) inside an answer, in one batch.
export async function fillPersonStats<T>(value: T): Promise<T> {
  const found: MiniProfile[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object" && !(node instanceof Date)) {
      if (isMiniProfile(node)) found.push(node);
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  if (found.length === 0) return value;
  const stats = await statsFor(found.map((p) => p.id));
  for (const person of found) {
    const s = stats.get(person.id);
    if (!s) continue;
    person.rating = s.rating;
    person.ratingCount = s.reviewCount;
    person.completionRate = s.completionRate;
    person.badges = s.badges;
  }
  return value;
}
