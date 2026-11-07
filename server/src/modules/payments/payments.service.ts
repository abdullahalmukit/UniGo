import type { ActivityStatus, PaymentMethod, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

// Payment records (proposal section 16, B3b-2). UniGo never processes a
// payment: it records the agreed amount, the method (Cash, bKash, Nagad)
// either participant picks, and whether the person who receives the money
// (the payee: the rider for rides) has marked it PAID. PAID is final; an
// admin correction of a wrong PAID mark comes in B7.

type Db = Prisma.TransactionClient | typeof prisma;

// Created in the transaction that accepts or books (amount fixed then).
export function createPaymentRecord(db: Db, input: { activityId: string; amount: Prisma.Decimal | number; payeeId: string }) {
  return db.paymentRecord.create({ data: { activityId: input.activityId, amount: input.amount, payeeId: input.payeeId } });
}

const notFound = () => new AppError(404, "PAYMENT_NOT_FOUND", "There is no payment record for this activity");

// PAID can be marked after acceptance in any status except CANCELLED (B3b-2).
const PAYABLE: readonly ActivityStatus[] = ["ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "NOT_MARKED"];

async function load(userId: string, activityId: string) {
  const record = await prisma.paymentRecord.findUnique({
    where: { activityId },
    select: {
      id: true,
      amount: true,
      method: true,
      status: true,
      paidAt: true,
      payeeId: true,
      activity: { select: { status: true, creatorId: true, accepterId: true } },
    },
  });
  if (!record) throw notFound();
  const { creatorId, accepterId } = record.activity;
  if (userId !== creatorId && userId !== accepterId) throw new AppError(403, "NOT_PARTICIPANT", "You are not part of this activity");
  return record;
}

type Row = Awaited<ReturnType<typeof load>>;

export function paymentView(record: Pick<Row, "amount" | "method" | "status" | "paidAt" | "payeeId"> & { activity: { status: ActivityStatus } }, viewerId: string) {
  const isPayee = record.payeeId === viewerId;
  return {
    amount: Number(record.amount),
    method: record.method,
    status: record.status,
    paidAt: record.paidAt,
    // "ME": the viewer receives the money; "OTHER": the viewer pays
    payee: isPayee ? ("ME" as const) : ("OTHER" as const),
    canChooseMethod: record.status === "UNPAID" && record.activity.status !== "CANCELLED",
    canMarkPaid: isPayee && record.status === "UNPAID" && record.method !== null && PAYABLE.includes(record.activity.status),
  };
}

export async function getPayment(userId: string, activityId: string) {
  return paymentView(await load(userId, activityId), userId);
}

// Either participant, while UNPAID.
export async function setPaymentMethod(userId: string, activityId: string, method: PaymentMethod) {
  const record = await load(userId, activityId);
  if (record.activity.status === "CANCELLED") throw new AppError(409, "PAYMENT_NOT_DUE", "This activity was cancelled");
  const updated = await prisma.paymentRecord.updateMany({ where: { id: record.id, status: "UNPAID" }, data: { method } });
  if (updated.count === 0) throw new AppError(409, "PAYMENT_ALREADY_PAID", "This payment is already marked paid");
  return getPayment(userId, activityId);
}

// Only the payee, after a method is chosen; conditional, so it happens once.
export async function markPaymentPaid(userId: string, activityId: string, now = new Date()) {
  const record = await load(userId, activityId);
  if (record.payeeId !== userId) throw new AppError(403, "NOT_PAYEE", "Only the person who receives the money can mark it paid");
  if (!PAYABLE.includes(record.activity.status)) throw new AppError(409, "PAYMENT_NOT_DUE", "This payment cannot be marked paid now");
  if (!record.method) throw new AppError(400, "PAYMENT_METHOD_REQUIRED", "Choose how it was paid first");
  const updated = await prisma.paymentRecord.updateMany({
    where: { id: record.id, status: "UNPAID" },
    data: { status: "PAID", paidAt: now, markedPaidById: userId },
  });
  if (updated.count === 0) throw new AppError(409, "PAYMENT_ALREADY_PAID", "This payment is already marked paid");
  return getPayment(userId, activityId);
}
