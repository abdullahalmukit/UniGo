import { rules } from "../../config/rules.js";
import type { ActivitySubStatus, ActivityType, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { effectiveAccountStatus } from "../auth/account-status.js";
import { publishChatEvents, type ChatEvent } from "../chat/chat-events.js";
import { postTransitionMessage } from "../chat/chat-system.js";
import { assertNoTimeConflict } from "./conflict.js";
import { emitActivityTransitions, type ActivityTransitionEvent } from "./events.js";
import { releaseCarpoolSeat, releaseRideOfferSeats } from "./seats.js";
import { blocksTimeFor, isLateCancellation } from "./time-rules.js";
import { replaceActivityTimers } from "./timers.js";
import { lockUsers, runActivityTransaction, type Tx } from "./transaction.js";
import {
  checkTransition,
  findRule,
  invalidTransition,
  isTransitionAllowed,
  type ActivityAction,
  type ActorRef,
} from "./transitions.js";

// The common activity engine (CLAUDE.md section 5). Feature modules change an
// activity's status only through these functions.

export const engineActivitySelect = {
  id: true,
  type: true,
  status: true,
  subStatus: true,
  creatorId: true,
  accepterId: true,
  completionRequestedById: true,
  completionRequestedAt: true,
  startTime: true,
  blocksTime: true,
  conflictGroupId: true,
  deletedAt: true,
} as const satisfies Prisma.ActivitySelect;

export type EngineActivity = Prisma.ActivityGetPayload<{ select: typeof engineActivitySelect }>;

export type TransitionOutcome = {
  before: EngineActivity;
  activity: EngineActivity;
  events: ActivityTransitionEvent[];
  // System messages written in the transaction, pushed to sockets after commit
  chatEvents: ChatEvent[];
};

export type TransitionOptions = {
  reason?: string;
  now?: Date;
  // Extra columns to set with the status change (a feature's own fields)
  data?: Prisma.ActivityUncheckedUpdateManyInput;
  // Extra conditions the row must still meet, e.g. a job's time condition
  where?: Prisma.ActivityWhereInput;
  // For jobs: return null instead of throwing when the change does not apply
  quiet?: boolean;
  // Keep the reason in activity_status_history only: it is not stored on the
  // activity and not shown in the chat (cancelling because of a block, B2b
  // decision 8). The other user sees only "Cancelled by the other user".
  hideReason?: boolean;
};

// Applies one action from the transition table inside the caller's
// transaction. The UPDATE is conditional on the status and sub-status that
// were read, so a concurrent change makes it fail instead of being overwritten.
// Writes activity_status_history in the same transaction.
export async function applyTransition(
  tx: Tx,
  activity: EngineActivity,
  action: ActivityAction,
  actor: ActorRef,
  options: TransitionOptions = {},
): Promise<TransitionOutcome | null> {
  const now = options.now ?? new Date();
  if (options.quiet && !isTransitionAllowed(activity, action, actor)) return null;
  const rule = options.quiet ? findRule(activity.type, action)! : checkTransition(activity, action, actor);

  // B3a decision (Q4): a ride can be started from 30 minutes before its start time.
  if (action === "START" && (activity.type === "RIDE_REQUEST" || activity.type === "RIDE_BOOKING")) {
    if (now.getTime() < activity.startTime.getTime() - rules.ride.startAllowedBefore) {
      throw new AppError(409, "START_TOO_EARLY", "You can start the ride from 30 minutes before its time");
    }
  }

  const reason = options.reason?.trim() || undefined;
  if (rule.reasonRequired && !reason) {
    throw new AppError(400, "REASON_REQUIRED", "Give a reason", { fields: { reason: ["Give a reason"] } });
  }

  const status = rule.to.status;
  const subStatus = rule.to.subStatus === undefined ? activity.subStatus : rule.to.subStatus;
  const actorId = actor.type === "SYSTEM" ? null : actor.id;

  const data: Prisma.ActivityUncheckedUpdateManyInput = { status, subStatus };
  if (status === "IN_PROGRESS" && activity.status !== "IN_PROGRESS") data.startedAt = now;
  if (subStatus === "COMPLETION_REQUESTED" && activity.subStatus !== "COMPLETION_REQUESTED") {
    data.completionRequestedAt = now;
    data.completionRequestedById = actorId;
  }
  if (status === "COMPLETED") data.completedAt = now;
  if (status === "CANCELLED") {
    data.cancelledAt = now;
    data.cancelledById = actorId;
    data.cancellationReason = options.hideReason ? null : (reason ?? null);
    // Late cancellation applies only after acceptance (CLAUDE.md 5.8)
    if (actor.type === "USER" && activity.status !== "OPEN") data.isLateCancellation = isLateCancellation(activity.startTime, now);
  }
  if (rule.closure) data.closureReason = rule.closure;
  if (actor.type === "SYSTEM") data.autoClosedAt = now;
  if (action === "DELETE") data.deletedAt = now;
  Object.assign(data, options.data);

  const updated = await tx.activity.updateMany({
    where: { id: activity.id, status: activity.status, subStatus: activity.subStatus, ...options.where },
    data,
  });
  if (updated.count === 0) {
    if (options.quiet) return null;
    throw invalidTransition();
  }

  // One history row per step; a sub-status passed through comes first.
  const steps: { status: typeof status; subStatus: typeof subStatus }[] = [
    ...(rule.records ?? []).map((sub) => ({ status, subStatus: sub })),
    { status, subStatus },
  ];
  let previous = { status: activity.status, subStatus: activity.subStatus };
  for (const step of steps) {
    await tx.activityStatusHistory.create({
      data: {
        activityId: activity.id,
        fromStatus: previous.status,
        toStatus: step.status,
        fromSubStatus: previous.subStatus,
        toSubStatus: step.subStatus,
        actorType: actor.type,
        actorId,
        reason: reason ?? null,
      },
    });
    previous = step;
  }

  // A cancelled booking gives its seat back (B2a decision 7).
  if (status === "CANCELLED") await releaseHeldSeat(tx, activity, now);

  // The chat's system message, in the same transaction (B2b decision 4).
  const chatEvent = await postTransitionMessage(
    tx,
    activity,
    { status: activity.status, subStatus: activity.subStatus },
    { status, subStatus },
    // Only a cancellation shows its reason in the chat; a dispute's reason is for the admin.
    { senderId: actor.type === "USER" ? actor.id : null, body: status === "CANCELLED" && !options.hideReason ? (reason ?? null) : null },
  );

  const after: EngineActivity = {
    ...activity,
    status,
    subStatus,
    ...(data.completionRequestedAt instanceof Date && { completionRequestedAt: now, completionRequestedById: actorId }),
    ...(action === "DELETE" && { deletedAt: now }),
  };
  return {
    before: activity,
    activity: after,
    events: [transitionEvent(activity, after, action, actor, now)],
    chatEvents: chatEvent ? [chatEvent] : [],
  };
}

async function releaseHeldSeat(tx: Tx, activity: EngineActivity, now: Date) {
  if (activity.type === "RIDE_BOOKING" && ["ACCEPTED", "IN_PROGRESS", "DISPUTED"].includes(activity.status)) {
    const booking = await tx.rideBooking.findUnique({ where: { activityId: activity.id }, select: { rideOfferId: true, seatsBooked: true } });
    if (booking) await releaseRideOfferSeats(tx, booking.rideOfferId, booking.seatsBooked, now);
  }
  if (activity.type === "CARPOOL_BOOKING" && ["ACCEPTED", "DISPUTED"].includes(activity.status)) {
    const booking = await tx.carpoolBooking.findUnique({ where: { activityId: activity.id }, select: { postId: true } });
    if (booking) await releaseCarpoolSeat(tx, booking.postId, now);
  }
}

function transitionEvent(
  before: EngineActivity,
  after: EngineActivity,
  action: ActivityAction,
  actor: ActorRef,
  at: Date,
): ActivityTransitionEvent {
  return {
    activityId: after.id,
    type: after.type,
    action,
    from: { status: before.status, subStatus: before.subStatus },
    to: { status: after.status, subStatus: after.subStatus },
    actor,
    creatorId: after.creatorId,
    accepterId: after.accepterId,
    at,
  };
}

// Runs after the transaction has committed: replaces the delayed jobs and
// announces the changes (notifications in B2c).
export async function afterActivityCommit(outcomes: readonly (TransitionOutcome | null)[]) {
  const done = outcomes.filter((outcome): outcome is TransitionOutcome => outcome !== null);
  for (const outcome of done) await replaceActivityTimers(outcome.before, outcome.activity);
  emitActivityTransitions(done.flatMap((outcome) => outcome.events));
  publishChatEvents(done.flatMap((outcome) => outcome.chatEvents));
}

export function activityNotFound() {
  return new AppError(404, "ACTIVITY_NOT_FOUND", "This activity was not found");
}

async function loadActivity(tx: Tx, activityId: string) {
  return tx.activity.findFirst({ where: { id: activityId, deletedAt: null }, select: engineActivitySelect });
}

// One action by a participant, an admin or the system, in its own transaction.
export async function transitionActivity(activityId: string, action: ActivityAction, actor: ActorRef, options: TransitionOptions = {}) {
  const outcome = await prisma.$transaction(async (tx) => {
    const activity = await loadActivity(tx, activityId);
    if (!activity) {
      if (options.quiet) return null;
      throw activityNotFound();
    }
    return applyTransition(tx, activity, action, actor, options);
  });
  await afterActivityCommit([outcome]);
  return outcome;
}

export type AcceptOptions = {
  now?: Date;
  // Feature columns to set with the accept (e.g. the rider's vehicle)
  data?: Prisma.ActivityUncheckedUpdateManyInput;
  // Feature checks that run with both users locked (e.g. Active rider, seats)
  check?: (tx: Tx, activity: EngineActivity) => Promise<void>;
};

// Accepting an OPEN request (CLAUDE.md 5.2, 5.5, 5.7; B2a decision 5).
// In one READ COMMITTED transaction:
// 1. both users' rows are locked, in id order;
// 2. own item, start time passed, account status and blocks are refused;
// 3. the item is taken with a conditional UPDATE (still OPEN, not started);
// 4. the 90-minute conflict check runs for both users.
// Any failure rolls the whole accept back.
export async function acceptActivity(activityId: string, accepterId: string, options: AcceptOptions = {}) {
  const now = options.now ?? new Date();
  const actor: ActorRef = { type: "USER", id: accepterId };

  const outcome = await runActivityTransaction(async (tx) => {
    const activity = await loadActivity(tx, activityId);
    if (!activity) throw activityNotFound();
    if (activity.creatorId === accepterId) throw new AppError(403, "OWN_ITEM", "You cannot accept your own post");

    await lockUsers(tx, [activity.creatorId, accepterId]);

    if (activity.status !== "OPEN") throw alreadyTaken();
    const rule = checkTransition(activity, "ACCEPT", actor);
    // Never rely on the expiry job: an item whose start has passed cannot be taken.
    if (activity.startTime <= now) throw new AppError(409, "START_TIME_PASSED", "This item's start time has passed");
    await assertCanAccept(tx, accepterId, now);
    await assertNotBlocked(tx, activity.creatorId, accepterId);
    if (options.check) await options.check(tx, activity);

    const taken = await tx.activity.updateMany({
      where: { id: activity.id, status: "OPEN", deletedAt: null, startTime: { gt: now } },
      data: { status: "ACCEPTED", subStatus: rule.to.subStatus ?? null, accepterId, acceptedAt: now, ...options.data },
    });
    if (taken.count === 0) throw alreadyTaken();

    if (activity.blocksTime) {
      await assertNoTimeConflict(tx, {
        userIds: [activity.creatorId, accepterId],
        slots: [activity.startTime],
        excludeActivityIds: [activity.id],
        conflictGroupId: activity.conflictGroupId,
      });
    }

    const after: EngineActivity = { ...activity, status: "ACCEPTED", subStatus: rule.to.subStatus ?? null, accepterId };
    await tx.activityStatusHistory.create({
      data: {
        activityId: activity.id,
        fromStatus: activity.status,
        toStatus: after.status,
        fromSubStatus: activity.subStatus,
        toSubStatus: after.subStatus,
        actorType: "USER",
        actorId: accepterId,
      },
    });
    // The chat opens with the accept, in the same transaction (B2b decision 3).
    const chatEvent = await postTransitionMessage(
      tx,
      after,
      { status: activity.status, subStatus: activity.subStatus },
      { status: after.status, subStatus: after.subStatus },
      { senderId: accepterId, body: null },
    );
    return {
      before: activity,
      activity: after,
      events: [transitionEvent(activity, after, "ACCEPT", actor, now)],
      chatEvents: chatEvent ? [chatEvent] : [],
    };
  });

  await afterActivityCommit([outcome]);
  return outcome.activity;
}

export function alreadyTaken() {
  return new AppError(409, "ALREADY_TAKEN", "Already taken");
}

// RESTRICTED (or locked) accounts cannot accept (CLAUDE.md section 4). Read
// after the lock, so a restriction made a moment ago applies.
async function assertCanAccept(tx: Tx, userId: string, now: Date) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true, suspendedFrom: true, suspendedUntil: true, restrictedUntil: true },
  });
  if (!user || effectiveAccountStatus(user, now) !== "ACTIVE") {
    throw new AppError(403, "ACCOUNT_RESTRICTED", "Your account is restricted from creating or accepting activities");
  }
}

// Blocked users never see each other in matching (CLAUDE.md 6.10).
async function assertNotBlocked(tx: Tx, a: string, b: string) {
  const block = await tx.block.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { blockerId: true },
  });
  if (block) throw new AppError(409, "NOT_AVAILABLE", "This item is not available");
}

export type CreateAcceptedInput = {
  type: ActivityType;
  // Owner of the parent post (the rider of a ride offer)
  creatorId: string;
  // Who books (the passenger)
  accepterId: string;
  startTime: Date;
  subStatus: ActivitySubStatus | null;
  conflictGroupId: string | null;
  now?: Date;
  // Feature checks with both users locked, before the activity is written
  // (e.g. the offer's rider is Active, one booking per passenger, seats)
  check?: (tx: Tx) => Promise<void>;
  // The feature's own row, in the same transaction (e.g. ride_bookings)
  afterCreate?: (tx: Tx, activity: EngineActivity) => Promise<void>;
};

// Booking a seat (B3a): the activity is created already ACCEPTED, since the
// booking is the confirmation (CLAUDE.md 5.2). The same guarantees as
// acceptActivity() in one READ COMMITTED transaction: both users locked, own
// post, start passed, restricted accepter and blocks refused, the feature's
// checks, then the 90-minute check for both users. History, chat and the
// ACCEPT event as for an accept.
export async function createAcceptedActivity(input: CreateAcceptedInput) {
  const now = input.now ?? new Date();
  const actor: ActorRef = { type: "USER", id: input.accepterId };
  if (input.creatorId === input.accepterId) throw new AppError(403, "OWN_ITEM", "You cannot book your own post");

  const outcome = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [input.creatorId, input.accepterId]);
    if (input.startTime <= now) throw new AppError(409, "START_TIME_PASSED", "This item's start time has passed");
    await assertCanAccept(tx, input.accepterId, now);
    await assertNotBlocked(tx, input.creatorId, input.accepterId);
    if (input.check) await input.check(tx);

    const activity = await tx.activity.create({
      data: {
        type: input.type,
        status: "ACCEPTED",
        subStatus: input.subStatus,
        startTime: input.startTime,
        blocksTime: blocksTimeFor(input.type),
        creatorId: input.creatorId,
        accepterId: input.accepterId,
        acceptedAt: now,
        conflictGroupId: input.conflictGroupId,
      },
      select: engineActivitySelect,
    });
    if (input.afterCreate) await input.afterCreate(tx, activity);

    if (activity.blocksTime) {
      await assertNoTimeConflict(tx, {
        userIds: [input.creatorId, input.accepterId],
        slots: [activity.startTime],
        excludeActivityIds: [activity.id],
        conflictGroupId: activity.conflictGroupId,
      });
    }
    await recordCreation(tx, activity, actor);
    const opened = { status: "OPEN" as const, subStatus: null };
    const chatEvent = await postTransitionMessage(tx, activity, opened, { status: activity.status, subStatus: activity.subStatus }, {
      senderId: input.accepterId,
      body: null,
    });
    return {
      before: { ...activity, ...opened, accepterId: null },
      activity,
      events: [transitionEvent({ ...activity, ...opened }, activity, "ACCEPT", actor, now)],
      chatEvents: chatEvent ? [chatEvent] : [],
    };
  });

  await afterActivityCommit([outcome]);
  return outcome.activity;
}

// Records the first status of an activity created directly in a later state
// (a ride booking is created ACCEPTED). For B3 and later; B3 also opens the
// booking's chat here with postTransitionMessage (OPEN -> ACCEPTED).
export async function recordCreation(tx: Tx, activity: EngineActivity, actor: ActorRef) {
  await tx.activityStatusHistory.create({
    data: {
      activityId: activity.id,
      fromStatus: null,
      toStatus: activity.status,
      toSubStatus: activity.subStatus,
      actorType: actor.type,
      actorId: actor.type === "SYSTEM" ? null : actor.id,
    },
  });
}
