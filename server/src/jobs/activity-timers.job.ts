import { rules } from "../config/rules.js";
import { prisma } from "../lib/prisma.js";
import { transitionActivity } from "../modules/activities/engine.js";
import { NOT_COMPLETION_REQUESTED, NOT_MARKED_TYPES, OPEN_REQUEST_TYPES } from "../modules/activities/transitions.js";
import { deliverNotification } from "../modules/notifications/notify.service.js";
import { sendMissedReminders } from "./reminders.job.js";

// Handlers of the delayed activity jobs and the safety-net sweeper
// (CLAUDE.md section 8, B2a decisions 10 and 11). Each handler re-reads the
// activity and changes it only if it still qualifies now; the change itself is
// a conditional UPDATE. Running any of them twice changes nothing the second
// time.

const SYSTEM = { type: "SYSTEM" } as const;
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);

// An OPEN item that reached its start time with no accepter (5.6).
export async function runExpireJob(activityId: string, now = new Date()) {
  const outcome = await transitionActivity(activityId, "EXPIRE", SYSTEM, { now, quiet: true, where: { startTime: { lte: now } } });
  return outcome !== null;
}

// Still ACCEPTED 6 hours after start (5.4). The transition table allows it
// only from ACCEPTED without COMPLETION_REQUESTED, so IN_PROGRESS, DISPUTED,
// COMPLETION_REQUESTED and terminal items are never closed.
export async function runNotMarkedJob(activityId: string, now = new Date()) {
  const outcome = await transitionActivity(activityId, "MARK_NOT_MARKED", SYSTEM, {
    now,
    quiet: true,
    where: { startTime: { lte: ago(now, rules.activity.notMarkedAfterStart) } },
  });
  return outcome !== null;
}

// No answer 24 hours after a completion request (5.3). A dispute moved it to
// DISPUTED, so it no longer applies.
export async function runAutoCompleteJob(activityId: string, now = new Date()) {
  const outcome = await transitionActivity(activityId, "AUTO_COMPLETE", SYSTEM, {
    now,
    quiet: true,
    where: { completionRequestedAt: { lte: ago(now, rules.activity.autoCompleteAfter) } },
  });
  return outcome !== null;
}

// An OPEN or FULL ride offer closes at its departure time (B2a decision 7).
// Bookings already made on it carry on.
export async function runCloseRideOfferJob(offerId: string, now = new Date()) {
  const closed = await prisma.rideOffer.updateMany({
    where: { id: offerId, status: { in: ["OPEN", "FULL"] }, departureTime: { lte: now } },
    data: { status: "CLOSED", closedAt: now },
  });
  return closed.count === 1;
}

// Catches everything a lost delayed job should have done (Redis data lost,
// server down at the due time). Runs every rules.jobs.sweepInterval and uses
// the same handlers, so it never does anything a job would not.
export async function runActivitySweep(now = new Date()) {
  const take = rules.jobs.sweepBatch;
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  const toExpire = await prisma.activity.findMany({
    where: { type: { in: [...OPEN_REQUEST_TYPES] }, status: "OPEN", deletedAt: null, startTime: { lte: now } },
    select: { id: true },
    take,
  });
  const toNotMark = await prisma.activity.findMany({
    where: {
      type: { in: [...NOT_MARKED_TYPES] },
      status: "ACCEPTED",
      deletedAt: null,
      startTime: { lte: ago(now, rules.activity.notMarkedAfterStart) },
      OR: [{ subStatus: null }, { subStatus: { in: NOT_COMPLETION_REQUESTED.filter((sub) => sub !== null) } }],
    },
    select: { id: true },
    take,
  });
  const toComplete = await prisma.activity.findMany({
    where: {
      status: "IN_PROGRESS",
      subStatus: "COMPLETION_REQUESTED",
      deletedAt: null,
      completionRequestedAt: { lte: ago(now, rules.activity.autoCompleteAfter) },
    },
    select: { id: true },
    take,
  });

  let expired = 0;
  let notMarked = 0;
  let autoCompleted = 0;
  for (const id of ids(toExpire)) if (await runExpireJob(id, now)) expired += 1;
  for (const id of ids(toNotMark)) if (await runNotMarkedJob(id, now)) notMarked += 1;
  for (const id of ids(toComplete)) if (await runAutoCompleteJob(id, now)) autoCompleted += 1;

  const offers = await prisma.rideOffer.updateMany({
    where: { status: { in: ["OPEN", "FULL"] }, departureTime: { lte: now } },
    data: { status: "CLOSED", closedAt: now },
  });

  // B2c: reminders that are due but were never sent, and push or email rows a
  // lost delivery job left PENDING.
  const remindersSent = await sendMissedReminders(now);
  const notificationsDelivered = await deliverStaleNotifications(now);

  return { expired, notMarked, autoCompleted, rideOffersClosed: offers.count, remindersSent, notificationsDelivered };
}

// A row still PENDING this long after it was written lost its job (Redis
// data lost, server down). Sent once; rows older than a day are left alone.
const STALE_AFTER = 2 * 60 * 1000;
const GIVE_UP_AFTER = 24 * 60 * 60 * 1000;

async function deliverStaleNotifications(now: Date) {
  const rows = await prisma.notification.findMany({
    where: { status: "PENDING", channel: { in: ["PUSH", "EMAIL"] }, createdAt: { lte: ago(now, STALE_AFTER), gt: ago(now, GIVE_UP_AFTER) } },
    select: { id: true },
    take: rules.jobs.sweepBatch,
  });
  let delivered = 0;
  for (const { id } of rows) {
    try {
      if (await deliverNotification(id, { lastAttempt: true })) delivered += 1;
    } catch {
      // Recorded as FAILED on the row
    }
  }
  return delivered;
}
