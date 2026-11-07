import { rules } from "../../config/rules.js";
import type { TimerJob, TimerJobName } from "../../jobs/scheduler.js";
import { prisma } from "../../lib/prisma.js";
import { dateOnly, dhakaDateString } from "../../utils/time.js";
import { afterActivityCommit, applyTransition, engineActivitySelect, transitionActivity } from "../activities/engine.js";
import { scheduleActivityTimers, type TimerSubject } from "../activities/timers.js";
import { endOfDate } from "./carpool-dates.js";

// Carpool background jobs (CLAUDE.md section 8, B6a). Each one re-reads the
// database and changes a row only if it still qualifies now, by a conditional
// update, so running any of them twice changes nothing the second time. The
// sweeper (runCarpoolSweep) catches every one whose delayed job was lost.

const SYSTEM = { type: "SYSTEM" } as const;

const job = (name: TimerJobName, id: string, runAt: Date): TimerJob => ({ name, jobId: `${name}-${id}-${runAt.getTime()}`, runAt, data: { id } });

// The seat hold ends (B6a Q1); the job carries the booking's activity id.
export const holdReleaseJob = (activityId: string, holdExpiresAt: Date) => job("carpool-hold-release", activityId, holdExpiresAt);
// A contract ends at the midnight after its last day.
export const contractEndJob = (contractId: string, endDate: string) => job("carpool-contract-end", contractId, endOfDate(endDate));
// A post closes at the midnight after its valid-until date.
export const postCloseJob = (postId: string, validUntil: string) => job("carpool-post-close", postId, endOfDate(validUntil));

// A held seat nobody agreed on in time returns to the post (9.3 step 4). The
// engine gives the seat back with the RELEASE_HOLD transition.
export async function runCarpoolHoldReleaseJob(activityId: string, now = new Date()) {
  const booking = await prisma.carpoolBooking.findUnique({ where: { activityId }, select: { holdExpiresAt: true } });
  if (!booking?.holdExpiresAt || booking.holdExpiresAt > now) return false;
  const outcome = await transitionActivity(activityId, "RELEASE_HOLD", SYSTEM, { now, quiet: true });
  return outcome !== null;
}

// The contract ran its months: the booking is COMPLETED, the contract ENDED,
// and only that seat reopens (9.4). Reviews and Renew come in B6b.
export async function runCarpoolContractEndJob(contractId: string, now = new Date()) {
  const contract = await prisma.carpoolContract.findUnique({
    where: { id: contractId },
    select: { status: true, endDate: true, booking: { select: { activityId: true } } },
  });
  if (!contract || contract.status !== "ACTIVE" || endOfDate(contract.endDate.toISOString().slice(0, 10)) > now) return false;
  const outcome = await prisma.$transaction(async (tx) => {
    const ended = await tx.carpoolContract.updateMany({ where: { id: contractId, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });
    if (ended.count === 0) return null;
    const activity = await tx.activity.findUnique({ where: { id: contract.booking.activityId }, select: engineActivitySelect });
    return activity ? applyTransition(tx, activity, "END_CONTRACT", SYSTEM, { now, quiet: true }) : null;
  });
  await afterActivityCommit([outcome]);
  return outcome !== null;
}

// Posts whose valid-until date has passed are CLOSED (reason ENDED); paused
// ones too. Contracts on them carry on to their own end.
export async function runCarpoolPostCloseJob(postId?: string, now = new Date()) {
  const closed = await prisma.carpoolPost.updateMany({
    where: { ...(postId && { id: postId }), status: { in: ["OPEN", "FULL"] }, validUntil: { lt: dateOnly(dhakaDateString(now)) } },
    data: { status: "CLOSED", closedAt: now, closeReason: "ENDED" },
  });
  return closed.count;
}

// Sessions get their NOT_MARKED and ride-day reminder timers only when they
// are at most sessionTimerWindow (7 days) ahead.
export function sessionTimerSubjects(sessions: readonly { id: string; startTime: Date }[], now = new Date()): TimerSubject[] {
  const until = now.getTime() + rules.carpool.sessionTimerWindow;
  return sessions
    .filter((s) => s.startTime > now && s.startTime.getTime() <= until)
    .map((s) => ({ id: s.id, type: "CARPOOL_SESSION" as const, status: "ACCEPTED" as const, subStatus: null, startTime: s.startTime, completionRequestedAt: null }));
}

// Daily (B6a): queues the timers of ACCEPTED sessions that have come within
// the window. Job ids are deterministic, so a session queued before is not
// queued twice; a lost run loses nothing, because the sweeper closes
// NOT_MARKED sessions and sends missed ride-day reminders by itself.
export async function runCarpoolSessionTimersJob(now = new Date()) {
  const sessions = await prisma.activity.findMany({
    where: {
      type: "CARPOOL_SESSION",
      status: "ACCEPTED",
      deletedAt: null,
      startTime: { gt: now, lte: new Date(now.getTime() + rules.carpool.sessionTimerWindow) },
    },
    select: { id: true, startTime: true },
  });
  await scheduleActivityTimers(sessionTimerSubjects(sessions, now));
  return sessions.length;
}

// Part of the safety-net sweeper (B2a decision 11): holds past their end,
// contracts past their last day and posts past their end date.
export async function runCarpoolSweep(now = new Date()) {
  const take = rules.jobs.sweepBatch;
  const holds = await prisma.carpoolBooking.findMany({
    where: { holdExpiresAt: { lte: now }, activity: { status: "ACCEPTED", subStatus: null } },
    select: { activityId: true },
    take,
  });
  let holdsReleased = 0;
  for (const { activityId } of holds) if (await runCarpoolHoldReleaseJob(activityId, now)) holdsReleased += 1;

  // A contract ends at the midnight after its end date: end dates before today.
  const contracts = await prisma.carpoolContract.findMany({
    where: { status: "ACTIVE", endDate: { lt: dateOnly(dhakaDateString(now)) } },
    select: { id: true },
    take,
  });
  let contractsEnded = 0;
  for (const { id } of contracts) if (await runCarpoolContractEndJob(id, now)) contractsEnded += 1;

  const postsClosed = await runCarpoolPostCloseJob(undefined, now);
  return { holdsReleased, contractsEnded, postsClosed };
}
