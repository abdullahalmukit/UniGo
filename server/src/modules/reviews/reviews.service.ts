import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../admin/audit-log.js";
import { notify } from "../notifications/notify.service.js";
import { photoLink } from "../users/photo.js";

// Blind reviews (proposal 15.1, B3b-2). Each participant of a COMPLETED
// activity (for a ride offer: each booking, so the rider reviews every
// passenger) gives 1-5 stars and an optional comment, once, within 7 days of
// completion; no edit or delete. A review stays hidden from both until both
// have reviewed or the 7 days end; then both are published together.
// Admins can hide a review (reason, audited); hidden reviews leave every user
// view and every average. Works for every feature through the activities table.

const ERRORS = {
  notAllowed: () => new AppError(409, "REVIEW_NOT_ALLOWED", "Only completed activities can be reviewed"),
  closed: () => new AppError(409, "REVIEW_WINDOW_CLOSED", "The 7 days to leave a review have ended"),
  twice: () => new AppError(409, "ALREADY_REVIEWED", "You have already reviewed this"),
  notFound: () => new AppError(404, "ACTIVITY_NOT_FOUND", "This activity was not found"),
};

const windowEnds = (completedAt: Date) => new Date(completedAt.getTime() + rules.reviews.window);

async function participantActivity(userId: string, activityId: string) {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId },
    select: { id: true, type: true, status: true, completedAt: true, creatorId: true, accepterId: true },
  });
  if (!activity || (activity.creatorId !== userId && activity.accepterId !== userId)) throw ERRORS.notFound();
  return activity;
}

export async function submitReview(userId: string, activityId: string, input: { rating: number; comment?: string | null }, now = new Date()) {
  const activity = await participantActivity(userId, activityId);
  if (activity.status !== "COMPLETED" || !activity.completedAt || !activity.accepterId) throw ERRORS.notAllowed();
  if (now >= windowEnds(activity.completedAt)) throw ERRORS.closed();
  const revieweeId = userId === activity.creatorId ? activity.accepterId : activity.creatorId;
  try {
    await prisma.review.create({
      data: { activityId, reviewerId: userId, revieweeId, rating: input.rating, comment: input.comment?.trim() || null },
    });
  } catch (error) {
    // One review per user per activity (unique activity_id + reviewer_id)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw ERRORS.twice();
    throw error;
  }
  // The second review publishes both at once
  await publishReviews(activityId, now);
  return getActivityReviews(userId, activityId, now);
}

// Publishes the activity's reviews when both participants have reviewed or
// the 7 days have ended. Conditional on published_at being empty, so running
// it twice (job and sweeper) publishes nothing twice. Returns how many.
export async function publishReviews(activityId: string, now = new Date()) {
  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { status: true, completedAt: true, type: true } });
  if (!activity || activity.status !== "COMPLETED" || !activity.completedAt) return 0;
  const reviews = await prisma.review.findMany({ where: { activityId }, select: { id: true, publishedAt: true, revieweeId: true, reviewer: { select: { profile: { select: { fullName: true } } } } } });
  const due = reviews.length >= 2 || now >= windowEnds(activity.completedAt);
  const pending = reviews.filter((r) => !r.publishedAt);
  if (!due || pending.length === 0) return 0;

  let published = 0;
  for (const review of pending) {
    const updated = await prisma.review.updateMany({ where: { id: review.id, publishedAt: null }, data: { publishedAt: now } });
    if (updated.count === 0) continue;
    published += 1;
    // B3b-2 Q1: in-app only
    await notify({
      type: "REVIEW_PUBLISHED",
      userIds: [review.revieweeId],
      dedupeKey: `REVIEW_PUBLISHED:${review.id}`,
      activityId,
      data: { activityType: activity.type, name: review.reviewer.profile?.fullName, userId: review.revieweeId },
    });
  }
  return published;
}

// For the sweeper: activities whose review window ended with reviews unpublished.
export async function publishOverdueReviews(now = new Date()) {
  const rows = await prisma.activity.findMany({
    where: { status: "COMPLETED", completedAt: { lte: new Date(now.getTime() - rules.reviews.window) }, reviews: { some: { publishedAt: null } } },
    select: { id: true },
    take: rules.jobs.sweepBatch,
  });
  let published = 0;
  for (const { id } of rows) published += await publishReviews(id, now);
  return published;
}

const reviewSelect = {
  id: true,
  rating: true,
  comment: true,
  publishedAt: true,
  hiddenAt: true,
  createdAt: true,
  reviewerId: true,
  reviewer: { select: { id: true, profile: { select: { fullName: true, photoKey: true } } } },
  activity: { select: { type: true } },
} as const satisfies Prisma.ReviewSelect;

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof reviewSelect }>;

async function reviewView(row: ReviewRow) {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    activityType: row.activity.type,
    reviewer: { id: row.reviewer.id, name: row.reviewer.profile?.fullName ?? "", photo: await photoLink(row.reviewer.profile?.photoKey) },
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

// What a participant sees on the activity: their own review always; the
// other one only once published and not hidden.
export async function getActivityReviews(userId: string, activityId: string, now = new Date()) {
  const activity = await participantActivity(userId, activityId);
  const rows = await prisma.review.findMany({ where: { activityId }, select: reviewSelect });
  const mine = rows.find((r) => r.reviewerId === userId) ?? null;
  const theirs = rows.find((r) => r.reviewerId !== userId) ?? null;
  const closesAt = activity.completedAt ? windowEnds(activity.completedAt) : null;
  return {
    canReview: activity.status === "COMPLETED" && !mine && !!closesAt && now < closesAt,
    closesAt,
    mine: mine ? await reviewView(mine) : null,
    // Blind: the other review only after publishing, never a hidden one
    theirs: theirs && theirs.publishedAt && !theirs.hiddenAt ? await reviewView(theirs) : null,
    // Lets the screen say "waiting for the other review"
    otherSubmitted: !!theirs,
  };
}

// A user's published reviews (profile), newest first.
export async function listUserReviews(userId: string, page = 1) {
  const take = rules.reviews.pageSize;
  const where = { revieweeId: userId, publishedAt: { not: null }, hiddenAt: null };
  const [rows, total] = await Promise.all([
    prisma.review.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip: (page - 1) * take, take, select: reviewSelect }),
    prisma.review.count({ where }),
  ]);
  return { reviews: await Promise.all(rows.map(reviewView)), page, total, hasMore: page * take < total };
}

// Admin moderation: hide with a reason, audited.
export async function hideReview(adminId: string, reviewId: string, reason: string, ipAddress?: string, now = new Date()) {
  await prisma.$transaction(async (tx) => {
    const review = await tx.review.findUnique({ where: { id: reviewId }, select: { id: true, revieweeId: true, activityId: true, hiddenAt: true } });
    if (!review) throw new AppError(404, "REVIEW_NOT_FOUND", "This review was not found");
    const updated = await tx.review.updateMany({ where: { id: reviewId, hiddenAt: null }, data: { hiddenAt: now, hiddenById: adminId, hiddenReason: reason } });
    if (updated.count === 0) throw new AppError(409, "REVIEW_ALREADY_HIDDEN", "This review is already hidden");
    await recordAudit(tx, {
      adminId,
      action: "REVIEW_HIDDEN",
      targetType: "review",
      targetId: reviewId,
      targetUserId: review.revieweeId,
      oldValue: { hidden: false },
      newValue: { hidden: true, reason, activityId: review.activityId },
      ipAddress,
    });
  });
}
