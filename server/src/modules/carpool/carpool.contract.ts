import type { PaymentMethod } from "../../generated/prisma/client.js";
import { rules } from "../../config/rules.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { dateOnly, dateOnlyString, dhakaDateString } from "../../utils/time.js";
import { publishChatEvents } from "../chat/chat-events.js";
import { postFoodMessage } from "../chat/chat-system.js";
import { activityNotFound, afterActivityCommit, applyTransition, engineActivitySelect, transitionActivity, type TransitionOutcome } from "../activities/engine.js";
import { lockUsers, runActivityTransaction } from "../activities/transaction.js";
import { notify } from "../notifications/notify.service.js";
import { addDays, contractMonths, runsOn, tomorrow } from "./carpool-dates.js";

// Carpool contracts after they start (proposal 9.3 steps 6-8, 9.5, 9.6; B6b):
// marking sessions, the monthly payment records, early termination by
// agreement, and Renew after a normal end.

const contractNotFound = () => new AppError(404, "CARPOOL_NOT_FOUND", "This carpool was not found");
const notParticipant = () => new AppError(403, "NOT_PARTICIPANT", "You are not part of this activity");

// --- Sessions (9.3 step 6, B6b #1)

// Either participant marks a session Completed in one step, from 30 minutes
// before its departure (the engine checks the time). Cancelling a session
// uses POST /api/activities/:id/cancel (reason required, late flag as usual).
export async function completeCarpoolSession(userId: string, activityId: string, now = new Date()) {
  const activity = await prisma.activity.findFirst({ where: { id: activityId, deletedAt: null }, select: { type: true } });
  if (!activity || activity.type !== "CARPOOL_SESSION") throw activityNotFound();
  const outcome = await transitionActivity(activityId, "COMPLETE_SESSION", { type: "USER", id: userId }, { now });
  return { activity: { id: outcome!.activity.id, status: outcome!.activity.status } };
}

// The month-by-month history of a contract (9.3 step 7): completed, cancelled
// (and by whom) and not-marked sessions of each contract month.
export async function contractHistory(contractId: string, viewerId: string) {
  const contract = await prisma.carpoolContract.findUniqueOrThrow({
    where: { id: contractId },
    select: { startDate: true, durationMonths: true, sessions: { select: { sessionDate: true, activity: { select: { status: true, cancelledById: true } } } } },
  });
  return contractMonths(dateOnlyString(contract.startDate), contract.durationMonths).map((month) => {
    const inMonth = contract.sessions.filter((s) => {
      const date = dateOnlyString(s.sessionDate);
      return date >= month.periodStart && date <= month.periodEnd;
    });
    const count = (test: (s: (typeof inMonth)[number]) => boolean) => inMonth.filter(test).length;
    return {
      monthNumber: month.monthNumber,
      periodStart: month.periodStart,
      periodEnd: month.periodEnd,
      total: inMonth.length,
      completed: count((s) => s.activity.status === "COMPLETED"),
      notMarked: count((s) => s.activity.status === "NOT_MARKED"),
      cancelledByMe: count((s) => s.activity.status === "CANCELLED" && s.activity.cancelledById === viewerId),
      cancelledByOther: count((s) => s.activity.status === "CANCELLED" && !!s.activity.cancelledById && s.activity.cancelledById !== viewerId),
      // Closed by the system after an early termination: counts against nobody
      closed: count((s) => s.activity.status === "CANCELLED" && !s.activity.cancelledById),
    };
  });
}

// --- Monthly payment records (9.5)

// Every contract month that has begun has its record, UNPAID at the start of
// the month. Months of an ACTIVE contract are created as they begin; month 1
// with the contract. The passenger is told in-app (section 14). Unique
// (contract, month), so running this twice creates nothing twice.
export async function ensureMonthlyPayments(contractId: string, now = new Date()) {
  const contract = await prisma.carpoolContract.findUnique({
    where: { id: contractId },
    select: {
      status: true,
      startDate: true,
      durationMonths: true,
      monthlyPrice: true,
      monthlyPayments: { select: { monthNumber: true } },
      booking: { select: { activityId: true, activity: { select: { creatorId: true, accepterId: true } } } },
    },
  });
  if (!contract || contract.status !== "ACTIVE") return 0;
  const today = dhakaDateString(now);
  const have = new Set(contract.monthlyPayments.map((p) => p.monthNumber));
  const due = contractMonths(dateOnlyString(contract.startDate), contract.durationMonths).filter(
    (month) => month.periodStart <= today && !have.has(month.monthNumber),
  );
  if (due.length === 0) return 0;
  await prisma.carpoolMonthlyPayment.createMany({
    data: due.map((month) => ({
      contractId,
      monthNumber: month.monthNumber,
      periodStart: dateOnly(month.periodStart),
      periodEnd: dateOnly(month.periodEnd),
      amount: contract.monthlyPrice,
    })),
    skipDuplicates: true,
  });
  const rider = await prisma.profile.findUnique({ where: { userId: contract.booking.activity.creatorId }, select: { fullName: true } });
  for (const month of due) {
    await notify({
      type: "CARPOOL_PAYMENT_DUE",
      userIds: [contract.booking.activity.accepterId],
      dedupeKey: `CARPOOL_PAYMENT_DUE:${contractId}:${month.monthNumber}`,
      activityId: contract.booking.activityId,
      data: { activityType: "CARPOOL_BOOKING", name: rider?.fullName, kind: String(month.monthNumber) },
    });
  }
  return due.length;
}

// Repeating job (rules.carpool.paymentRecordInterval): every running contract.
export async function runCarpoolPaymentsJob(now = new Date()) {
  const contracts = await prisma.carpoolContract.findMany({
    where: { status: "ACTIVE", startDate: { lte: dateOnly(dhakaDateString(now)) } },
    select: { id: true },
  });
  let created = 0;
  for (const { id } of contracts) created += await ensureMonthlyPayments(id, now);
  return created;
}

async function paymentForParticipant(userId: string, paymentId: string) {
  const payment = await prisma.carpoolMonthlyPayment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, method: true, contract: { select: { booking: { select: { activity: { select: { creatorId: true, accepterId: true } } } } } } },
  });
  const activity = payment?.contract.booking.activity;
  if (!payment || !activity || (activity.creatorId !== userId && activity.accepterId !== userId)) throw contractNotFound();
  return { payment, riderId: activity.creatorId };
}

export function monthlyPaymentView(row: { id: string; monthNumber: number; periodStart: Date; periodEnd: Date; amount: unknown; method: PaymentMethod | null; status: string; paidAt: Date | null }) {
  return {
    id: row.id,
    monthNumber: row.monthNumber,
    periodStart: dateOnlyString(row.periodStart),
    periodEnd: dateOnlyString(row.periodEnd),
    amount: Number(row.amount),
    method: row.method,
    status: row.status,
    paidAt: row.paidAt,
  };
}

const paymentSelect = { id: true, monthNumber: true, periodStart: true, periodEnd: true, amount: true, method: true, status: true, paidAt: true } as const;

// Either participant records the agreed method while the month is UNPAID.
export async function setMonthlyPaymentMethod(userId: string, paymentId: string, method: PaymentMethod) {
  await paymentForParticipant(userId, paymentId);
  const updated = await prisma.carpoolMonthlyPayment.updateMany({ where: { id: paymentId, status: "UNPAID" }, data: { method } });
  if (updated.count === 0) throw new AppError(409, "PAYMENT_ALREADY_PAID", "This month is already marked paid");
  return { payment: monthlyPaymentView(await prisma.carpoolMonthlyPayment.findUniqueOrThrow({ where: { id: paymentId }, select: paymentSelect })) };
}

// Only the rider marks a month PAID (9.5), once a method is chosen. Final for users.
export async function markMonthlyPaymentPaid(userId: string, paymentId: string, now = new Date()) {
  const { payment, riderId } = await paymentForParticipant(userId, paymentId);
  if (userId !== riderId) throw new AppError(403, "NOT_PAYEE", "Only the rider marks a month paid");
  if (payment.status === "PAID") throw new AppError(409, "PAYMENT_ALREADY_PAID", "This month is already marked paid");
  if (!payment.method) throw new AppError(409, "PAYMENT_METHOD_REQUIRED", "Choose how it was paid first");
  const updated = await prisma.carpoolMonthlyPayment.updateMany({
    where: { id: paymentId, status: "UNPAID", method: { not: null } },
    data: { status: "PAID", paidAt: now, markedPaidById: userId },
  });
  if (updated.count === 0) throw new AppError(409, "PAYMENT_ALREADY_PAID", "This month is already marked paid");
  return { payment: monthlyPaymentView(await prisma.carpoolMonthlyPayment.findUniqueOrThrow({ where: { id: paymentId }, select: paymentSelect })) };
}

export async function contractPayments(contractId: string) {
  const rows = await prisma.carpoolMonthlyPayment.findMany({ where: { contractId }, orderBy: { monthNumber: "asc" }, select: paymentSelect });
  return rows.map(monthlyPaymentView);
}

// --- Early termination (9.6, B6b plan 3)

async function lockContract(userId: string, activityId: string) {
  const known = await prisma.activity.findFirst({ where: { id: activityId, type: "CARPOOL_BOOKING" }, select: { creatorId: true, accepterId: true } });
  if (!known?.accepterId) throw activityNotFound();
  if (userId !== known.creatorId && userId !== known.accepterId) throw notParticipant();
  return known as { creatorId: string; accepterId: string };
}

async function contractRow(tx: Parameters<Parameters<typeof runActivityTransaction>[0]>[0], activityId: string) {
  const booking = await tx.carpoolBooking.findUnique({
    where: { activityId },
    select: { contract: { select: { id: true, status: true, terminationRequestedById: true, terminationReason: true } } },
  });
  if (!booking?.contract) throw new AppError(409, "NO_ACTIVE_CONTRACT", "There is no running contract");
  return booking.contract;
}

// One side asks to end the contract early, with a reason. The other agrees or declines.
export async function requestCarpoolTermination(userId: string, activityId: string, reason: string, now = new Date()) {
  const people = await lockContract(userId, activityId);
  const result = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [people.creatorId, people.accepterId]);
    const activity = await tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: engineActivitySelect });
    const contract = await contractRow(tx, activityId);
    if (contract.status !== "ACTIVE" || activity.status !== "ACCEPTED" || activity.subStatus !== "CONTRACT_ACTIVE") {
      throw new AppError(409, "NO_ACTIVE_CONTRACT", "There is no running contract");
    }
    const marked = await tx.carpoolContract.updateMany({
      where: { id: contract.id, status: "ACTIVE", terminationRequestedById: null },
      data: { terminationRequestedById: userId, terminationRequestedAt: now, terminationReason: reason },
    });
    if (marked.count === 0) throw new AppError(409, "TERMINATION_ALREADY_REQUESTED", "Ending this contract early has already been asked");
    const chatEvent = await postFoodMessage(tx, activity, { kind: "SYSTEM", code: "TERMINATION_REQUESTED", senderId: userId, body: reason });
    return { chatEvent };
  });
  publishChatEvents(result.chatEvent ? [result.chatEvent] : []);
  const otherId = userId === people.creatorId ? people.accepterId : people.creatorId;
  await notifyTermination("CARPOOL_TERMINATION_REQUESTED", activityId, userId, otherId, `requested:${now.getTime()}`);
}

// The person who asked can take the request back while it is unanswered.
export async function withdrawCarpoolTermination(userId: string, activityId: string) {
  const people = await lockContract(userId, activityId);
  const result = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [people.creatorId, people.accepterId]);
    const activity = await tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: engineActivitySelect });
    const contract = await contractRow(tx, activityId);
    const cleared = await tx.carpoolContract.updateMany({
      where: { id: contract.id, status: "ACTIVE", terminationRequestedById: userId },
      data: { terminationRequestedById: null, terminationRequestedAt: null, terminationReason: null },
    });
    if (cleared.count === 0) throw new AppError(409, "NO_TERMINATION_REQUEST", "There is no request of yours to take back");
    return { chatEvent: await postFoodMessage(tx, activity, { kind: "SYSTEM", code: "TERMINATION_WITHDRAWN", senderId: userId }) };
  });
  publishChatEvents(result.chatEvent ? [result.chatEvent] : []);
}

// The other person answers. Agreeing ends the contract at once: the booking is
// CANCELLED (TERMINATE_CONTRACT, the seat reopens), the contract TERMINATED and
// every future session closed by the system (CONTRACT_TERMINATED, counts
// against nobody). Declining clears the request; either side may then raise a
// complaint (section 15). Refunds are outside the app.
export async function answerCarpoolTermination(userId: string, activityId: string, agree: boolean, now = new Date()) {
  const people = await lockContract(userId, activityId);
  const result = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [people.creatorId, people.accepterId]);
    const activity = await tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: engineActivitySelect });
    const contract = await contractRow(tx, activityId);
    if (contract.status !== "ACTIVE" || !contract.terminationRequestedById) {
      throw new AppError(409, "NO_TERMINATION_REQUEST", "Nobody has asked to end this contract early");
    }
    const requesterId = contract.terminationRequestedById;
    if (requesterId === userId) throw new AppError(409, "OWN_TERMINATION_REQUEST", "The other person answers your request");

    if (!agree) {
      const cleared = await tx.carpoolContract.updateMany({
        where: { id: contract.id, status: "ACTIVE", terminationRequestedById: requesterId },
        data: { terminationRequestedById: null, terminationRequestedAt: null, terminationReason: null },
      });
      if (cleared.count === 0) throw new AppError(409, "NO_TERMINATION_REQUEST", "Nobody has asked to end this contract early");
      const chatEvent = await postFoodMessage(tx, activity, { kind: "SYSTEM", code: "TERMINATION_DECLINED", senderId: userId });
      return { requesterId, outcomes: [] as TransitionOutcome[], chatEvent };
    }

    const ended = await tx.carpoolContract.updateMany({
      where: { id: contract.id, status: "ACTIVE", terminationRequestedById: requesterId },
      data: { status: "TERMINATED", terminatedAt: now },
    });
    if (ended.count === 0) throw new AppError(409, "NO_TERMINATION_REQUEST", "Nobody has asked to end this contract early");
    const future = await tx.activity.findMany({
      where: { type: "CARPOOL_SESSION", status: "ACCEPTED", startTime: { gt: now }, carpoolSession: { contractId: contract.id } },
      select: engineActivitySelect,
    });
    for (const session of future) {
      await applyTransition(tx, session, "CLOSE_SESSION", { type: "SYSTEM" }, { now, quiet: true, noChatMessage: true });
    }
    // The booking: cancelled by the person who agreed, with the requester's
    // reason. Never a late cancellation (it was agreed).
    const outcome = await applyTransition(tx, activity, "TERMINATE_CONTRACT", { type: "USER", id: userId }, {
      now,
      reason: contract.terminationReason ?? "Ended early by agreement",
      data: { isLateCancellation: false },
    });
    return { requesterId, outcomes: [outcome], chatEvent: null };
  });
  await afterActivityCommit(result.outcomes);
  publishChatEvents(result.chatEvent ? [result.chatEvent] : []);
  await notifyTermination("CARPOOL_TERMINATION_ANSWERED", activityId, userId, result.requesterId, agree ? "AGREED" : `DECLINED:${now.getTime()}`, agree ? "AGREED" : "DECLINED");
}

async function notifyTermination(
  type: "CARPOOL_TERMINATION_REQUESTED" | "CARPOOL_TERMINATION_ANSWERED",
  activityId: string,
  actorId: string,
  toId: string,
  key: string,
  kind?: "AGREED" | "DECLINED",
) {
  const [profile, chat] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: actorId }, select: { fullName: true } }),
    prisma.chat.findUnique({ where: { activityId }, select: { id: true } }),
  ]);
  await notify({
    type,
    userIds: [toId],
    dedupeKey: `${type}:${activityId}:${key}`,
    activityId,
    data: { activityType: "CARPOOL_BOOKING", name: profile?.fullName, chatId: chat?.id, ...(kind && { kind }) },
  });
}

// --- Renew (9.3 step 8, B6b #4)

// The first ride day on or after `from` (and not before tomorrow).
export function firstRideDayFrom(daysOfWeek: number, from: string, now = new Date()) {
  let date = from < tomorrow(now) ? tomorrow(now) : from;
  for (let i = 0; i < 7; i += 1, date = addDays(date, 1)) if (runsOn(daysOfWeek, date)) return date;
  return null;
}

// Renew is offered to the passenger for 7 days after a contract ended
// normally (ENDED, not terminated), once per contract while a renewal request
// is open, held or running. Returns the start date a renewal would use.
export async function renewalOption(contractId: string, passengerId: string, now = new Date()) {
  const contract = await prisma.carpoolContract.findUnique({
    where: { id: contractId },
    select: {
      status: true,
      endDate: true,
      endedAt: true,
      booking: { select: { postId: true, activity: { select: { accepterId: true } }, post: { select: { daysOfWeek: true } } } },
      renewals: { where: { activity: { status: { in: ["OPEN", "ACCEPTED", "DISPUTED"] } } }, select: { activityId: true } },
    },
  });
  if (!contract || contract.booking.activity.accepterId !== passengerId) return null;
  if (contract.status !== "ENDED" || !contract.endedAt || now.getTime() - contract.endedAt.getTime() > rules.carpool.renewWindow) return null;
  if (contract.renewals.length > 0) return { available: false as const, pendingActivityId: contract.renewals[0]!.activityId };
  const startDate = firstRideDayFrom(contract.booking.post.daysOfWeek, addDays(dateOnlyString(contract.endDate), 1), now);
  return startDate
    ? { available: true as const, postId: contract.booking.postId, startDate, until: new Date(contract.endedAt.getTime() + rules.carpool.renewWindow) }
    : null;
}
