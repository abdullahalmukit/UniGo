import { rules } from "../../config/rules.js";
import type { ActivityStatus, PostStatus, Prisma } from "../../generated/prisma/client.js";
import { removeTimerJobs } from "../../jobs/scheduler.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { dhakaWallTime } from "../../utils/time.js";
import { afterActivityCommit, applyTransition, engineActivitySelect, type TransitionOutcome } from "../activities/engine.js";
import { runActivityTransaction } from "../activities/transaction.js";
import { recordAudit } from "../admin/audit-log.js";
import { rideOfferCloseJob } from "../activities/timers.js";

// Admin › Ride Sharing (proposal 17, B3b-2): every passenger request, ride
// offer and seat booking, with details, status history, payment record and
// reviews (hidden ones marked), and admin cancel with a reason (audited; both
// participants notified by the engine, B2c). Moderators and Super Admins
// (Q3). Admins see full vehicle numbers (B1 decision 11). Chats stay private
// to admins (B7 opens disputed chats only, with an audit row per view).

export type RideKind = "requests" | "offers" | "bookings";
export type AdminRideFilters = { kind: RideKind; status?: string; q?: string; date?: string; subAreaId?: string; page: number };

const DAY = 24 * 60 * 60 * 1000;
const notFound = () => new AppError(404, "RIDE_NOT_FOUND", "This ride was not found");

const personSelect = { id: true, email: true, phone: true, profile: { select: { fullName: true } } } as const satisfies Prisma.UserSelect;
type Person = Prisma.UserGetPayload<{ select: typeof personSelect }>;
const person = (user: Person | null) => (user ? { id: user.id, name: user.profile?.fullName ?? "", email: user.email, phone: user.phone } : null);

const userMatch = (q: string): Prisma.UserWhereInput => ({
  OR: [{ email: { contains: q } }, { phone: { contains: q.replace(/[\s-]/g, "") } }, { profile: { fullName: { contains: q } } }],
});

function dayRange(date: string | undefined) {
  if (!date) return undefined;
  const start = dhakaWallTime(date, 0, 0);
  return { gte: start, lt: new Date(start.getTime() + DAY) };
}

export async function listAdminRides(filters: AdminRideFilters) {
  const pageSize = rules.admin.pageSize;
  const q = filters.q?.trim();
  const when = dayRange(filters.date);
  const skip = (filters.page - 1) * pageSize;

  if (filters.kind === "offers") {
    const where: Prisma.RideOfferWhereInput = {
      ...(filters.status && { status: filters.status as PostStatus }),
      ...(when && { departureTime: when }),
      ...(filters.subAreaId && { subAreaId: filters.subAreaId }),
      ...(q && { rider: userMatch(q) }),
    };
    const [total, rows] = await Promise.all([
      prisma.rideOffer.count({ where }),
      prisma.rideOffer.findMany({
        where,
        orderBy: { departureTime: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          departureTime: true,
          pickupAddress: true,
          destinationAddress: true,
          farePerSeat: true,
          totalSeats: true,
          seatsAvailable: true,
          rider: { select: personSelect },
          _count: { select: { bookings: true } },
        },
      }),
    ]);
    return {
      total,
      page: filters.page,
      pageSize,
      items: rows.map((row) => ({
        kind: "OFFER" as const,
        id: row.id,
        status: row.status,
        time: row.departureTime,
        pickup: row.pickupAddress,
        destination: row.destinationAddress,
        amount: Number(row.farePerSeat),
        seats: `${row.totalSeats - row.seatsAvailable}/${row.totalSeats}`,
        bookings: row._count.bookings,
        creator: person(row.rider),
        accepter: null,
      })),
    };
  }

  const type = filters.kind === "requests" ? "RIDE_REQUEST" : "RIDE_BOOKING";
  const where: Prisma.ActivityWhereInput = {
    type,
    ...(filters.status && { status: filters.status as ActivityStatus }),
    ...(when && { startTime: when }),
    ...(filters.subAreaId && (type === "RIDE_REQUEST" ? { rideRequest: { subAreaId: filters.subAreaId } } : { rideBooking: { rideOffer: { subAreaId: filters.subAreaId } } })),
    ...(q && { OR: [{ creator: userMatch(q) }, { accepter: userMatch(q) }] }),
  };
  const [total, rows] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: { startTime: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        status: true,
        subStatus: true,
        startTime: true,
        deletedAt: true,
        creator: { select: personSelect },
        accepter: { select: personSelect },
        rideRequest: { select: { pickupAddress: true, destinationAddress: true, offeredAmount: true } },
        rideBooking: { select: { amount: true, seatsBooked: true, rideOffer: { select: { pickupAddress: true, destinationAddress: true } } } },
      },
    }),
  ]);
  return {
    total,
    page: filters.page,
    pageSize,
    items: rows.map((row) => ({
      kind: type === "RIDE_REQUEST" ? ("REQUEST" as const) : ("BOOKING" as const),
      id: row.id,
      status: row.status,
      deleted: row.deletedAt !== null,
      time: row.startTime,
      pickup: row.rideRequest?.pickupAddress ?? row.rideBooking?.rideOffer.pickupAddress ?? "",
      destination: row.rideRequest?.destinationAddress ?? row.rideBooking?.rideOffer.destinationAddress ?? "",
      amount: Number(row.rideRequest?.offeredAmount ?? row.rideBooking?.amount ?? 0),
      seats: row.rideBooking ? String(row.rideBooking.seatsBooked) : null,
      bookings: null,
      // For a booking the creator is the rider and the accepter the passenger
      creator: person(row.creator),
      accepter: person(row.accepter),
    })),
  };
}

const vehicleSelect = { id: true, type: true, brand: true, model: true, colour: true, registrationNumber: true, seatCapacity: true } as const;

async function activityExtras(activityId: string) {
  const [history, payment, reviews] = await Promise.all([
    prisma.activityStatusHistory.findMany({
      where: { activityId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        fromSubStatus: true,
        toSubStatus: true,
        actorType: true,
        reason: true,
        createdAt: true,
        actor: { select: { id: true, profile: { select: { fullName: true } } } },
      },
    }),
    prisma.paymentRecord.findUnique({
      where: { activityId },
      select: { amount: true, method: true, status: true, paidAt: true, payeeId: true },
    }),
    prisma.review.findMany({
      where: { activityId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        rating: true,
        comment: true,
        publishedAt: true,
        hiddenAt: true,
        hiddenReason: true,
        reviewer: { select: { id: true, profile: { select: { fullName: true } } } },
        reviewee: { select: { id: true, profile: { select: { fullName: true } } } },
      },
    }),
  ]);
  return {
    history: history.map((h) => ({ ...h, actor: h.actor ? { id: h.actor.id, name: h.actor.profile?.fullName ?? "" } : null })),
    payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      published: r.publishedAt !== null,
      hidden: r.hiddenAt !== null,
      hiddenReason: r.hiddenReason,
      reviewer: { id: r.reviewer.id, name: r.reviewer.profile?.fullName ?? "" },
      reviewee: { id: r.reviewee.id, name: r.reviewee.profile?.fullName ?? "" },
    })),
  };
}

const ACTIVITY_DETAIL = {
  id: true,
  type: true,
  status: true,
  subStatus: true,
  startTime: true,
  acceptedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  isLateCancellation: true,
  closureReason: true,
  deletedAt: true,
  createdAt: true,
  creator: { select: personSelect },
  accepter: { select: personSelect },
  cancelledBy: { select: { id: true, profile: { select: { fullName: true } } } },
  rideRequest: {
    select: {
      pickupAddress: true,
      destinationAddress: true,
      offeredAmount: true,
      passengerCount: true,
      notes: true,
      routeDistanceKm: true,
      subArea: { select: { id: true, name: true } },
      vehicle: { select: vehicleSelect },
    },
  },
  rideBooking: { select: { rideOfferId: true, seatsBooked: true, amount: true } },
} as const satisfies Prisma.ActivitySelect;

export async function getAdminRideActivity(activityId: string) {
  const row = await prisma.activity.findFirst({ where: { id: activityId, type: { in: ["RIDE_REQUEST", "RIDE_BOOKING"] } }, select: ACTIVITY_DETAIL });
  if (!row) throw notFound();
  return {
    kind: row.type === "RIDE_REQUEST" ? ("REQUEST" as const) : ("BOOKING" as const),
    ...row,
    creator: person(row.creator),
    accepter: person(row.accepter),
    cancelledBy: row.cancelledBy ? { id: row.cancelledBy.id, name: row.cancelledBy.profile?.fullName ?? "" } : null,
    rideRequest: row.rideRequest
      ? { ...row.rideRequest, offeredAmount: Number(row.rideRequest.offeredAmount), routeDistanceKm: row.rideRequest.routeDistanceKm === null ? null : Number(row.rideRequest.routeDistanceKm) }
      : null,
    rideBooking: row.rideBooking ? { ...row.rideBooking, amount: Number(row.rideBooking.amount) } : null,
    ...(await activityExtras(activityId)),
  };
}

export async function getAdminRideOffer(offerId: string) {
  const row = await prisma.rideOffer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      status: true,
      closeReason: true,
      closedAt: true,
      departureTime: true,
      pickupAddress: true,
      destinationAddress: true,
      farePerSeat: true,
      totalSeats: true,
      seatsAvailable: true,
      notes: true,
      createdAt: true,
      subArea: { select: { id: true, name: true } },
      vehicle: { select: vehicleSelect },
      rider: { select: personSelect },
      bookings: {
        orderBy: { createdAt: "asc" },
        select: { activityId: true, seatsBooked: true, amount: true, activity: { select: { status: true, accepter: { select: personSelect } } } },
      },
    },
  });
  if (!row) throw notFound();
  return {
    kind: "OFFER" as const,
    ...row,
    farePerSeat: Number(row.farePerSeat),
    rider: person(row.rider),
    bookings: row.bookings.map((b) => ({ activityId: b.activityId, seatsBooked: b.seatsBooked, amount: Number(b.amount), status: b.activity.status, passenger: person(b.activity.accepter) })),
  };
}

// Admin cancel of a request or a booking (engine ADMIN_CANCEL; the reason stays
// in the status history, users see "cancelled by UniGo").
export async function adminCancelActivity(adminId: string, activityId: string, reason: string, ipAddress?: string, now = new Date()) {
  const outcome = await runActivityTransaction(async (tx) => {
    const activity = await tx.activity.findFirst({ where: { id: activityId, type: { in: ["RIDE_REQUEST", "RIDE_BOOKING"] } }, select: engineActivitySelect });
    if (!activity) throw notFound();
    const done = await applyTransition(tx, activity, "ADMIN_CANCEL", { type: "ADMIN", id: adminId }, { reason, now, hideReason: true });
    await recordAudit(tx, {
      adminId,
      action: "RIDE_CANCELLED_BY_ADMIN",
      targetType: activity.type === "RIDE_REQUEST" ? "ride_request" : "ride_booking",
      targetId: activityId,
      oldValue: { status: activity.status },
      newValue: { status: "CANCELLED", reason },
      ipAddress,
    });
    return done;
  });
  await afterActivityCommit([outcome]);
  return getAdminRideActivity(activityId);
}

// Admin cancel of an offer: it is closed (ADMIN_REMOVED) and every booking
// that has not finished is cancelled the same way.
export async function adminCancelOffer(adminId: string, offerId: string, reason: string, ipAddress?: string, now = new Date()) {
  const { outcomes, offer } = await runActivityTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ride_offers WHERE id = ${offerId} FOR UPDATE`;
    const offer = await tx.rideOffer.findUnique({ where: { id: offerId }, select: { id: true, status: true, departureTime: true, riderId: true } });
    if (!offer) throw notFound();
    const bookings = await tx.activity.findMany({
      where: { type: "RIDE_BOOKING", conflictGroupId: offerId, status: { in: ["ACCEPTED", "IN_PROGRESS", "DISPUTED"] } },
      select: engineActivitySelect,
    });
    if (offer.status === "CLOSED" && bookings.length === 0) throw new AppError(409, "OFFER_CLOSED", "This offer is already closed");
    const done: TransitionOutcome[] = [];
    for (const booking of bookings) {
      const outcome = await applyTransition(tx, booking, "ADMIN_CANCEL", { type: "ADMIN", id: adminId }, { reason, now, hideReason: true });
      if (outcome) done.push(outcome);
    }
    await tx.rideOffer.update({ where: { id: offerId }, data: { status: "CLOSED", closedAt: now, closeReason: "ADMIN_REMOVED" } });
    await recordAudit(tx, {
      adminId,
      action: "RIDE_OFFER_CANCELLED_BY_ADMIN",
      targetType: "ride_offer",
      targetId: offerId,
      targetUserId: offer.riderId,
      oldValue: { status: offer.status },
      newValue: { status: "CLOSED", closeReason: "ADMIN_REMOVED", bookingsCancelled: done.length, reason },
      ipAddress,
    });
    return { outcomes: done, offer };
  });
  await afterActivityCommit(outcomes);
  await removeTimerJobs([rideOfferCloseJob(offer).jobId]);
  return getAdminRideOffer(offerId);
}
