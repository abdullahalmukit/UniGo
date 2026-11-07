import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { removeTimerJobs, scheduleTimerJobs } from "../../jobs/scheduler.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { dhakaWallTime } from "../../utils/time.js";
import { assertNoTimeConflict } from "../activities/conflict.js";
import {
  acceptActivity,
  afterActivityCommit,
  applyTransition,
  createAcceptedActivity,
  engineActivitySelect,
  recordCreation,
  type TransitionOutcome,
} from "../activities/engine.js";
import { assertCreationLimits } from "../activities/limits.js";
import { reserveRideOfferSeats } from "../activities/seats.js";
import { assertCreationWindow, conflictRange } from "../activities/time-rules.js";
import { rescheduleAfterStartChange, rescheduleRideOfferClose, rideOfferCloseJob, scheduleActivityTimers } from "../activities/timers.js";
import { lockUsers, runActivityTransaction, type Tx } from "../activities/transaction.js";
import { boundingBox, distanceKm, type LatLng } from "../geo/distance.js";
import { queueSubAreaNotification } from "../notifications/sub-area.service.js";
import { activeBlocker, currentLicenceExpiry } from "../riders/rider-status.js";
import { blockedUserIds, isBlockedBetween } from "../users/blocks.service.js";
import { seatLimits } from "../vehicles/vehicles.js";
import { routeDistanceKm } from "./fare.service.js";
import type { ListQuery, OfferEditInput, OfferInput, RequestEditInput, RequestInput } from "./ride.validation.js";
import { bookingSelect, bookingView, completionBy, offerSelect, offerView, requestSelect, requestView, type OfferRow, type RequestRow } from "./ride.views.js";

// Ride Sharing (proposal section 8, B3a decisions). Status changes go through
// the common engine; this module adds the ride rules: Active riders, vehicles
// and seats, one booking per passenger per offer, offers that overlap.

const ACTIVE_BOOKING = ["ACCEPTED", "IN_PROGRESS", "DISPUTED"] as const;
const DAY = 24 * 60 * 60 * 1000;

const notFound = () => new AppError(404, "RIDE_NOT_FOUND", "This ride was not found");

// --- Shared checks

// "Verified & Active Rider" (proposal section 4): Active switch on, and still
// able to be Active (verified, not restricted, no rider suspension, licence).
async function assertActiveRider(tx: Tx, userId: string, now: Date) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { isVerifiedRider: true, riderActive: true, studentVerificationStatus: true, accountStatus: true, riderSuspended: true, riderSuspendedUntil: true },
  });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  const blocker = activeBlocker(user, await currentLicenceExpiry(tx, userId), now);
  if (blocker || !user.riderActive) {
    throw new AppError(403, "RIDER_NOT_ACTIVE", "Only Active riders can do this. Switch to Active in Drive with UniGo.", {
      data: { blocker: blocker ?? "NOT_ACTIVE" },
    });
  }
}

// The rider's own vehicle, approved and in use, with enough seats.
async function usableVehicle(tx: Tx, riderId: string, vehicleId: string, seats: number) {
  const vehicle = await tx.vehicle.findFirst({
    where: { id: vehicleId, ownerId: riderId, status: "APPROVED", isActive: true },
    select: { id: true, type: true, seatCapacity: true },
  });
  if (!vehicle) {
    throw new AppError(400, "VEHICLE_NOT_USABLE", "Choose one of your approved vehicles", { fields: { vehicleId: ["Choose one of your approved vehicles"] } });
  }
  const limits = seatLimits(vehicle.type);
  const max = Math.min(limits.max, vehicle.seatCapacity);
  if (seats < limits.min || seats > max) {
    throw new AppError(400, "SEATS_EXCEED_CAPACITY", `This vehicle takes at most ${max} passenger${max === 1 ? "" : "s"}`, {
      data: { max },
      fields: { seats: [`At most ${max}`] },
    });
  }
  return vehicle;
}

// B3a decision (addition 1): a rider with an OPEN offer of their own within
// 90 minutes may not accept a request or book a seat as a passenger. They stop
// new bookings on that offer first. Unbooked offers never block other users.
async function assertNoOwnOpenOfferNear(tx: Tx, userId: string, start: Date, exceptOfferId?: string) {
  const { after, before } = conflictRange(start);
  const offer = await tx.rideOffer.findFirst({
    where: { riderId: userId, status: "OPEN", departureTime: { gt: after, lt: before }, ...(exceptOfferId && { id: { not: exceptOfferId } }) },
    select: { id: true },
  });
  if (offer) {
    throw new AppError(409, "OWN_OFFER_CONFLICT", "You have an open ride offer within 90 minutes of this time. Use \"Stop new bookings\" on that offer first.", {
      data: { offerId: offer.id },
    });
  }
}

// B3a decision (Q2): a new or moved offer must be at least 90 minutes from the
// rider's other OPEN or FULL offers and from their accepted activities.
async function assertOfferTimeFree(tx: Tx, riderId: string, departure: Date, exceptOfferId?: string) {
  const { after, before } = conflictRange(departure);
  const overlapping = await tx.rideOffer.findFirst({
    where: {
      riderId,
      status: { in: ["OPEN", "FULL"] },
      departureTime: { gt: after, lt: before },
      ...(exceptOfferId && { id: { not: exceptOfferId } }),
    },
    select: { id: true },
  });
  if (overlapping) {
    throw new AppError(409, "TIME_CONFLICT", "You already offer a ride within 90 minutes of this time", { data: { offerId: overlapping.id } });
  }
  await assertNoTimeConflict(tx, { userIds: [riderId], slots: [departure], ...(exceptOfferId && { conflictGroupId: exceptOfferId }) });
}

async function assertActiveSubArea(db: Tx | typeof prisma, subAreaId: string | null | undefined) {
  if (!subAreaId) return;
  const subArea = await db.subArea.findFirst({ where: { id: subAreaId, isActive: true }, select: { id: true } });
  if (!subArea) throw new AppError(400, "SUB_AREA_NOT_FOUND", "Choose a sub-area from the list", { fields: { subAreaId: ["Choose a sub-area from the list"] } });
}

const decimal = (value: number) => new Prisma.Decimal(value.toFixed(2));
const toPoint = (p: { lat: number; lng: number }): LatLng => ({ lat: p.lat, lng: p.lng });

// Best effort: a ride without a distance still works (8.2).
async function distanceFor(pickup: LatLng, destination: LatLng) {
  const km = await routeDistanceKm(pickup, destination);
  return km === null ? null : decimal(km);
}

// --- Passenger requests (Need a Ride)

async function loadRequest(id: string) {
  const row = await prisma.activity.findFirst({ where: { id, type: "RIDE_REQUEST", deletedAt: null }, select: requestSelect });
  if (!row?.rideRequest) throw notFound();
  return row;
}

export async function createRideRequest(userId: string, input: RequestInput, now = new Date()) {
  assertCreationWindow("RIDE", input.startTime, now);
  await assertActiveSubArea(prisma, input.subAreaId);
  const distance = await distanceFor(toPoint(input.pickup), toPoint(input.destination));

  const activity = await runActivityTransaction(async (tx) => {
    await assertCreationLimits(tx, userId, now);
    const created = await tx.activity.create({
      data: {
        type: "RIDE_REQUEST",
        status: "OPEN",
        startTime: input.startTime,
        blocksTime: true,
        creatorId: userId,
        rideRequest: {
          create: {
            pickupAddress: input.pickup.address,
            pickupLat: decimal(input.pickup.lat),
            pickupLng: decimal(input.pickup.lng),
            destinationAddress: input.destination.address,
            destinationLat: decimal(input.destination.lat),
            destinationLng: decimal(input.destination.lng),
            offeredAmount: decimal(input.offeredAmount),
            passengerCount: input.passengerCount,
            notes: input.notes ?? null,
            subAreaId: input.subAreaId,
            routeDistanceKm: distance,
          },
        },
      },
      select: engineActivitySelect,
    });
    await recordCreation(tx, created, { type: "USER", id: userId });
    return created;
  });

  await scheduleActivityTimers([activity]);
  // B3a decision (Q1): Active riders who saved the sub-area are told
  await queueSubAreaNotification(activity.id);
  return requestView(await loadRequest(activity.id), userId);
}

// Before acceptance the creator can change everything (CLAUDE.md 5.7). The
// activity row is updated first and only while OPEN, so an accept that comes
// in between makes the edit fail instead of changing an accepted ride.
export async function updateRideRequest(userId: string, activityId: string, input: RequestEditInput, now = new Date()) {
  const current = await loadRequest(activityId);
  if (current.creatorId !== userId) throw new AppError(403, "NOT_PARTICIPANT", "Only the creator can edit this request");
  if (current.status !== "OPEN") throw new AppError(409, "NOT_EDITABLE", "This request can no longer be edited");
  if (input.startTime) assertCreationWindow("RIDE", input.startTime, now);
  if (input.subAreaId) await assertActiveSubArea(prisma, input.subAreaId);

  const r = current.rideRequest!;
  const pickup = input.pickup ?? { address: r.pickupAddress, lat: Number(r.pickupLat), lng: Number(r.pickupLng) };
  const destination = input.destination ?? { address: r.destinationAddress, lat: Number(r.destinationLat), lng: Number(r.destinationLng) };
  const moved = !!(input.pickup || input.destination);
  const distance = moved ? await distanceFor(toPoint(pickup), toPoint(destination)) : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.activity.updateMany({
      where: { id: activityId, status: "OPEN", deletedAt: null, startTime: { gt: now } },
      data: { startTime: input.startTime ?? current.startTime },
    });
    if (claimed.count === 0) throw new AppError(409, "NOT_EDITABLE", "This request can no longer be edited");
    await tx.rideRequest.update({
      where: { activityId },
      data: {
        pickupAddress: pickup.address,
        pickupLat: decimal(pickup.lat),
        pickupLng: decimal(pickup.lng),
        destinationAddress: destination.address,
        destinationLat: decimal(destination.lat),
        destinationLng: decimal(destination.lng),
        ...(input.offeredAmount !== undefined && { offeredAmount: decimal(input.offeredAmount) }),
        ...(input.passengerCount !== undefined && { passengerCount: input.passengerCount }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.subAreaId && { subAreaId: input.subAreaId }),
        ...(distance !== undefined && { routeDistanceKm: distance }),
      },
    });
    return tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: engineActivitySelect });
  });

  if (input.startTime && input.startTime.getTime() !== current.startTime.getTime()) await rescheduleAfterStartChange(updated, current.startTime);
  return requestView(await loadRequest(activityId), userId);
}

// Upgrade (CLAUDE.md 5.7): raise the offered amount of an OPEN request.
export async function upgradeRideRequest(userId: string, activityId: string, offeredAmount: number, now = new Date()) {
  const current = await loadRequest(activityId);
  if (offeredAmount <= Number(current.rideRequest!.offeredAmount)) {
    throw new AppError(400, "AMOUNT_NOT_HIGHER", "Choose a higher amount", { fields: { offeredAmount: ["Choose a higher amount"] } });
  }
  return updateRideRequest(userId, activityId, { offeredAmount }, now);
}

// Only a Verified & Active Rider, with a vehicle that is theirs, approved and
// has enough seats (proposal 8.5, B3a Q5). The vehicle is kept on the request.
export async function acceptRideRequest(riderId: string, activityId: string, vehicleId: string, now = new Date()) {
  await loadRequest(activityId);
  await acceptActivity(activityId, riderId, {
    now,
    check: async (tx, activity) => {
      await assertActiveRider(tx, riderId, now);
      const request = await tx.rideRequest.findUniqueOrThrow({ where: { activityId }, select: { passengerCount: true } });
      await usableVehicle(tx, riderId, vehicleId, request.passengerCount);
      await assertNoOwnOpenOfferNear(tx, riderId, activity.startTime);
      await tx.rideRequest.update({ where: { activityId }, data: { vehicleId } });
    },
  });
  return requestView(await loadRequest(activityId), riderId);
}

export async function getRideRequest(viewerId: string, activityId: string, now = new Date()) {
  const row = await loadRequest(activityId);
  const participant = viewerId === row.creatorId || viewerId === row.accepterId;
  if (!participant) {
    // Others see only open requests that have not started, never across a block
    if (row.status !== "OPEN" || row.startTime <= now) throw notFound();
    if (await isBlockedBetween(prisma, viewerId, row.creatorId)) throw notFound();
  }
  return requestView(row, viewerId);
}

// --- Ride offers (Offer a Ride)

async function loadOffer(id: string) {
  const row = await prisma.rideOffer.findUnique({ where: { id }, select: offerSelect });
  if (!row) throw notFound();
  return row;
}

export async function createRideOffer(riderId: string, input: OfferInput, now = new Date()) {
  assertCreationWindow("RIDE", input.departureTime, now);
  await assertActiveSubArea(prisma, input.subAreaId);
  const distance = await distanceFor(toPoint(input.pickup), toPoint(input.destination));

  const offer = await runActivityTransaction(async (tx) => {
    await assertCreationLimits(tx, riderId, now);
    await assertActiveRider(tx, riderId, now);
    await usableVehicle(tx, riderId, input.vehicleId, input.seats);
    await assertOfferTimeFree(tx, riderId, input.departureTime);
    return tx.rideOffer.create({
      data: {
        riderId,
        vehicleId: input.vehicleId,
        pickupAddress: input.pickup.address,
        pickupLat: decimal(input.pickup.lat),
        pickupLng: decimal(input.pickup.lng),
        destinationAddress: input.destination.address,
        destinationLat: decimal(input.destination.lat),
        destinationLng: decimal(input.destination.lng),
        departureTime: input.departureTime,
        farePerSeat: decimal(input.farePerSeat),
        totalSeats: input.seats,
        seatsAvailable: input.seats,
        notes: input.notes ?? null,
        subAreaId: input.subAreaId ?? null,
        routeDistanceKm: distance,
      },
      select: { id: true, departureTime: true },
    });
  });

  await scheduleTimerJobs([rideOfferCloseJob(offer)]);
  return getRideOffer(riderId, offer.id, now);
}

// Locks the offer row for the rest of the transaction (bookings wait).
async function lockOffer(tx: Tx, offerId: string) {
  await tx.$queryRaw`SELECT id FROM ride_offers WHERE id = ${offerId} FOR UPDATE`;
  const offer = await tx.rideOffer.findUnique({
    where: { id: offerId },
    select: { id: true, riderId: true, status: true, departureTime: true, totalSeats: true, seatsAvailable: true, vehicleId: true },
  });
  if (!offer) throw notFound();
  return offer;
}

function activeBookingsOf(tx: Tx, offerId: string) {
  return tx.rideBooking.findMany({
    where: { rideOfferId: offerId, activity: { status: { in: [...ACTIVE_BOOKING] } } },
    select: { seatsBooked: true, activity: { select: engineActivitySelect } },
  });
}

const OFFER_FIELDS = ["pickup", "destination", "departureTime", "farePerSeat", "vehicleId", "notes", "subAreaId"] as const;

// Before any booking everything can change. After the first active booking
// the details are locked (CLAUDE.md 5.7); the rider may only raise the seat
// count up to the vehicle's capacity (B3a Q3).
export async function updateRideOffer(riderId: string, offerId: string, input: OfferEditInput, now = new Date()) {
  if (input.departureTime) assertCreationWindow("RIDE", input.departureTime, now);
  if (input.subAreaId) await assertActiveSubArea(prisma, input.subAreaId);
  const before = await loadOffer(offerId);
  if (before.riderId !== riderId) throw new AppError(403, "NOT_PARTICIPANT", "Only the rider can edit this offer");
  const moved = !!(input.pickup || input.destination);
  const pickup = input.pickup ?? { address: before.pickupAddress, lat: Number(before.pickupLat), lng: Number(before.pickupLng) };
  const destination = input.destination ?? { address: before.destinationAddress, lat: Number(before.destinationLat), lng: Number(before.destinationLng) };
  const distance = moved ? await distanceFor(toPoint(pickup), toPoint(destination)) : undefined;

  const result = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [riderId]);
    const offer = await lockOffer(tx, offerId);
    if (offer.status === "CLOSED" || offer.departureTime <= now) throw new AppError(409, "NOT_EDITABLE", "This offer can no longer be edited");
    const bookings = await activeBookingsOf(tx, offerId);
    const booked = bookings.reduce((sum, b) => sum + b.seatsBooked, 0);

    if (bookings.length > 0) {
      const changed = OFFER_FIELDS.filter((field) => input[field] !== undefined);
      if (changed.length > 0) {
        throw new AppError(409, "OFFER_LOCKED", "This offer has bookings: only more seats can be added", { data: { fields: changed } });
      }
      if (input.seats === undefined) return offer;
      if (input.seats < offer.totalSeats) throw new AppError(409, "OFFER_LOCKED", "This offer has bookings: seats can only be added");
      await usableVehicle(tx, riderId, offer.vehicleId, input.seats);
      const added = input.seats - offer.totalSeats;
      await tx.rideOffer.update({
        where: { id: offerId },
        data: { totalSeats: input.seats, seatsAvailable: { increment: added }, ...(offer.status === "FULL" && added > 0 && { status: "OPEN" }) },
      });
      return offer;
    }

    const vehicleId = input.vehicleId ?? offer.vehicleId;
    const seats = input.seats ?? offer.totalSeats;
    if (input.vehicleId || input.seats !== undefined) {
      await assertActiveRider(tx, riderId, now);
      await usableVehicle(tx, riderId, vehicleId, seats);
    }
    if (input.departureTime) await assertOfferTimeFree(tx, riderId, input.departureTime, offerId);
    await tx.rideOffer.update({
      where: { id: offerId },
      data: {
        vehicleId,
        totalSeats: seats,
        seatsAvailable: seats - booked,
        status: "OPEN",
        pickupAddress: pickup.address,
        pickupLat: decimal(pickup.lat),
        pickupLng: decimal(pickup.lng),
        destinationAddress: destination.address,
        destinationLat: decimal(destination.lat),
        destinationLng: decimal(destination.lng),
        ...(input.departureTime && { departureTime: input.departureTime }),
        ...(input.farePerSeat !== undefined && { farePerSeat: decimal(input.farePerSeat) }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.subAreaId !== undefined && { subAreaId: input.subAreaId }),
        ...(distance !== undefined && { routeDistanceKm: distance }),
      },
    });
    return offer;
  });

  if (input.departureTime && input.departureTime.getTime() !== result.departureTime.getTime()) {
    await rescheduleRideOfferClose({ id: offerId, departureTime: input.departureTime }, result.departureTime);
  }
  return getRideOffer(riderId, offerId, now);
}

// Close an OPEN or FULL offer. STOPPED_BY_RIDER keeps the bookings (Q3);
// REMOVED_BY_RIDER only when nobody has an active booking.
async function closeOffer(riderId: string, offerId: string, reason: "STOPPED_BY_RIDER" | "REMOVED_BY_RIDER", now: Date) {
  const offer = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [riderId]);
    const current = await lockOffer(tx, offerId);
    if (current.riderId !== riderId) throw new AppError(403, "NOT_PARTICIPANT", "Only the rider can change this offer");
    if (current.status === "CLOSED") throw new AppError(409, "OFFER_CLOSED", "This offer is already closed");
    if (reason === "REMOVED_BY_RIDER" && (await activeBookingsOf(tx, offerId)).length > 0) {
      throw new AppError(409, "OFFER_HAS_BOOKINGS", "This offer has bookings. Stop new bookings or cancel the offer instead.");
    }
    await tx.rideOffer.update({ where: { id: offerId }, data: { status: "CLOSED", closedAt: now, closeReason: reason } });
    return current;
  });
  await removeTimerJobs([rideOfferCloseJob(offer).jobId]);
  return getRideOffer(riderId, offerId, now);
}

export const stopOfferBookings = (riderId: string, offerId: string, now = new Date()) => closeOffer(riderId, offerId, "STOPPED_BY_RIDER", now);
export const removeRideOffer = (riderId: string, offerId: string, now = new Date()) => closeOffer(riderId, offerId, "REMOVED_BY_RIDER", now);

// Cancel the offer (B3a Q3): every ACCEPTED booking is cancelled through the
// engine with the rider as the canceller and this reason (late cancellation
// counted per booking, each passenger notified); then the offer is CLOSED.
// Refused while a booking has started, asked for completion or is disputed.
export async function cancelRideOffer(riderId: string, offerId: string, reason: string, now = new Date()) {
  const { offer, outcomes } = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [riderId]);
    const current = await lockOffer(tx, offerId);
    if (current.riderId !== riderId) throw new AppError(403, "NOT_PARTICIPANT", "Only the rider can cancel this offer");
    if (current.status === "CLOSED" && current.departureTime <= now) throw new AppError(409, "OFFER_CLOSED", "This offer has already departed");
    const bookings = await activeBookingsOf(tx, offerId);
    if (bookings.some((b) => b.activity.status !== "ACCEPTED")) {
      throw new AppError(409, "OFFER_HAS_STARTED_BOOKINGS", "A booking on this offer has already started. It finishes normally; cancel the others one by one.");
    }
    const done: TransitionOutcome[] = [];
    for (const booking of bookings) {
      const outcome = await applyTransition(tx, booking.activity, "CANCEL", { type: "USER", id: riderId }, { reason, now });
      if (outcome) done.push(outcome);
    }
    await tx.rideOffer.update({ where: { id: offerId }, data: { status: "CLOSED", closedAt: current.status === "CLOSED" ? undefined : now, closeReason: "CANCELLED_BY_RIDER" } });
    return { offer: current, outcomes: done };
  });
  await afterActivityCommit(outcomes);
  await removeTimerJobs([rideOfferCloseJob(offer).jobId]);
  return getRideOffer(riderId, offerId, now);
}

// Book seats on an offer (proposal 8.4): one seat by default, more for
// companions up to the seats left. The booking is the confirmation; its
// amount (fare per seat x seats) is fixed now (B3a addition 3).
export async function bookRideOffer(passengerId: string, offerId: string, seats: number, now = new Date()) {
  const offer = await prisma.rideOffer.findUnique({ where: { id: offerId }, select: { riderId: true, departureTime: true, status: true } });
  if (!offer) throw notFound();
  if (offer.riderId === passengerId) throw new AppError(403, "OWN_ITEM", "You cannot book your own offer");
  if (offer.status !== "OPEN") throw new AppError(409, "ALREADY_TAKEN", "This offer is no longer taking bookings");

  const activity = await createAcceptedActivity({
    type: "RIDE_BOOKING",
    creatorId: offer.riderId,
    accepterId: passengerId,
    startTime: offer.departureTime,
    subStatus: "RIDE_CONFIRMED",
    conflictGroupId: offerId,
    now,
    check: async (tx) => {
      // Offers of riders who are not Active are not bookable
      try {
        await assertActiveRider(tx, offer.riderId, now);
      } catch {
        throw new AppError(409, "RIDER_NOT_AVAILABLE", "This rider is not taking bookings right now");
      }
      // B3a: one active booking per passenger per offer. Sibling bookings skip
      // the conflict check (same group), so it is checked here, with both
      // users locked.
      const existing = await tx.rideBooking.findFirst({
        where: { rideOfferId: offerId, activity: { accepterId: passengerId, status: { in: [...ACTIVE_BOOKING] } } },
        select: { activityId: true },
      });
      if (existing) throw new AppError(409, "ALREADY_BOOKED", "You already have a booking on this ride", { data: { activityId: existing.activityId } });
      await assertNoOwnOpenOfferNear(tx, passengerId, offer.departureTime);
      await reserveRideOfferSeats(tx, offerId, seats, now);
      // The offer row is locked by the seat update: its time cannot have moved
      const locked = await tx.rideOffer.findUniqueOrThrow({ where: { id: offerId }, select: { departureTime: true } });
      if (locked.departureTime.getTime() !== offer.departureTime.getTime()) {
        throw new AppError(409, "OFFER_CHANGED", "This offer changed a moment ago. Look at it again and book.");
      }
    },
    afterCreate: async (tx, created) => {
      const { farePerSeat } = await tx.rideOffer.findUniqueOrThrow({ where: { id: offerId }, select: { farePerSeat: true } });
      await tx.rideBooking.create({
        data: { activityId: created.id, rideOfferId: offerId, seatsBooked: seats, amount: farePerSeat.mul(seats) },
      });
    },
  });
  return getRideBooking(passengerId, activity.id);
}

// The rider sees every booking; a passenger only their own booking and the
// seats left, never other passengers (B3a addition 2).
export async function getRideOffer(viewerId: string, offerId: string, now = new Date()) {
  const row = await loadOffer(offerId);
  const isRider = row.riderId === viewerId;
  const bookings = await prisma.rideBooking.findMany({
    where: { rideOfferId: offerId, ...(!isRider && { activity: { accepterId: viewerId } }) },
    orderBy: { createdAt: "asc" },
    select: bookingSelect,
  });
  if (!isRider) {
    const hasBooking = bookings.length > 0;
    const visible = row.status === "OPEN" || row.status === "FULL" ? row.departureTime > now : false;
    if (!hasBooking && !visible) throw notFound();
    if (!hasBooking && (await isBlockedBetween(prisma, viewerId, row.riderId))) throw notFound();
  }
  const views = await Promise.all(bookings.map(bookingView));
  return {
    ...(await offerView(row, viewerId)),
    bookings: isRider ? views : [],
    myBooking: isRider ? null : (views.filter((b) => (ACTIVE_BOOKING as readonly string[]).includes(b.status)).at(-1) ?? views.at(-1) ?? null),
  };
}

// One booking, for its two participants.
export async function getRideBooking(viewerId: string, activityId: string) {
  const booking = await prisma.rideBooking.findUnique({
    where: { activityId },
    select: { ...bookingSelect, rideOffer: { select: offerSelect } },
  });
  if (!booking || (booking.activity.creatorId !== viewerId && booking.activity.accepterId !== viewerId)) throw notFound();
  const isRider = booking.activity.creatorId === viewerId;
  return {
    ...(await bookingView(booking)),
    startTime: booking.activity.startTime,
    isLateCancellation: booking.activity.isLateCancellation,
    completionRequestedBy: completionBy(booking.activity.completionRequestedById, viewerId),
    role: isRider ? ("RIDER" as const) : ("PASSENGER" as const),
    offer: await offerView(booking.rideOffer, viewerId),
  };
}

// --- Listing (Ride page and Search a Ride)

// Candidates read per type before the exact distance and time filters.
const CANDIDATES = 500;

type Box = ReturnType<typeof boundingBox>;
const inBox = (box: Box | null, latField: string, lngField: string) =>
  box ? { [latField]: { gte: box.minLat, lte: box.maxLat }, [lngField]: { gte: box.minLng, lte: box.maxLng } } : {};

// The Asia/Dhaka day (B3a addition 5) and the time range on it. A time range
// without a date applies to every day.
function timeFilter(query: ListQuery, now: Date) {
  const range = query.date ? { gte: dhakaWallTime(query.date, 0, 0), lt: new Date(dhakaWallTime(query.date, 0, 0).getTime() + DAY) } : {};
  return { gt: now, ...range };
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const dhakaMinuteOfDay = (date: Date) => {
  const local = new Date(date.getTime() + 6 * 60 * 60 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

function matchesTime(start: Date, query: ListQuery) {
  if (!query.timeFrom && !query.timeTo) return true;
  const m = dhakaMinuteOfDay(start);
  return (!query.timeFrom || m >= minutes(query.timeFrom)) && (!query.timeTo || m <= minutes(query.timeTo));
}

function matchesPlace(point: LatLng, lat: number | undefined, lng: number | undefined, radiusKm: number) {
  return lat === undefined || lng === undefined || distanceKm(point, { lat, lng }) <= radiusKm;
}

export async function listRides(viewerId: string, query: ListQuery, now = new Date()) {
  const blocked = await blockedUserIds(prisma, viewerId);
  const pickupBox = query.pickupLat !== undefined && query.pickupLng !== undefined ? boundingBox({ lat: query.pickupLat, lng: query.pickupLng }, query.radiusKm) : null;
  const destinationBox =
    query.destinationLat !== undefined && query.destinationLng !== undefined ? boundingBox({ lat: query.destinationLat, lng: query.destinationLng }, query.radiusKm) : null;
  const when = timeFilter(query, now);
  const keep = (pickup: LatLng, destination: LatLng, start: Date) =>
    matchesPlace(pickup, query.pickupLat, query.pickupLng, query.radiusKm) &&
    matchesPlace(destination, query.destinationLat, query.destinationLng, query.radiusKm) &&
    matchesTime(start, query);

  const requests: RequestRow[] =
    query.type === "offers"
      ? []
      : await prisma.activity.findMany({
          where: {
            type: "RIDE_REQUEST",
            status: "OPEN",
            deletedAt: null,
            startTime: when,
            ...(blocked.length > 0 && { creatorId: { notIn: blocked } }),
            rideRequest: {
              ...(query.subAreaId && { subAreaId: query.subAreaId }),
              ...inBox(pickupBox, "pickupLat", "pickupLng"),
              ...inBox(destinationBox, "destinationLat", "destinationLng"),
            },
          },
          orderBy: [{ startTime: "asc" }, { id: "asc" }],
          take: CANDIDATES,
          select: requestSelect,
        });

  const offers: OfferRow[] =
    query.type === "requests"
      ? []
      : await prisma.rideOffer.findMany({
          where: {
            status: "OPEN",
            departureTime: when,
            // Only Active riders appear in matching (CLAUDE.md section 4)
            rider: { riderActive: true, accountStatus: "ACTIVE" },
            ...(blocked.length > 0 && { riderId: { notIn: blocked } }),
            ...(query.subAreaId && { subAreaId: query.subAreaId }),
            ...inBox(pickupBox, "pickupLat", "pickupLng"),
            ...inBox(destinationBox, "destinationLat", "destinationLng"),
          },
          orderBy: [{ departureTime: "asc" }, { id: "asc" }],
          take: CANDIDATES,
          select: offerSelect,
        });

  const items = [
    ...requests
      .filter((row) => {
        const r = row.rideRequest!;
        return keep({ lat: Number(r.pickupLat), lng: Number(r.pickupLng) }, { lat: Number(r.destinationLat), lng: Number(r.destinationLng) }, row.startTime);
      })
      .map((row) => ({ at: row.startTime, row, kind: "REQUEST" as const })),
    ...offers
      .filter((row) =>
        keep({ lat: Number(row.pickupLat), lng: Number(row.pickupLng) }, { lat: Number(row.destinationLat), lng: Number(row.destinationLng) }, row.departureTime),
      )
      .map((row) => ({ at: row.departureTime, row, kind: "OFFER" as const })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const size = rules.ride.pageSize;
  const page = items.slice((query.page - 1) * size, query.page * size);
  return {
    items: await Promise.all(page.map((item) => (item.kind === "REQUEST" ? requestView(item.row as RequestRow, viewerId) : offerView(item.row as OfferRow, viewerId)))),
    page: query.page,
    hasMore: items.length > query.page * size,
  };
}

// Limits the forms show (never hard-coded on the client)
export function rideConfig() {
  return {
    amount: rules.ride.amount,
    passengers: rules.ride.passengers,
    notesMaxLength: rules.ride.notesMaxLength,
    searchRadiusKm: rules.ride.searchRadiusKm,
    defaultSearchRadiusKm: rules.ride.defaultSearchRadiusKm,
    startAllowedBeforeMinutes: rules.ride.startAllowedBefore / 60000,
    earliestFromNowMinutes: rules.creationWindow.earliestFromNow / 60000,
    latestFromNowHours: rules.creationWindow.rideLatestFromNow / 3600000,
    seats: rules.seats,
  };
}
