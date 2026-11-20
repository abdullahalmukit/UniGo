import { rules } from "../../config/rules.js";
import type { ActivityStatus, CarpoolContractStatus, PostStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { runInBackground } from "../../utils/background.js";
import { dateOnlyString } from "../../utils/time.js";
import { afterActivityCommit, applyTransition, engineActivitySelect, type TransitionOutcome } from "../activities/engine.js";
import { runActivityTransaction } from "../activities/transaction.js";
import { recordAudit } from "../admin/audit-log.js";
import { notify } from "../notifications/notify.service.js";
import { activityExtras, adminPerson, adminPersonSelect, adminUserMatch } from "../ride/ride.admin.service.js";
import { contractPayments } from "./carpool.contract.js";

// Admin › Carpool (proposal 17, B6b): posts, booking requests and held seats,
// contracts with their sessions and monthly payment records, and each rider's
// session cancellation history. Moderators and Super Admins view and close
// posts; suspending and reinstating carpool access is Super Admin only (like
// rider suspension, B1 decision 10). Chats stay private (B2b-2 #11).

export type CarpoolAdminKind = "posts" | "bookings" | "contracts";
export type AdminCarpoolFilters = { kind: CarpoolAdminKind; status?: string; q?: string; page: number };

const notFound = () => new AppError(404, "CARPOOL_NOT_FOUND", "This carpool was not found");
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export async function listAdminCarpool(filters: AdminCarpoolFilters) {
  const pageSize = rules.carpool.adminPageSize;
  const skip = (filters.page - 1) * pageSize;
  const q = filters.q?.trim();

  if (filters.kind === "posts") {
    const where: Prisma.CarpoolPostWhereInput = {
      ...(filters.status && { status: filters.status as PostStatus }),
      ...(q && { rider: adminUserMatch(q) }),
    };
    const [total, rows] = await Promise.all([
      prisma.carpoolPost.count({ where }),
      prisma.carpoolPost.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          pausedAt: true,
          daysOfWeek: true,
          departureMinute: true,
          pickupAddress: true,
          destinationAddress: true,
          totalSeats: true,
          seatsAvailable: true,
          validFrom: true,
          validUntil: true,
          rider: { select: adminPersonSelect },
        },
      }),
    ]);
    return {
      total,
      page: filters.page,
      pageSize,
      items: rows.map((row) => ({
        kind: "POST" as const,
        id: row.id,
        status: row.status,
        paused: row.pausedAt !== null,
        daysOfWeek: row.daysOfWeek,
        time: hhmm(row.departureMinute),
        pickup: row.pickupAddress,
        destination: row.destinationAddress,
        seats: `${row.totalSeats - row.seatsAvailable}/${row.totalSeats}`,
        validFrom: dateOnlyString(row.validFrom),
        validUntil: row.validUntil ? dateOnlyString(row.validUntil) : null,
        rider: adminPerson(row.rider),
      })),
    };
  }

  if (filters.kind === "contracts") {
    const where: Prisma.CarpoolContractWhereInput = {
      ...(filters.status && { status: filters.status as CarpoolContractStatus }),
      ...(q && { booking: { activity: { OR: [{ creator: adminUserMatch(q) }, { accepter: adminUserMatch(q) }] } } }),
    };
    const [total, rows] = await Promise.all([
      prisma.carpoolContract.count({ where }),
      prisma.carpoolContract.findMany({
        where,
        orderBy: { startDate: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          monthlyPrice: true,
          durationMonths: true,
          terminationRequestedById: true,
          booking: {
            select: {
              activityId: true,
              post: { select: { pickupAddress: true, destinationAddress: true } },
              activity: { select: { creator: { select: adminPersonSelect }, accepter: { select: adminPersonSelect } } },
            },
          },
          monthlyPayments: { select: { status: true } },
        },
      }),
    ]);
    return {
      total,
      page: filters.page,
      pageSize,
      items: rows.map((row) => ({
        kind: "CONTRACT" as const,
        id: row.id,
        activityId: row.booking.activityId,
        status: row.status,
        startDate: dateOnlyString(row.startDate),
        endDate: dateOnlyString(row.endDate),
        durationMonths: row.durationMonths,
        monthlyPrice: Number(row.monthlyPrice),
        terminationRequested: row.terminationRequestedById !== null,
        paidMonths: row.monthlyPayments.filter((p) => p.status === "PAID").length,
        unpaidMonths: row.monthlyPayments.filter((p) => p.status === "UNPAID").length,
        pickup: row.booking.post.pickupAddress,
        destination: row.booking.post.destinationAddress,
        rider: adminPerson(row.booking.activity.creator),
        passenger: adminPerson(row.booking.activity.accepter),
      })),
    };
  }

  const where: Prisma.ActivityWhereInput = {
    type: "CARPOOL_BOOKING",
    ...(filters.status && { status: filters.status as ActivityStatus }),
    ...(q && { OR: [{ creator: adminUserMatch(q) }, { accepter: adminUserMatch(q) }] }),
  };
  const [total, rows] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        status: true,
        subStatus: true,
        startTime: true,
        creator: { select: adminPersonSelect },
        accepter: { select: adminPersonSelect },
        carpoolBooking: {
          select: { durationMonths: true, monthlyPrice: true, startDate: true, post: { select: { pickupAddress: true, destinationAddress: true } } },
        },
      },
    }),
  ]);
  return {
    total,
    page: filters.page,
    pageSize,
    items: rows.map((row) => ({
      kind: "BOOKING" as const,
      id: row.id,
      activityId: row.id,
      status: row.status,
      subStatus: row.subStatus,
      startDate: row.carpoolBooking ? dateOnlyString(row.carpoolBooking.startDate) : null,
      durationMonths: row.carpoolBooking?.durationMonths ?? null,
      monthlyPrice: row.carpoolBooking ? Number(row.carpoolBooking.monthlyPrice) : null,
      pickup: row.carpoolBooking?.post.pickupAddress ?? "",
      destination: row.carpoolBooking?.post.destinationAddress ?? "",
      rider: adminPerson(row.creator),
      passenger: adminPerson(row.accepter),
    })),
  };
}

// A rider's carpool record: suspension, and every session they cancelled (9.6).
export async function riderCarpoolRecord(riderId: string) {
  const [user, cancellations] = await Promise.all([
    prisma.user.findUnique({ where: { id: riderId }, select: { ...adminPersonSelect, carpoolSuspendedUntil: true } }),
    prisma.activity.findMany({
      where: { type: "CARPOOL_SESSION", status: "CANCELLED", creatorId: riderId, cancelledById: riderId },
      orderBy: { startTime: "desc" },
      take: 100,
      select: {
        id: true,
        startTime: true,
        cancelledAt: true,
        cancellationReason: true,
        isLateCancellation: true,
        accepter: { select: { id: true, profile: { select: { fullName: true } } } },
      },
    }),
  ]);
  if (!user) throw notFound();
  return {
    rider: adminPerson(user),
    carpoolSuspendedUntil: user.carpoolSuspendedUntil && user.carpoolSuspendedUntil > new Date() ? user.carpoolSuspendedUntil : null,
    sessionCancellations: cancellations.map((c) => ({
      activityId: c.id,
      startTime: c.startTime,
      cancelledAt: c.cancelledAt,
      reason: c.cancellationReason,
      late: c.isLateCancellation,
      passenger: c.accepter ? { id: c.accepter.id, name: c.accepter.profile?.fullName ?? "" } : null,
    })),
  };
}

export async function getAdminCarpoolPost(postId: string) {
  const post = await prisma.carpoolPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      status: true,
      closeReason: true,
      pausedAt: true,
      daysOfWeek: true,
      departureMinute: true,
      pickupAddress: true,
      destinationAddress: true,
      totalSeats: true,
      seatsAvailable: true,
      validFrom: true,
      validUntil: true,
      notes: true,
      createdAt: true,
      riderId: true,
      vehicle: { select: { type: true, brand: true, model: true, colour: true, registrationNumber: true, seatCapacity: true } },
      prices: { orderBy: { durationMonths: "asc" }, select: { durationMonths: true, monthlyPrice: true } },
      bookings: {
        orderBy: { createdAt: "desc" },
        select: {
          activityId: true,
          startDate: true,
          durationMonths: true,
          activity: { select: { status: true, subStatus: true, accepter: { select: adminPersonSelect } } },
          contract: { select: { id: true, status: true, endDate: true } },
        },
      },
    },
  });
  if (!post) throw notFound();
  return {
    ...post,
    time: hhmm(post.departureMinute),
    validFrom: dateOnlyString(post.validFrom),
    validUntil: post.validUntil ? dateOnlyString(post.validUntil) : null,
    prices: post.prices.map((p) => ({ durationMonths: p.durationMonths, monthlyPrice: Number(p.monthlyPrice) })),
    bookings: post.bookings.map((b) => ({
      activityId: b.activityId,
      startDate: dateOnlyString(b.startDate),
      durationMonths: b.durationMonths,
      status: b.activity.status,
      subStatus: b.activity.subStatus,
      passenger: adminPerson(b.activity.accepter),
      contract: b.contract ? { ...b.contract, endDate: dateOnlyString(b.contract.endDate) } : null,
    })),
    record: await riderCarpoolRecord(post.riderId),
  };
}

// One booking: the request or held seat, its contract, sessions and monthly
// payments, the status history and the reviews.
export async function getAdminCarpoolBooking(activityId: string) {
  const booking = await prisma.carpoolBooking.findUnique({
    where: { activityId },
    select: {
      activityId: true,
      postId: true,
      startDate: true,
      durationMonths: true,
      monthlyPrice: true,
      holdExpiresAt: true,
      riderAgreedAt: true,
      passengerAgreedAt: true,
      rejectionReason: true,
      renewedFromContractId: true,
      activity: {
        select: {
          status: true,
          subStatus: true,
          closureReason: true,
          cancellationReason: true,
          creator: { select: adminPersonSelect },
          accepter: { select: adminPersonSelect },
        },
      },
      contract: {
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          terminationRequestedById: true,
          terminationReason: true,
          terminationRequestedAt: true,
          terminatedAt: true,
          endedAt: true,
          sessions: {
            orderBy: { sessionDate: "asc" },
            select: {
              sessionDate: true,
              activity: { select: { id: true, status: true, startTime: true, cancelledById: true, cancellationReason: true, isLateCancellation: true, closureReason: true } },
            },
          },
        },
      },
    },
  });
  if (!booking) throw notFound();
  const extras = await activityExtras(activityId);
  const contract = booking.contract;
  return {
    activityId: booking.activityId,
    postId: booking.postId,
    status: booking.activity.status,
    subStatus: booking.activity.subStatus,
    closureReason: booking.activity.closureReason,
    cancellationReason: booking.activity.cancellationReason,
    startDate: dateOnlyString(booking.startDate),
    durationMonths: booking.durationMonths,
    monthlyPrice: Number(booking.monthlyPrice),
    holdExpiresAt: booking.holdExpiresAt,
    riderAgreedAt: booking.riderAgreedAt,
    passengerAgreedAt: booking.passengerAgreedAt,
    rejectionReason: booking.rejectionReason,
    isRenewal: booking.renewedFromContractId !== null,
    rider: adminPerson(booking.activity.creator),
    passenger: adminPerson(booking.activity.accepter),
    contract: contract
      ? {
          id: contract.id,
          status: contract.status,
          startDate: dateOnlyString(contract.startDate),
          endDate: dateOnlyString(contract.endDate),
          terminationRequestedById: contract.terminationRequestedById,
          terminationReason: contract.terminationReason,
          terminationRequestedAt: contract.terminationRequestedAt,
          terminatedAt: contract.terminatedAt,
          endedAt: contract.endedAt,
          sessions: contract.sessions.map((s) => ({
            activityId: s.activity.id,
            date: dateOnlyString(s.sessionDate),
            startTime: s.activity.startTime,
            status: s.activity.status,
            cancelledById: s.activity.cancelledById,
            cancellationReason: s.activity.cancellationReason,
            late: s.activity.isLateCancellation,
            closureReason: s.activity.closureReason,
          })),
          payments: await contractPayments(contract.id),
        }
      : null,
    history: extras.history,
    reviews: extras.reviews,
  };
}

// Close a post for good (ADMIN_REMOVED) with a reason. Pending requests are
// closed and their passengers told; held seats and contracts carry on to their
// own end (passengers keep their rides).
export async function adminCloseCarpoolPost(adminId: string, postId: string, reason: string, ipAddress?: string, now = new Date()) {
  const outcomes = await runActivityTransaction(async (tx) => {
    const post = await tx.carpoolPost.findUnique({ where: { id: postId }, select: { status: true, riderId: true } });
    if (!post) throw notFound();
    if (post.status === "CLOSED") throw new AppError(409, "POST_CLOSED", "This carpool is already closed");
    const closed = await tx.carpoolPost.updateMany({
      where: { id: postId, status: { in: ["OPEN", "FULL"] } },
      data: { status: "CLOSED", closedAt: now, closeReason: "ADMIN_REMOVED" },
    });
    if (closed.count === 0) throw new AppError(409, "STATUS_CHANGED", "This carpool changed meanwhile. Reload and try again.");
    const pending = await tx.activity.findMany({ where: { type: "CARPOOL_BOOKING", status: "OPEN", carpoolBooking: { postId } }, select: engineActivitySelect });
    const results: TransitionOutcome[] = [];
    for (const activity of pending) {
      const outcome = await applyTransition(tx, activity, "ADMIN_CANCEL", { type: "ADMIN", id: adminId }, { now, quiet: true, reason });
      if (outcome) results.push(outcome);
    }
    await recordAudit(tx, {
      adminId,
      action: "CARPOOL_POST_CLOSED_BY_ADMIN",
      targetType: "carpool_post",
      targetId: postId,
      targetUserId: post.riderId,
      oldValue: { status: post.status },
      newValue: { status: "CLOSED", closeReason: "ADMIN_REMOVED", reason, requestsClosed: results.length },
      ipAddress,
    });
    return results;
  });
  await afterActivityCommit(outcomes);
  return getAdminCarpoolPost(postId);
}

// --- Carpool access (9.6, B6b #2, #3): Super Admin only

export async function suspendCarpoolAccess(adminId: string, riderId: string, reason: string, endsAt: Date, ipAddress?: string, now = new Date()) {
  if (endsAt <= now) throw new AppError(400, "INVALID_DATES", "The end date must be in the future", { fields: { endsAt: ["The end date must be in the future"] } });
  return changeCarpoolAccess(adminId, riderId, "CARPOOL_SUSPEND", reason, endsAt, ipAddress, now);
}

export function reinstateCarpoolAccess(adminId: string, riderId: string, reason: string, ipAddress?: string, now = new Date()) {
  return changeCarpoolAccess(adminId, riderId, "CARPOOL_REINSTATE", reason, null, ipAddress, now);
}

async function changeCarpoolAccess(
  adminId: string,
  riderId: string,
  type: "CARPOOL_SUSPEND" | "CARPOOL_REINSTATE",
  reason: string,
  endsAt: Date | null,
  ipAddress: string | undefined,
  now: Date,
) {
  if (riderId === adminId) throw new AppError(403, "CANNOT_MODERATE_SELF", "You cannot moderate your own account");
  const suspend = type === "CARPOOL_SUSPEND";
  const moderationId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: riderId }, select: { isVerifiedRider: true, role: true, carpoolSuspendedUntil: true } });
    if (!user || !user.isVerifiedRider) throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found");
    if (user.role === "SUPER_ADMIN") throw new AppError(403, "CANNOT_MODERATE_ADMIN", "Super Admin accounts cannot be moderated");
    const inForce = !!user.carpoolSuspendedUntil && user.carpoolSuspendedUntil > now;
    if (suspend === inForce) {
      throw new AppError(409, "INVALID_STATUS_CHANGE", suspend ? "This rider's carpool access is already suspended" : "This rider's carpool access is not suspended");
    }
    // Conditional on what was read, so two admins at once cannot both apply.
    const updated = await tx.user.updateMany({
      where: { id: riderId, carpoolSuspendedUntil: user.carpoolSuspendedUntil },
      data: { carpoolSuspendedUntil: endsAt },
    });
    if (updated.count === 0) throw new AppError(409, "STATUS_CHANGED", "This rider changed meanwhile. Reload and try again.");
    // B6b #3: the rider's open posts are paused (not closed); contracts carry on.
    const paused = suspend
      ? await tx.carpoolPost.updateMany({ where: { riderId, status: { in: ["OPEN", "FULL"] }, pausedAt: null }, data: { pausedAt: now } })
      : { count: 0 };
    const moderation = await tx.moderationAction.create({
      select: { id: true },
      data: { userId: riderId, adminId, type, reason, startsAt: suspend ? now : null, endsAt },
    });
    await recordAudit(tx, {
      adminId,
      action: type,
      targetType: "user",
      targetId: riderId,
      targetUserId: riderId,
      oldValue: { carpoolSuspendedUntil: inForce ? user.carpoolSuspendedUntil!.toISOString() : null },
      newValue: { carpoolSuspendedUntil: endsAt?.toISOString() ?? null, postsPaused: paused.count, reason },
      ipAddress,
    });
    return moderation.id;
  });

  runInBackground(suspend ? "carpool suspended notification" : "carpool reinstated notification", () =>
    notify({
      type: "CARPOOL_ACCESS_CHANGED",
      userIds: [riderId],
      dedupeKey: `CARPOOL_ACCESS_CHANGED:${moderationId}`,
      data: { kind: suspend ? "SUSPENDED" : "REINSTATED", reason, ...(endsAt && { endsAt: endsAt.toISOString() }) },
    }),
  );
  return riderCarpoolRecord(riderId);
}
