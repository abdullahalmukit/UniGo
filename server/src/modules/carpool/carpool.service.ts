import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { removeTimerJobs, scheduleTimerJobs } from "../../jobs/scheduler.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { dateOnly, dateOnlyString, dhakaDateString } from "../../utils/time.js";
import { uuidv7 } from "../../utils/uuid.js";
import { publishChatEvents } from "../chat/chat-events.js";
import { postFoodMessage } from "../chat/chat-system.js";
import { assertNoTimeConflict } from "../activities/conflict.js";
import {
  activityNotFound,
  afterActivityCommit,
  applyTransition,
  assertCanAccept,
  assertNotBlocked,
  engineActivitySelect,
  recordCreation,
  transitionActivity,
  type TransitionOutcome,
} from "../activities/engine.js";
import { reserveCarpoolSeat } from "../activities/seats.js";
import { scheduleActivityTimers } from "../activities/timers.js";
import { lockUsers, runActivityTransaction, type Tx } from "../activities/transaction.js";
import { checkTransition } from "../activities/transitions.js";
import { boundingBox, distanceKm, type LatLng } from "../geo/distance.js";
import { notify } from "../notifications/notify.service.js";
import { assertActiveRider, usableVehicle } from "../ride/ride.service.js";
import { blockedUserIds, isBlockedBetween } from "../users/blocks.service.js";
import { participantPhone, participantPhones } from "../users/contact.js";
import {
  addDays,
  contractEndDate,
  holdExpiry,
  nextRideTime,
  runsOn,
  schedulesOverlap,
  sessionDates,
  sessionStart,
  tomorrow,
  type PostSchedule,
} from "./carpool-dates.js";
import { contractEndJob, holdReleaseJob, postCloseJob, sessionTimerSubjects } from "./carpool.jobs.js";
import type { BookingInput, PostEditInput, PostInput, SearchQuery } from "./carpool.validation.js";
import { bookingSelect, bookingView, postSelect, postView, scheduleOf, type PostRow } from "./carpool.views.js";

// Carpool (proposal section 9, B6a decisions). Status changes of booking
// requests, held seats and contracts go through the common engine; this
// module adds the carpool rules: Active riders, schedules that must not
// overlap, one seat per booking, start dates and contract months, the seat
// hold and the two Agrees, and the sessions of a contract.

// A booking that still holds its seat: held (ACCEPTED), under a contract
// (ACCEPTED + CONTRACT_ACTIVE), or disputed (B7)
const HOLDING = ["ACCEPTED", "DISPUTED"] as const;
// One request, held seat or contract per passenger per post
const ACTIVE_BOOKING = ["OPEN", "ACCEPTED", "DISPUTED"] as const;

const notFound = () => new AppError(404, "CARPOOL_NOT_FOUND", "This carpool was not found");
const decimal = (value: number) => new Prisma.Decimal(value.toFixed(2));
const toPoint = (p: { lat: number; lng: number }): LatLng => ({ lat: p.lat, lng: p.lng });

// Posts that count for the 12-schedule limit and the overlap check (B6a Q5,
// Q6): OPEN or FULL (paused ones too), and CLOSED ones that still hold a seat.
const livePosts = (riderId: string): Prisma.CarpoolPostWhereInput => ({
  riderId,
  OR: [{ status: { in: ["OPEN", "FULL"] } }, { status: "CLOSED", bookings: { some: { activity: { status: { in: [...HOLDING] } } } } }],
});

// --- Shared checks

// Post dates (B6a Q8): the first valid day from today up to 60 days ahead; the
// end date, if any, on or after it; and long enough for the shortest
// duration offered to fit from the earliest possible start.
function assertPostDates(schedule: PostSchedule, durations: number[], now: Date, options: { checkValidFrom: boolean }) {
  const today = dhakaDateString(now);
  if (options.checkValidFrom) {
    if (schedule.validFrom < today) throw dateError("validFrom", "VALID_FROM_IN_PAST", "Choose today or a later date");
    if (schedule.validFrom > addDays(today, rules.carpool.validFromMaxDaysAhead)) {
      throw dateError("validFrom", "VALID_FROM_TOO_LATE", `Choose a date within ${rules.carpool.validFromMaxDaysAhead} days`);
    }
  }
  if (schedule.validUntil) {
    if (schedule.validUntil < schedule.validFrom || schedule.validUntil < today) {
      throw dateError("validUntil", "VALID_UNTIL_BEFORE_FROM", "The end date must be on or after the start date");
    }
    const earliest = schedule.validFrom > tomorrow(now) ? schedule.validFrom : tomorrow(now);
    if (contractEndDate(earliest, Math.min(...durations)) > schedule.validUntil) {
      throw dateError("validUntil", "VALIDITY_TOO_SHORT", "The post must stay valid for at least the shortest duration you offer");
    }
  }
}

const dateError = (field: string, code: string, message: string) => new AppError(400, code, message, { fields: { [field]: [message] } });

// B6a Q5: at most 12 live posts per rider, and none overlapping another.
async function assertScheduleFree(tx: Tx, riderId: string, schedule: PostSchedule, options: { exceptPostId?: string; countLimit: boolean }) {
  const posts = await tx.carpoolPost.findMany({
    where: { ...livePosts(riderId), ...(options.exceptPostId && { id: { not: options.exceptPostId } }) },
    select: { id: true, daysOfWeek: true, departureMinute: true, validFrom: true, validUntil: true },
  });
  if (options.countLimit && posts.length >= rules.carpool.maxSchedulesPerRider) {
    throw new AppError(409, "SCHEDULE_LIMIT_REACHED", `You can have at most ${rules.carpool.maxSchedulesPerRider} carpool schedules`, {
      data: { max: rules.carpool.maxSchedulesPerRider },
    });
  }
  const overlapping = posts.find((post) => schedulesOverlap(schedule, scheduleOf(post)));
  if (overlapping) {
    throw new AppError(409, "SCHEDULE_OVERLAP", "This schedule is within 90 minutes of another of your carpool schedules on a shared day", {
      data: { postId: overlapping.id },
    });
  }
}

// Locks the post row for the rest of the transaction. Always after the users'
// rows (lockUsers), so every carpool transaction locks in the same order.
async function lockPost(tx: Tx, postId: string) {
  await tx.$queryRaw`SELECT id FROM carpool_posts WHERE id = ${postId} FOR UPDATE`;
  const post = await tx.carpoolPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      riderId: true,
      vehicleId: true,
      status: true,
      pausedAt: true,
      daysOfWeek: true,
      departureMinute: true,
      totalSeats: true,
      seatsAvailable: true,
      validFrom: true,
      validUntil: true,
      prices: { select: { durationMonths: true, monthlyPrice: true } },
    },
  });
  if (!post) throw notFound();
  return post;
}

type LockedPost = Awaited<ReturnType<typeof lockPost>>;

const holdingCount = (tx: Tx, postId: string) => tx.carpoolBooking.count({ where: { postId, activity: { status: { in: [...HOLDING] } } } });

// Pending booking requests are rejected when the rider changes or removes the
// post (B6a Q7); each passenger gets the normal "request declined" notice.
async function rejectPending(tx: Tx, riderId: string, postId: string, closure: "POST_CHANGED" | "POST_REMOVED", now: Date) {
  const pending = await tx.activity.findMany({
    where: { type: "CARPOOL_BOOKING", status: "OPEN", carpoolBooking: { postId } },
    select: engineActivitySelect,
  });
  const outcomes: TransitionOutcome[] = [];
  for (const activity of pending) {
    const outcome = await applyTransition(tx, activity, "REJECT_BOOKING", { type: "USER", id: riderId }, { now, quiet: true, data: { closureReason: closure } });
    if (outcome) outcomes.push(outcome);
  }
  return outcomes;
}

// Riders whose posts are not bookable answer RIDER_NOT_AVAILABLE to passengers.
async function assertRiderAvailable(tx: Tx, riderId: string, now: Date) {
  try {
    await assertActiveRider(tx, riderId, now);
  } catch {
    throw new AppError(409, "RIDER_NOT_AVAILABLE", "This rider is not taking bookings right now");
  }
}

// A start date and duration on a post (B6a Q2, Q4): from tomorrow, inside the
// post's validity, on one of its ride days, and the contract may not end after
// the post's end date. Returns the contract's end and its ride days.
export function planContract(post: { daysOfWeek: number; departureMinute: number; validFrom: Date; validUntil: Date | null }, startDate: string, months: number, now = new Date()) {
  const schedule = scheduleOf(post);
  const fail = (code: string, message: string) => new AppError(400, code, message, { fields: { startDate: [message] } });
  if (startDate < tomorrow(now)) throw fail("START_DATE_TOO_SOON", "Choose tomorrow or a later date");
  if (startDate < schedule.validFrom || (schedule.validUntil && startDate > schedule.validUntil)) {
    throw fail("START_DATE_OUTSIDE_POST", "Choose a date inside this carpool's dates");
  }
  if (!runsOn(schedule.daysOfWeek, startDate)) throw fail("START_DATE_NOT_A_RIDE_DAY", "Choose one of this carpool's ride days");
  const plan = planContractDays(schedule, startDate, months);
  if (schedule.validUntil && plan.endDate > schedule.validUntil) {
    throw new AppError(400, "CONTRACT_PAST_POST_END", "This duration would end after the carpool's end date", {
      fields: { durationMonths: ["This duration would end after the carpool's end date"] },
      data: { endDate: plan.endDate, validUntil: schedule.validUntil },
    });
  }
  return plan;
}

// --- Posts

async function loadPost(id: string) {
  const row = await prisma.carpoolPost.findUnique({ where: { id }, select: postSelect });
  if (!row) throw notFound();
  return row;
}

// The rider's cancelled carpool sessions (9.6), for each rider.
async function sessionCancellations(riderIds: readonly string[]) {
  if (riderIds.length === 0) return new Map<string, number>();
  const rows = await prisma.$queryRaw<{ riderId: string; n: bigint | number }[]>`
    SELECT creator_id AS riderId, COUNT(*) AS n FROM activities
    WHERE type = 'CARPOOL_SESSION' AND status = 'CANCELLED' AND cancelled_by_id = creator_id
      AND creator_id IN (${Prisma.join([...new Set(riderIds)])})
    GROUP BY creator_id`;
  return new Map(rows.map((row) => [row.riderId, Number(row.n)]));
}

export async function postViews(rows: PostRow[], viewerId: string, now = new Date()) {
  const counts = await sessionCancellations(rows.map((row) => row.riderId));
  return Promise.all(rows.map((row) => postView(row, viewerId, counts.get(row.riderId) ?? 0, now)));
}

export async function createCarpoolPost(riderId: string, input: PostInput, now = new Date()) {
  const schedule: PostSchedule = {
    daysOfWeek: input.daysOfWeek,
    departureMinute: input.departureMinute,
    validFrom: input.validFrom,
    validUntil: input.validUntil ?? null,
  };
  assertPostDates(
    schedule,
    input.prices.map((p) => p.durationMonths),
    now,
    { checkValidFrom: true },
  );

  const post = await runActivityTransaction(async (tx) => {
    // The rider's row is locked, so two posts sent together cannot both pass
    // the limit or the overlap check.
    await lockUsers(tx, [riderId]);
    await assertActiveRider(tx, riderId, now);
    await usableVehicle(tx, riderId, input.vehicleId, input.seats);
    await assertScheduleFree(tx, riderId, schedule, { countLimit: true });
    return tx.carpoolPost.create({
      data: {
        riderId,
        vehicleId: input.vehicleId,
        daysOfWeek: input.daysOfWeek,
        departureMinute: input.departureMinute,
        pickupAddress: input.pickup.address,
        pickupLat: decimal(input.pickup.lat),
        pickupLng: decimal(input.pickup.lng),
        destinationAddress: input.destination.address,
        destinationLat: decimal(input.destination.lat),
        destinationLng: decimal(input.destination.lng),
        totalSeats: input.seats,
        seatsAvailable: input.seats,
        notes: input.notes ?? null,
        validFrom: dateOnly(input.validFrom),
        validUntil: input.validUntil ? dateOnly(input.validUntil) : null,
        prices: { create: input.prices.map((p) => ({ durationMonths: p.durationMonths, monthlyPrice: decimal(p.monthlyPrice) })) },
      },
      select: { id: true, validUntil: true },
    });
  });

  if (post.validUntil) await scheduleTimerJobs([postCloseJob(post.id, dateOnlyString(post.validUntil))]);
  return getCarpoolPost(riderId, post.id, now);
}

// While nobody holds a seat everything can be edited; pending requests are
// then rejected (Q7). After a seat is held or a contract made, only "add
// seats" and pause / resume are allowed (POST_LOCKED).
export async function updateCarpoolPost(riderId: string, postId: string, input: PostEditInput, now = new Date()) {
  const result = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [riderId]);
    const post = await lockPost(tx, postId);
    if (post.riderId !== riderId) throw new AppError(403, "NOT_PARTICIPANT", "Only the rider can edit this carpool");
    if (post.status === "CLOSED") throw new AppError(409, "NOT_EDITABLE", "This carpool is closed");
    if ((await holdingCount(tx, postId)) > 0) {
      throw new AppError(409, "POST_LOCKED", "Someone holds a seat or has a contract on this carpool: you can only add seats or stop new bookings");
    }

    const before = scheduleOf(post);
    const schedule: PostSchedule = {
      daysOfWeek: input.daysOfWeek ?? before.daysOfWeek,
      departureMinute: input.departureMinute ?? before.departureMinute,
      validFrom: input.validFrom ?? before.validFrom,
      validUntil: input.validUntil !== undefined ? (input.validUntil ?? null) : before.validUntil,
    };
    const prices = input.prices ?? post.prices.map((p) => ({ durationMonths: p.durationMonths, monthlyPrice: Number(p.monthlyPrice) }));
    assertPostDates(
      schedule,
      prices.map((p) => p.durationMonths),
      now,
      { checkValidFrom: input.validFrom !== undefined && input.validFrom !== before.validFrom },
    );
    const seats = input.seats ?? post.totalSeats;
    const vehicleId = input.vehicleId ?? post.vehicleId;
    await assertActiveRider(tx, riderId, now);
    await usableVehicle(tx, riderId, vehicleId, seats);
    await assertScheduleFree(tx, riderId, schedule, { exceptPostId: postId, countLimit: false });

    if (input.prices) {
      await tx.carpoolPrice.deleteMany({ where: { postId } });
      await tx.carpoolPrice.createMany({ data: input.prices.map((p) => ({ postId, durationMonths: p.durationMonths, monthlyPrice: decimal(p.monthlyPrice) })) });
    }
    await tx.carpoolPost.update({
      where: { id: postId },
      data: {
        vehicleId,
        daysOfWeek: schedule.daysOfWeek,
        departureMinute: schedule.departureMinute,
        validFrom: dateOnly(schedule.validFrom),
        validUntil: schedule.validUntil ? dateOnly(schedule.validUntil) : null,
        totalSeats: seats,
        seatsAvailable: seats,
        status: "OPEN",
        ...(input.pickup && { pickupAddress: input.pickup.address, pickupLat: decimal(input.pickup.lat), pickupLng: decimal(input.pickup.lng) }),
        ...(input.destination && {
          destinationAddress: input.destination.address,
          destinationLat: decimal(input.destination.lat),
          destinationLng: decimal(input.destination.lng),
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
    });
    const outcomes = await rejectPending(tx, riderId, postId, "POST_CHANGED", now);
    return { outcomes, before: before.validUntil, after: schedule.validUntil };
  });

  await afterActivityCommit(result.outcomes);
  if (result.before !== result.after) {
    if (result.before) await removeTimerJobs([postCloseJob(postId, result.before).jobId]);
    if (result.after) await scheduleTimerJobs([postCloseJob(postId, result.after)]);
  }
  return getCarpoolPost(riderId, postId, now);
}

// Adding seats works at any time, up to the vehicle's capacity (proposal 9.4).
export async function addCarpoolSeats(riderId: string, postId: string, seats: number, now = new Date()) {
  await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [riderId]);
    const post = await lockPost(tx, postId);
    if (post.riderId !== riderId) throw new AppError(403, "NOT_PARTICIPANT", "Only the rider can change this carpool");
    if (post.status === "CLOSED") throw new AppError(409, "POST_CLOSED", "This carpool is closed");
    if (seats <= post.totalSeats) throw new AppError(400, "SEATS_NOT_HIGHER", "Choose more seats than now", { fields: { seats: ["Choose more seats than now"] } });
    await usableVehicle(tx, riderId, post.vehicleId, seats);
    await tx.carpoolPost.update({
      where: { id: postId },
      data: { totalSeats: seats, seatsAvailable: { increment: seats - post.totalSeats }, ...(post.status === "FULL" && { status: "OPEN" }) },
    });
  });
  return getCarpoolPost(riderId, postId, now);
}

// B6a Q6: "Stop new bookings" pauses the post (paused_at); its status stays
// OPEN or FULL, so a released seat still reopens it. Resume while it is not
// CLOSED. Paused posts are not listed and take no new requests or accepts.
export async function setCarpoolPaused(riderId: string, postId: string, paused: boolean, now = new Date()) {
  await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [riderId]);
    const post = await lockPost(tx, postId);
    if (post.riderId !== riderId) throw new AppError(403, "NOT_PARTICIPANT", "Only the rider can change this carpool");
    if (post.status === "CLOSED") throw new AppError(409, "POST_CLOSED", "This carpool is closed");
    if (paused !== (post.pausedAt !== null)) await tx.carpoolPost.update({ where: { id: postId }, data: { pausedAt: paused ? now : null } });
  });
  return getCarpoolPost(riderId, postId, now);
}

// Remove (CLOSED, final): refused while someone holds a seat or has a
// contract; pending requests are rejected (Q7).
export async function removeCarpoolPost(riderId: string, postId: string, now = new Date()) {
  const result = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [riderId]);
    const post = await lockPost(tx, postId);
    if (post.riderId !== riderId) throw new AppError(403, "NOT_PARTICIPANT", "Only the rider can remove this carpool");
    if (post.status === "CLOSED") throw new AppError(409, "POST_CLOSED", "This carpool is already closed");
    if ((await holdingCount(tx, postId)) > 0) {
      throw new AppError(409, "POST_HAS_CONTRACTS", "Someone holds a seat or has a contract on this carpool. It cannot be removed.");
    }
    const outcomes = await rejectPending(tx, riderId, postId, "POST_REMOVED", now);
    await tx.carpoolPost.update({ where: { id: postId }, data: { status: "CLOSED", closedAt: now, closeReason: "REMOVED_BY_RIDER" } });
    return { outcomes, validUntil: post.validUntil };
  });
  await afterActivityCommit(result.outcomes);
  if (result.validUntil) await removeTimerJobs([postCloseJob(postId, dateOnlyString(result.validUntil)).jobId]);
  return getCarpoolPost(riderId, postId, now);
}

// The rider sees every booking; a passenger only their own (B3a addition 2).
// Others see a post that is not CLOSED, never across a block.
export async function getCarpoolPost(viewerId: string, postId: string, now = new Date()) {
  const row = await loadPost(postId);
  const isRider = row.riderId === viewerId;
  const bookings = await prisma.carpoolBooking.findMany({
    where: { postId, ...(!isRider && { activity: { accepterId: viewerId } }) },
    orderBy: { createdAt: "asc" },
    select: bookingSelect,
  });
  if (!isRider && bookings.length === 0) {
    if (row.status === "CLOSED" || (await isBlockedBetween(prisma, viewerId, row.riderId))) throw notFound();
  }
  const views = await Promise.all(bookings.map((b) => bookingView(b, viewerId)));
  const phones = await participantPhones(
    viewerId,
    bookings.map((b) => ({ otherId: isRider ? b.activity.accepterId : b.activity.creatorId, status: b.activity.status })),
  );
  const withPhones = views.map((view, i) => ({ ...view, phone: phones[i] ?? null }));
  const [view] = await postViews([row], viewerId, now);
  const active = withPhones.filter((b) => (ACTIVE_BOOKING as readonly string[]).includes(b.status));
  return {
    ...view!,
    bookings: isRider ? withPhones : [],
    myBooking: isRider ? null : (active.at(-1) ?? withPhones.at(-1) ?? null),
  };
}

// What a booking would be: its end date, ride days and price (the form's summary).
export async function quoteCarpoolBooking(postId: string, input: BookingInput, now = new Date()) {
  const post = await prisma.carpoolPost.findUnique({
    where: { id: postId },
    select: { daysOfWeek: true, departureMinute: true, validFrom: true, validUntil: true, prices: { select: { durationMonths: true, monthlyPrice: true } } },
  });
  if (!post) throw notFound();
  const price = post.prices.find((p) => p.durationMonths === input.durationMonths);
  if (!price) throw durationNotOffered();
  const plan = planContract(post, input.startDate, input.durationMonths, now);
  return {
    startDate: input.startDate,
    endDate: plan.endDate,
    sessions: plan.dates.length,
    firstRide: plan.starts[0] ?? null,
    monthlyPrice: Number(price.monthlyPrice),
    total: Number(price.monthlyPrice) * input.durationMonths,
  };
}

const durationNotOffered = () =>
  new AppError(400, "DURATION_NOT_OFFERED", "This carpool does not offer that duration", { fields: { durationMonths: ["Choose a duration this carpool offers"] } });

// --- Booking requests

// One seat, a duration and a start date (proposal 9.3 step 1). The request is
// OPEN until the rider answers; it expires at its first ride (Q3). Carpool
// bookings are outside the open and daily limits (15.5).
export async function requestCarpoolBooking(passengerId: string, postId: string, input: BookingInput, now = new Date()) {
  const known = await prisma.carpoolPost.findUnique({ where: { id: postId }, select: { riderId: true } });
  if (!known) throw notFound();
  if (known.riderId === passengerId) throw new AppError(403, "OWN_ITEM", "You cannot book your own carpool");

  const activity = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [known.riderId, passengerId]);
    const post = await lockPost(tx, postId);
    assertBookable(post);
    if (post.status === "FULL") throw new AppError(409, "POST_FULL", "Every seat on this carpool is taken");
    await assertRiderAvailable(tx, post.riderId, now);
    await assertCanAccept(tx, passengerId, now);
    await assertNotBlocked(tx, post.riderId, passengerId);
    const price = post.prices.find((p) => p.durationMonths === input.durationMonths);
    if (!price) throw durationNotOffered();
    const plan = planContract(post, input.startDate, input.durationMonths, now);

    const existing = await tx.carpoolBooking.findFirst({
      where: { postId, activity: { accepterId: passengerId, status: { in: [...ACTIVE_BOOKING] } } },
      select: { activityId: true },
    });
    if (existing) throw new AppError(409, "ALREADY_BOOKED", "You already have a request or a seat on this carpool", { data: { activityId: existing.activityId } });

    const created = await tx.activity.create({
      data: {
        type: "CARPOOL_BOOKING",
        status: "OPEN",
        startTime: plan.starts[0]!,
        // Its sessions block time, not the booking (B2a decision 12)
        blocksTime: false,
        creatorId: post.riderId,
        accepterId: passengerId,
        conflictGroupId: postId,
        carpoolBooking: {
          create: { postId, durationMonths: input.durationMonths, monthlyPrice: price.monthlyPrice, startDate: dateOnly(input.startDate) },
        },
      },
      select: engineActivitySelect,
    });
    await recordCreation(tx, created, { type: "USER", id: passengerId });
    return created;
  });

  await scheduleActivityTimers([activity]);
  await notifyBookingRequested(activity.id, known.riderId, passengerId);
  return getCarpoolBooking(passengerId, activity.id, now);
}

function assertBookable(post: LockedPost) {
  if (post.status === "CLOSED") throw new AppError(409, "POST_CLOSED", "This carpool is closed");
  if (post.pausedAt) throw new AppError(409, "POST_PAUSED", "This carpool is not taking new bookings right now");
}

// Section 14: "New carpool booking request" -> rider, in-app + push.
async function notifyBookingRequested(activityId: string, riderId: string, passengerId: string) {
  const profile = await prisma.profile.findUnique({ where: { userId: passengerId }, select: { fullName: true } });
  await notify({
    type: "CARPOOL_BOOKING_REQUESTED",
    userIds: [riderId],
    dedupeKey: `CARPOOL_BOOKING_REQUESTED:${activityId}`,
    activityId,
    data: { activityType: "CARPOOL_BOOKING", name: profile?.fullName },
  });
}

// Loads a carpool booking's activity with its participants' rows locked.
async function lockBooking(tx: Tx, activityId: string) {
  const known = await tx.activity.findFirst({ where: { id: activityId, type: "CARPOOL_BOOKING" }, select: { creatorId: true, accepterId: true } });
  if (!known?.accepterId) throw activityNotFound();
  await lockUsers(tx, [known.creatorId, known.accepterId]);
  const activity = await tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: engineActivitySelect });
  const booking = await tx.carpoolBooking.findUniqueOrThrow({
    where: { activityId },
    select: { id: true, postId: true, durationMonths: true, monthlyPrice: true, startDate: true, holdExpiresAt: true, riderAgreedAt: true, passengerAgreedAt: true },
  });
  return { activity, booking };
}

// The rider accepts (proposal 9.3 steps 2-3): the seat is held, the chat
// opens, and every ride day of the contract-to-be is checked against both
// users' activities (TIME_CONFLICT lists the clashing dates). The hold ends
// 24 hours later or at the first ride, whichever is sooner (Q1).
export async function acceptCarpoolBooking(riderId: string, activityId: string, now = new Date()) {
  const actor = { type: "USER" as const, id: riderId };
  const result = await runActivityTransaction(async (tx) => {
    const { activity, booking } = await lockBooking(tx, activityId);
    checkTransition(activity, "ACCEPT_BOOKING", actor);
    if (activity.startTime <= now) throw new AppError(409, "START_TIME_PASSED", "This request's start date has passed");
    const post = await lockPost(tx, booking.postId);
    assertBookable(post);
    await assertActiveRider(tx, riderId, now);
    await usableVehicle(tx, riderId, post.vehicleId, post.totalSeats);
    await assertCanAccept(tx, riderId, now);
    await assertCanAccept(tx, activity.accepterId!, now);
    await assertNotBlocked(tx, riderId, activity.accepterId!);
    // One seat, by conditional update (ALREADY_TAKEN when none is left)
    await reserveCarpoolSeat(tx, booking.postId, now);

    // The request's dates were checked when it was made; the post cannot
    // have changed since (an edit rejects pending requests).
    const plan = planContractDays(post, dateOnlyString(booking.startDate), booking.durationMonths);
    const holdExpiresAt = holdExpiry(now, activity.startTime);
    const outcome = await applyTransition(tx, activity, "ACCEPT_BOOKING", actor, { now, data: { acceptedAt: now } });
    await tx.carpoolBooking.update({ where: { activityId }, data: { holdExpiresAt } });
    await assertNoTimeConflict(tx, {
      userIds: [riderId, activity.accepterId!],
      slots: plan.starts,
      conflictGroupId: booking.postId,
      listDates: true,
    });
    return { outcome, holdExpiresAt };
  });

  await afterActivityCommit([result.outcome]);
  await scheduleTimerJobs([holdReleaseJob(activityId, result.holdExpiresAt)]);
  return getCarpoolBooking(riderId, activityId, now);
}

// The rider declines a request; the reason is optional and shown to the passenger.
export async function rejectCarpoolBooking(riderId: string, activityId: string, reason: string | null, now = new Date()) {
  const outcome = await prisma.$transaction(async (tx) => {
    const activity = await tx.activity.findFirst({ where: { id: activityId, type: "CARPOOL_BOOKING" }, select: engineActivitySelect });
    if (!activity) throw activityNotFound();
    const result = await applyTransition(tx, activity, "REJECT_BOOKING", { type: "USER", id: riderId }, { now });
    await tx.carpoolBooking.update({ where: { activityId }, data: { rejectionReason: reason } });
    return result;
  });
  await afterActivityCommit([outcome]);
  return getCarpoolBooking(riderId, activityId, now);
}

// The passenger takes back a request the rider has not answered.
export async function withdrawCarpoolBooking(passengerId: string, activityId: string, now = new Date()) {
  const activity = await prisma.activity.findFirst({ where: { id: activityId, type: "CARPOOL_BOOKING" }, select: { id: true } });
  if (!activity) throw activityNotFound();
  await transitionActivity(activityId, "WITHDRAW_BOOKING", { type: "USER", id: passengerId }, { now });
  return getCarpoolBooking(passengerId, activityId, now);
}

// --- Agree and contract

// Both press Agree while the seat is held (proposal 9.3 step 4). The first
// Agree is recorded and the other person is told (Q11); there is no
// "un-agree". The second creates the contract (CONTRACT_ACTIVE) and a session
// for every ride day, after checking every ride day again for both users.
export async function agreeCarpoolBooking(userId: string, activityId: string, now = new Date()) {
  const actor = { type: "USER" as const, id: userId };
  const result = await runActivityTransaction(async (tx) => {
    const { activity, booking } = await lockBooking(tx, activityId);
    const riderId = activity.creatorId;
    const passengerId = activity.accepterId!;
    if (userId !== riderId && userId !== passengerId) throw new AppError(403, "NOT_PARTICIPANT", "You are not part of this activity");
    checkTransition(activity, "AGREE_CONTRACT", actor);
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) throw new AppError(409, "HOLD_EXPIRED", "The seat hold has ended");
    const isRider = userId === riderId;
    const mine = isRider ? booking.riderAgreedAt : booking.passengerAgreedAt;
    const other = isRider ? booking.passengerAgreedAt : booking.riderAgreedAt;
    if (mine) throw new AppError(409, "ALREADY_AGREED", "You have already agreed. Waiting for the other person.");
    await assertCanAccept(tx, userId, now);
    const field = isRider ? "riderAgreedAt" : "passengerAgreedAt";
    const marked = await tx.carpoolBooking.updateMany({ where: { activityId, [field]: null }, data: { [field]: now } });
    if (marked.count === 0) throw new AppError(409, "ALREADY_AGREED", "You have already agreed. Waiting for the other person.");

    if (!other) {
      const chatEvent = await postFoodMessage(tx, activity, { kind: "SYSTEM", code: "CONTRACT_AGREED", senderId: userId });
      return { kind: "AGREED" as const, chatEvent, otherId: isRider ? passengerId : riderId, holdExpiresAt: booking.holdExpiresAt };
    }

    // The second Agree: the contract. Checked again with both users locked.
    const post = await lockPost(tx, booking.postId);
    if (isRider) await assertActiveRider(tx, riderId, now);
    else await assertRiderAvailable(tx, riderId, now);
    await usableVehicle(tx, riderId, post.vehicleId, post.totalSeats);
    await assertCanAccept(tx, riderId, now);
    await assertCanAccept(tx, passengerId, now);
    await assertNotBlocked(tx, riderId, passengerId);
    const startDate = dateOnlyString(booking.startDate);
    const plan = planContractDays(post, startDate, booking.durationMonths);
    await assertNoTimeConflict(tx, { userIds: [riderId, passengerId], slots: plan.starts, conflictGroupId: booking.postId, listDates: true });

    const outcome = await applyTransition(tx, activity, "AGREE_CONTRACT", actor, { now });
    const contract = await tx.carpoolContract.create({
      data: {
        bookingId: booking.id,
        startDate: booking.startDate,
        endDate: dateOnly(plan.endDate),
        durationMonths: booking.durationMonths,
        monthlyPrice: booking.monthlyPrice,
      },
      select: { id: true, endDate: true },
    });
    const sessions = await createSessions(tx, { contractId: contract.id, postId: booking.postId, riderId, passengerId, dates: plan.dates, starts: plan.starts, now });
    return { kind: "CONTRACT" as const, outcome, sessions, contract, holdExpiresAt: booking.holdExpiresAt };
  });

  if (result.kind === "AGREED") {
    publishChatEvents(result.chatEvent ? [result.chatEvent] : []);
    await notifyAgreed(activityId, userId, result.otherId, result.holdExpiresAt);
  } else {
    await afterActivityCommit([result.outcome]);
    await removeTimerJobs([holdReleaseJob(activityId, result.holdExpiresAt).jobId]);
    await scheduleActivityTimers(sessionTimerSubjects(result.sessions, now));
    await scheduleTimerJobs([contractEndJob(result.contract.id, dateOnlyString(result.contract.endDate))]);
  }
  return getCarpoolBooking(userId, activityId, now);
}

// The contract's ride days, without the "from tomorrow" rule: the request was
// valid when it was made and the hold ends before the first ride.
function planContractDays(post: { daysOfWeek: number; departureMinute: number }, startDate: string, months: number) {
  const endDate = contractEndDate(startDate, months);
  const dates = sessionDates(startDate, endDate, post.daysOfWeek);
  return { endDate, dates, starts: dates.map((date) => sessionStart(date, post.departureMinute)) };
}

// One ACCEPTED CARPOOL_SESSION activity per ride day (proposal 9.3 step 5),
// in the post's conflict group, written in bulk. Rider = creator, passenger =
// accepter, as for the booking (A2 decision 7).
async function createSessions(
  tx: Tx,
  input: { contractId: string; postId: string; riderId: string; passengerId: string; dates: string[]; starts: Date[]; now: Date },
) {
  const rows = input.dates.map((date, i) => ({ id: uuidv7(input.now.getTime()), date, startTime: input.starts[i]! }));
  await tx.activity.createMany({
    data: rows.map((row) => ({
      id: row.id,
      type: "CARPOOL_SESSION" as const,
      status: "ACCEPTED" as const,
      startTime: row.startTime,
      blocksTime: true,
      creatorId: input.riderId,
      accepterId: input.passengerId,
      acceptedAt: input.now,
      conflictGroupId: input.postId,
    })),
  });
  await tx.carpoolSession.createMany({ data: rows.map((row) => ({ activityId: row.id, contractId: input.contractId, sessionDate: dateOnly(row.date) })) });
  await tx.activityStatusHistory.createMany({
    data: rows.map((row) => ({ activityId: row.id, fromStatus: null, toStatus: "ACCEPTED" as const, actorType: "SYSTEM" as const, actorId: null })),
  });
  return rows.map((row) => ({ id: row.id, startTime: row.startTime }));
}

// B6a (Q11): the first Agree tells the other person, in-app + push.
async function notifyAgreed(activityId: string, userId: string, otherId: string, holdExpiresAt: Date) {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { fullName: true } });
  const chat = await prisma.chat.findUnique({ where: { activityId }, select: { id: true } });
  await notify({
    type: "CARPOOL_AGREE_REQUESTED",
    userIds: [otherId],
    dedupeKey: `CARPOOL_AGREE_REQUESTED:${activityId}`,
    activityId,
    data: { activityType: "CARPOOL_BOOKING", name: profile?.fullName, endsAt: holdExpiresAt.toISOString(), chatId: chat?.id },
  });
}

// --- Reading

// One booking, for its two participants: the request, the hold, the contract
// and its sessions.
export async function getCarpoolBooking(viewerId: string, activityId: string, now = new Date()) {
  const row = await prisma.carpoolBooking.findUnique({ where: { activityId }, select: { ...bookingSelect, post: { select: postSelect } } });
  if (!row || (row.activity.creatorId !== viewerId && row.activity.accepterId !== viewerId)) throw notFound();
  const isRider = row.activity.creatorId === viewerId;
  const sessions = row.contract
    ? await prisma.carpoolSession.findMany({
        where: { contractId: row.contract.id },
        orderBy: { sessionDate: "asc" },
        select: { sessionDate: true, activity: { select: { id: true, status: true, startTime: true, cancelledById: true } } },
      })
    : [];
  const [post] = await postViews([row.post], viewerId, now);
  return {
    ...(await bookingView(row, viewerId)),
    phone: await participantPhone(viewerId, isRider ? row.activity.accepterId : row.activity.creatorId, row.activity.status),
    post: post!,
    sessions: sessions.map((s) => ({
      activityId: s.activity.id,
      date: dateOnlyString(s.sessionDate),
      startTime: s.activity.startTime,
      status: s.activity.status,
      cancelledBy: !s.activity.cancelledById ? null : s.activity.cancelledById === viewerId ? ("ME" as const) : ("OTHER" as const),
    })),
  };
}

// --- Search

const CANDIDATES = 500;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
type Box = ReturnType<typeof boundingBox>;
const inBox = (box: Box | null, latField: string, lngField: string) =>
  box ? { [latField]: { gte: box.minLat, lte: box.maxLat }, [lngField]: { gte: box.minLng, lte: box.maxLng } } : {};
const near = (point: LatLng, lat: number | undefined, lng: number | undefined, radiusKm: number) =>
  lat === undefined || lng === undefined || distanceKm(point, { lat, lng }) <= radiusKm;

// Search (proposal 9.1): a weekday, a time range, and pickup and destination
// within 1, 2 or 5 km; alone or together; no filter lists every bookable
// post. Only OPEN, not paused, still valid posts of Active riders, never
// across a block. No map (B3b-1 #5).
export async function searchCarpools(viewerId: string, query: SearchQuery, now = new Date()) {
  const blocked = await blockedUserIds(prisma, viewerId);
  const box = (lat?: number, lng?: number) => (lat !== undefined && lng !== undefined ? boundingBox({ lat, lng }, query.radiusKm) : null);
  const rows = await prisma.carpoolPost.findMany({
    where: {
      status: "OPEN",
      pausedAt: null,
      rider: { riderActive: true, accountStatus: "ACTIVE" },
      OR: [{ validUntil: null }, { validUntil: { gte: dateOnly(tomorrow(now)) } }],
      ...(blocked.length > 0 && { riderId: { notIn: blocked } }),
      ...((query.timeFrom || query.timeTo) && {
        departureMinute: { ...(query.timeFrom && { gte: minutes(query.timeFrom) }), ...(query.timeTo && { lte: minutes(query.timeTo) }) },
      }),
      ...inBox(box(query.pickupLat, query.pickupLng), "pickupLat", "pickupLng"),
      ...inBox(box(query.destinationLat, query.destinationLng), "destinationLat", "destinationLng"),
    },
    orderBy: [{ departureMinute: "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: postSelect,
  });
  const matching = rows
    .filter((row) => query.day === undefined || (row.daysOfWeek & (1 << query.day)) !== 0)
    .filter(
      (row) =>
        near({ lat: Number(row.pickupLat), lng: Number(row.pickupLng) }, query.pickupLat, query.pickupLng, query.radiusKm) &&
        near({ lat: Number(row.destinationLat), lng: Number(row.destinationLng) }, query.destinationLat, query.destinationLng, query.radiusKm),
    )
    .map((row) => ({ row, next: nextRideTime(scheduleOf(row), now) }))
    .filter((item) => item.next !== null)
    .sort((a, b) => a.next!.getTime() - b.next!.getTime());

  const size = rules.carpool.pageSize;
  const page = matching.slice((query.page - 1) * size, query.page * size).map((item) => item.row);
  return { items: await postViews(page, viewerId, now), page: query.page, hasMore: matching.length > query.page * size };
}

// Limits the forms show (never hard-coded on the client)
export function carpoolConfig() {
  return {
    maxSchedules: rules.carpool.maxSchedulesPerRider,
    durationMonths: rules.carpool.durationMonths,
    monthlyPrice: rules.carpool.monthlyPrice,
    notesMaxLength: rules.carpool.notesMaxLength,
    validFromMaxDaysAhead: rules.carpool.validFromMaxDaysAhead,
    rejectReasonMaxLength: rules.carpool.rejectReasonMaxLength,
    seatHoldHours: rules.carpool.seatHold / 3600000,
    searchRadiusKm: rules.carpool.searchRadiusKm,
    defaultSearchRadiusKm: rules.carpool.defaultSearchRadiusKm,
    seats: rules.seats,
  };
}
