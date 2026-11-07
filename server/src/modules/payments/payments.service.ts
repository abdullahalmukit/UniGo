import type { ActivityStatus, ActivitySubStatus, ActivityType, PaymentMethod, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

// Payment records (proposal section 16, B3b-2). UniGo never processes a
// payment: it records the agreed amount, the method (Cash, bKash, Nagad)
// either participant picks, and whether the person who receives the money
// (the payee: the rider for rides) has marked it PAID. PAID is final; an
// admin correction of a wrong PAID mark comes in B7.

type Db = Prisma.TransactionClient | typeof prisma;

// Created in the transaction that accepts or books (amount fixed then).
// B4: a food record keeps the food cost and the delivery charge separately;
// its amount is their sum.
export function createPaymentRecord(
  db: Db,
  input: { activityId: string; amount: Prisma.Decimal | number; payeeId: string; foodCost?: Prisma.Decimal | number; deliveryCharge?: Prisma.Decimal | number },
) {
  return db.paymentRecord.create({
    data: {
      activityId: input.activityId,
      amount: input.amount,
      payeeId: input.payeeId,
      ...(input.foodCost !== undefined && { foodCost: input.foodCost }),
      ...(input.deliveryCharge !== undefined && { deliveryCharge: input.deliveryCharge }),
    },
  });
}

// B4: a food record follows the order while it is UNPAID (confirmed details,
// an approved higher price, the receipt's cost). Once PAID it is final; later
// amounts stay on the food request and its receipt.
export async function updateFoodPaymentRecord(
  db: Db,
  activityId: string,
  input: { foodCost: Prisma.Decimal; deliveryCharge: Prisma.Decimal; method?: PaymentMethod | null },
) {
  await db.paymentRecord.updateMany({
    where: { activityId, status: "UNPAID" },
    data: {
      foodCost: input.foodCost,
      deliveryCharge: input.deliveryCharge,
      amount: input.foodCost.add(input.deliveryCharge),
      ...(input.method !== undefined && { method: input.method }),
    },
  });
}

const notFound = () => new AppError(404, "PAYMENT_NOT_FOUND", "There is no payment record for this activity");

// PAID can be marked after acceptance in any status except CANCELLED (B3b-2).
const PAYABLE: readonly ActivityStatus[] = ["ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "NOT_MARKED"];

type PaymentActivity = { type: ActivityType; status: ActivityStatus; subStatus: ActivitySubStatus | null };

// B4 (Q3): food is payable from ORDER_CONFIRMED on (students often pay by
// bKash before the food is bought). The sub-status is empty only before the
// order was confirmed, and it stays set through every later step.
function isPayable(activity: PaymentActivity) {
  if (!PAYABLE.includes(activity.status)) return false;
  if (activity.type === "FOOD") return activity.subStatus !== null || activity.status === "COMPLETED";
  return true;
}

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
      foodCost: true,
      deliveryCharge: true,
      activity: { select: { type: true, status: true, subStatus: true, creatorId: true, accepterId: true } },
    },
  });
  if (!record) throw notFound();
  const { creatorId, accepterId } = record.activity;
  if (userId !== creatorId && userId !== accepterId) throw new AppError(403, "NOT_PARTICIPANT", "You are not part of this activity");
  return record;
}

type Row = Awaited<ReturnType<typeof load>>;

export function paymentView(
  record: Pick<Row, "amount" | "method" | "status" | "paidAt" | "payeeId" | "foodCost" | "deliveryCharge"> & { activity: PaymentActivity },
  viewerId: string,
) {
  const isPayee = record.payeeId === viewerId;
  const isFood = record.activity.type === "FOOD";
  return {
    amount: Number(record.amount),
    // B4: food cost and delivery charge, separately (proposal 16)
    foodCost: record.foodCost === null ? null : Number(record.foodCost),
    deliveryCharge: record.deliveryCharge === null ? null : Number(record.deliveryCharge),
    method: record.method,
    status: record.status,
    paidAt: record.paidAt,
    // "ME": the viewer receives the money; "OTHER": the viewer pays
    payee: isPayee ? ("ME" as const) : ("OTHER" as const),
    // B4: for food the method is part of the order details both confirm
    canChooseMethod: !isFood && record.status === "UNPAID" && record.activity.status !== "CANCELLED",
    canMarkPaid: isPayee && record.status === "UNPAID" && record.method !== null && isPayable(record.activity),
  };
}

export async function getPayment(userId: string, activityId: string) {
  return paymentView(await load(userId, activityId), userId);
}

// Either participant, while UNPAID.
export async function setPaymentMethod(userId: string, activityId: string, method: PaymentMethod) {
  const record = await load(userId, activityId);
  if (record.activity.type === "FOOD") {
    throw new AppError(409, "USE_ORDER_DETAILS", "For food delivery, choose the payment method in the order details");
  }
  if (record.activity.status === "CANCELLED") throw new AppError(409, "PAYMENT_NOT_DUE", "This activity was cancelled");
  const updated = await prisma.paymentRecord.updateMany({ where: { id: record.id, status: "UNPAID" }, data: { method } });
  if (updated.count === 0) throw new AppError(409, "PAYMENT_ALREADY_PAID", "This payment is already marked paid");
  return getPayment(userId, activityId);
}

// Only the payee, after a method is chosen; conditional, so it happens once.
export async function markPaymentPaid(userId: string, activityId: string, now = new Date()) {
  const record = await load(userId, activityId);
  if (record.payeeId !== userId) throw new AppError(403, "NOT_PAYEE", "Only the person who receives the money can mark it paid");
  if (!isPayable(record.activity)) throw new AppError(409, "PAYMENT_NOT_DUE", "This payment cannot be marked paid now");
  if (!record.method) throw new AppError(400, "PAYMENT_METHOD_REQUIRED", "Choose how it was paid first");
  const updated = await prisma.paymentRecord.updateMany({
    where: { id: record.id, status: "UNPAID" },
    data: { status: "PAID", paidAt: now, markedPaidById: userId },
  });
  if (updated.count === 0) throw new AppError(409, "PAYMENT_ALREADY_PAID", "This payment is already marked paid");
  return getPayment(userId, activityId);
}
