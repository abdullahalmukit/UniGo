import { Prisma, type NotificationType } from "../../generated/prisma/client.js";
import { rules } from "../../config/rules.js";
import { deletePrivateFile, putPrivateFile } from "../../lib/private-storage.js";
import { AppError } from "../../utils/app-error.js";
import { prisma } from "../../lib/prisma.js";
import { afterActivityCommit, applyTransition, engineActivitySelect, type TransitionOutcome } from "../activities/engine.js";
import { invalidTransition } from "../activities/transitions.js";
import { runActivityTransaction, type Tx } from "../activities/transaction.js";
import { publishChatEvents, type ChatEvent } from "../chat/chat-events.js";
import { postFoodMessage } from "../chat/chat-system.js";
import { encodeChatImage } from "../chat/chat.service.js";
import { activityContext } from "../notifications/activity-notifications.js";
import { notify } from "../notifications/notify.service.js";
import { updateFoodPaymentRecord } from "../payments/payments.service.js";
import { decimal, foodNotFound, getFoodRequest } from "./food.service.js";
import type { OrderInput } from "./food.validation.js";

// The food steps between accept and delivery (proposal 10.3 and 10.4, B4
// decisions):
// - Order details: either participant saves items, food price, delivery
//   charge and payment method; saving counts as the saver's confirmation and
//   clears the other's. When both have confirmed the same version the request
//   is ORDER_CONFIRMED. Any change after that reopens it (REOPEN_ORDER).
// - Over-budget approval: before buying, the accepter asks the requester to
//   approve a higher food price (a card in the chat). Approving raises the
//   confirmed price and keeps ORDER_CONFIRMED; rejecting changes nothing.
// - Receipt: the accepter uploads the receipt photo with the actual cost,
//   which may not be above the confirmed price -> FOOD_COLLECTED, IN_PROGRESS.
//
// Every step locks the activity row first, so it runs after (or before) any
// other change of the same request, never in between.

type Viewer = { id: string };

async function lockFood(tx: Tx, activityId: string) {
  await tx.$queryRaw`SELECT id FROM activities WHERE id = ${activityId} AND type = 'FOOD' FOR UPDATE`;
  const activity = await tx.activity.findFirst({ where: { id: activityId, type: "FOOD", deletedAt: null }, select: engineActivitySelect });
  const food = await tx.foodRequest.findUnique({
    where: { activityId },
    select: {
      id: true,
      orderItems: true,
      orderFoodPrice: true,
      orderDeliveryCharge: true,
      orderPaymentMethod: true,
      orderVersion: true,
      requesterConfirmedAt: true,
      accepterConfirmedAt: true,
    },
  });
  if (!activity || !food) throw foodNotFound();
  return { activity, food };
}

type Locked = Awaited<ReturnType<typeof lockFood>>;

function assertParticipant(activity: Locked["activity"], userId: string) {
  if (userId !== activity.creatorId && userId !== activity.accepterId) {
    throw new AppError(403, "NOT_PARTICIPANT", "You are not part of this activity");
  }
}

// Order details can change while ACCEPTED, before the receipt (B4).
function assertOrderOpen(activity: Locked["activity"]) {
  if (activity.status !== "ACCEPTED" || (activity.subStatus !== null && activity.subStatus !== "ORDER_CONFIRMED")) {
    throw new AppError(409, "ORDER_LOCKED", "The order details can no longer be changed");
  }
}

async function assertNotPaid(tx: Tx, activityId: string) {
  const payment = await tx.paymentRecord.findUnique({ where: { activityId }, select: { status: true } });
  if (payment?.status === "PAID") {
    throw new AppError(409, "ORDER_PAID", "This order is already marked paid, so its details can no longer be changed");
  }
}

const sameMoney = (a: Prisma.Decimal | null, b: number) => a !== null && a.equals(decimal(b));

// After commit: the engine's jobs and events, the chat messages and the
// notification. A failing notification never fails the request.
async function afterCommit(outcomes: (TransitionOutcome | null)[], chatEvents: (ChatEvent | null)[], notice?: () => Promise<unknown>) {
  await afterActivityCommit(outcomes);
  publishChatEvents(chatEvents.filter((event): event is ChatEvent => event !== null));
  if (notice) {
    try {
      await notice();
    } catch (error) {
      console.error(`Food notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function notifyFood(type: NotificationType, activity: Locked["activity"], to: string, dedupeKey: string, kind?: string) {
  const participants = [activity.creatorId, activity.accepterId].filter((id): id is string => !!id);
  const context = await activityContext(activity.id, "FOOD", participants);
  await notify({
    type,
    userIds: [to],
    dedupeKey,
    activityId: activity.id,
    data: { activityType: "FOOD", chatId: context.chatId ?? undefined, ...(kind && { kind }) },
    dataFor: (userId) => ({ name: context.otherName(userId) }),
  });
}

// Confirms the current version for `userId`; when both have confirmed, the
// request becomes ORDER_CONFIRMED and the payment record takes the confirmed
// amounts and method.
async function confirmLocked(tx: Tx, locked: Locked, userId: string, now: Date) {
  const { activity, food } = locked;
  const isRequester = userId === activity.creatorId;
  const requesterConfirmedAt = isRequester ? (food.requesterConfirmedAt ?? now) : food.requesterConfirmedAt;
  const accepterConfirmedAt = isRequester ? food.accepterConfirmedAt : (food.accepterConfirmedAt ?? now);
  await tx.foodRequest.update({ where: { activityId: activity.id }, data: { requesterConfirmedAt, accepterConfirmedAt } });
  if (!requesterConfirmedAt || !accepterConfirmedAt || activity.subStatus === "ORDER_CONFIRMED") return null;

  const outcome = await applyTransition(tx, activity, "CONFIRM_ORDER", { type: "USER", id: userId }, { now });
  await updateFoodPaymentRecord(tx, activity.id, {
    foodCost: food.orderFoodPrice!,
    deliveryCharge: food.orderDeliveryCharge!,
    method: food.orderPaymentMethod,
  });
  return outcome;
}

// PUT /api/food/requests/:id/order
export async function saveOrderDetails(viewer: Viewer, activityId: string, input: OrderInput, now = new Date()) {
  const result = await runActivityTransaction(async (tx) => {
    const locked = await lockFood(tx, activityId);
    const { activity, food } = locked;
    assertParticipant(activity, viewer.id);
    assertOrderOpen(activity);
    await assertNotPaid(tx, activityId);

    const unchanged =
      food.orderVersion > 0 &&
      food.orderItems === input.items &&
      sameMoney(food.orderFoodPrice, input.foodPrice) &&
      sameMoney(food.orderDeliveryCharge, input.deliveryCharge) &&
      food.orderPaymentMethod === input.paymentMethod;
    // Saving the same details again is a confirmation of them
    if (unchanged) return { outcomes: [await confirmLocked(tx, locked, viewer.id, now)], events: [], changed: false, version: food.orderVersion };

    const version = food.orderVersion + 1;
    const isRequester = viewer.id === activity.creatorId;
    await tx.foodRequest.update({
      where: { activityId },
      data: {
        orderItems: input.items,
        orderFoodPrice: decimal(input.foodPrice),
        orderDeliveryCharge: decimal(input.deliveryCharge),
        orderPaymentMethod: input.paymentMethod,
        orderVersion: version,
        orderUpdatedById: viewer.id,
        orderUpdatedAt: now,
        // The saver confirms; the other must confirm this version again
        requesterConfirmedAt: isRequester ? now : null,
        accepterConfirmedAt: isRequester ? null : now,
      },
    });
    // A pending approval was about the old details
    await tx.foodBudgetApproval.updateMany({
      where: { foodRequestId: food.id, status: "PENDING" },
      data: { status: "WITHDRAWN", decidedAt: now },
    });
    const reopened =
      activity.subStatus === "ORDER_CONFIRMED" ? await applyTransition(tx, activity, "REOPEN_ORDER", { type: "USER", id: viewer.id }, { now }) : null;
    const message = await postFoodMessage(tx, activity, { kind: "SYSTEM", code: "ORDER_UPDATED", senderId: viewer.id });
    return { outcomes: [reopened], events: [message], changed: true, version };
  });

  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: engineActivitySelect });
  await afterCommit(result.outcomes, result.events, async () => {
    if (!result.changed || !activity) return;
    const other = viewer.id === activity.creatorId ? activity.accepterId : activity.creatorId;
    if (other) await notifyFood("FOOD_ORDER_TO_CONFIRM", activity, other, `FOOD_ORDER_TO_CONFIRM:${activityId}:${result.version}`);
  });
  return getFoodRequest(viewer.id, activityId, now);
}

// POST /api/food/requests/:id/order/confirm { version }
export async function confirmOrderDetails(viewer: Viewer, activityId: string, version: number, now = new Date()) {
  const outcome = await runActivityTransaction(async (tx) => {
    const locked = await lockFood(tx, activityId);
    assertParticipant(locked.activity, viewer.id);
    if (locked.activity.status !== "ACCEPTED" || locked.activity.subStatus !== null) {
      if (locked.activity.status === "ACCEPTED" && locked.activity.subStatus === "ORDER_CONFIRMED") return null;
      throw new AppError(409, "ORDER_LOCKED", "The order details can no longer be changed");
    }
    if (locked.food.orderVersion === 0) throw new AppError(409, "ORDER_NOT_SET", "The order details have not been filled in yet");
    // A confirmation always names the version it confirms (B4)
    if (locked.food.orderVersion !== version) {
      throw new AppError(409, "ORDER_CHANGED", "The order details changed. Check them again before confirming", {
        data: { version: locked.food.orderVersion },
      });
    }
    return confirmLocked(tx, locked, viewer.id, now);
  });
  await afterCommit([outcome], []);
  return getFoodRequest(viewer.id, activityId, now);
}

// POST /api/food/requests/:id/budget-approvals { amount }: the accepter, after
// the order is confirmed and before buying (10.4, B4 Q1).
export async function requestBudgetApproval(viewer: Viewer, activityId: string, amount: number, now = new Date()) {
  const result = await runActivityTransaction(async (tx) => {
    const locked = await lockFood(tx, activityId);
    const { activity, food } = locked;
    assertParticipant(activity, viewer.id);
    if (viewer.id !== activity.accepterId) throw new AppError(403, "ACTION_NOT_ALLOWED", "Only the person buying the food can ask for this");
    if (activity.status !== "ACCEPTED" || activity.subStatus !== "ORDER_CONFIRMED") {
      throw new AppError(409, "ORDER_NOT_CONFIRMED", "Both of you confirm the order details first");
    }
    if (decimal(amount).lessThanOrEqualTo(food.orderFoodPrice!)) {
      throw new AppError(400, "AMOUNT_NOT_HIGHER", "Ask only for a price above the confirmed one", { fields: { amount: ["Choose a higher amount"] } });
    }
    const pending = await tx.foodBudgetApproval.findFirst({ where: { foodRequestId: food.id, status: "PENDING" }, select: { id: true } });
    if (pending) throw new AppError(409, "APPROVAL_PENDING", "Wait for the answer to your earlier request", { data: { approvalId: pending.id } });

    const approval = await tx.foodBudgetApproval.create({
      data: { foodRequestId: food.id, requestedById: viewer.id, previousAmount: food.orderFoodPrice!, amount: decimal(amount) },
      select: { id: true },
    });
    const message = await postFoodMessage(tx, activity, { kind: "APPROVAL", senderId: viewer.id, refId: approval.id });
    return { activity, approvalId: approval.id, message };
  });

  await afterCommit([], [result.message], () =>
    notifyFood("FOOD_BUDGET_APPROVAL_REQUESTED", result.activity, result.activity.creatorId, `FOOD_BUDGET_APPROVAL_REQUESTED:${result.approvalId}`),
  );
  return getFoodRequest(viewer.id, activityId, now);
}

// POST /api/food/requests/:id/budget-approvals/:approvalId/(approve|reject):
// the requester decides, once. The decision is recorded on the approval.
export async function decideBudgetApproval(viewer: Viewer, activityId: string, approvalId: string, approve: boolean, now = new Date()) {
  const result = await runActivityTransaction(async (tx) => {
    const locked = await lockFood(tx, activityId);
    const { activity, food } = locked;
    assertParticipant(activity, viewer.id);
    if (viewer.id !== activity.creatorId) throw new AppError(403, "ACTION_NOT_ALLOWED", "Only the requester can decide this");
    const approval = await tx.foodBudgetApproval.findFirst({ where: { id: approvalId, foodRequestId: food.id }, select: { id: true, amount: true, status: true } });
    if (!approval) throw new AppError(404, "APPROVAL_NOT_FOUND", "This approval request was not found");
    if (approval.status !== "PENDING") throw new AppError(409, "APPROVAL_DECIDED", "This request was already answered or withdrawn");
    if (activity.status !== "ACCEPTED" || activity.subStatus !== "ORDER_CONFIRMED") throw invalidTransition();

    const decided = await tx.foodBudgetApproval.updateMany({
      where: { id: approval.id, status: "PENDING" },
      data: { status: approve ? "APPROVED" : "REJECTED", decidedById: viewer.id, decidedAt: now },
    });
    if (decided.count === 0) throw new AppError(409, "APPROVAL_DECIDED", "This request was already answered or withdrawn");

    if (approve) {
      // The approval is the requester's confirmation of the new price, so
      // the order stays confirmed (B4).
      await tx.foodRequest.update({
        where: { activityId },
        data: {
          orderFoodPrice: approval.amount,
          orderVersion: food.orderVersion + 1,
          orderUpdatedById: viewer.id,
          orderUpdatedAt: now,
          requesterConfirmedAt: now,
        },
      });
      await updateFoodPaymentRecord(tx, activityId, { foodCost: approval.amount, deliveryCharge: food.orderDeliveryCharge! });
    }
    const message = await postFoodMessage(tx, activity, { kind: "SYSTEM", code: approve ? "BUDGET_APPROVED" : "BUDGET_REJECTED", senderId: viewer.id });
    return { activity, message };
  });

  await afterCommit([], [result.message], async () => {
    if (result.activity.accepterId) {
      await notifyFood("FOOD_BUDGET_APPROVAL_DECIDED", result.activity, result.activity.accepterId, `FOOD_BUDGET_APPROVAL_DECIDED:${approvalId}`, approve ? "APPROVED" : "REJECTED");
    }
  });
  return getFoodRequest(viewer.id, activityId, now);
}

// POST /api/food/requests/:id/receipt (multipart: receipt photo + actualCost):
// the accepter, once the order is confirmed (10.3 step 4). The cost may not be
// above the confirmed price; a higher one needs an approval first (10.4).
export async function uploadReceipt(viewer: Viewer, activityId: string, file: Uint8Array, actualCost: number, now = new Date()) {
  // Checked before the photo is processed, and again under the lock
  await runActivityTransaction(async (tx) => assertCanCollect(await lockFood(tx, activityId), viewer.id, actualCost));

  const jpeg = await encodeChatImage(file);
  const key = await putPrivateFile(rules.food.receiptFolder, jpeg, "image/jpeg");
  let result: { outcome: TransitionOutcome | null; message: ChatEvent | null };
  try {
    result = await runActivityTransaction(async (tx) => {
      const locked = await lockFood(tx, activityId);
      assertCanCollect(locked, viewer.id, actualCost);
      const { activity, food } = locked;
      await tx.foodReceipt.create({
        data: { foodRequestId: food.id, uploadedById: viewer.id, fileKey: key, mimeType: "image/jpeg", sizeBytes: jpeg.length, amount: decimal(actualCost) },
      });
      // Not needed any more: the food was bought within the confirmed price
      await tx.foodBudgetApproval.updateMany({ where: { foodRequestId: food.id, status: "PENDING" }, data: { status: "WITHDRAWN", decidedAt: now } });
      const outcome = await applyTransition(tx, activity, "COLLECT_FOOD", { type: "USER", id: viewer.id }, { now });
      // The receipt in the chat too (10.3: food chats allow receipt images)
      const message = await postFoodMessage(tx, activity, { kind: "IMAGE", senderId: viewer.id, attachmentKey: key });
      await updateFoodPaymentRecord(tx, activityId, { foodCost: decimal(actualCost), deliveryCharge: food.orderDeliveryCharge! });
      return { outcome, message };
    });
  } catch (error) {
    await deletePrivateFile(key);
    throw error;
  }
  await afterCommit([result.outcome], [result.message]);
  return getFoodRequest(viewer.id, activityId, now);
}

function assertCanCollect(locked: Locked, userId: string, actualCost: number) {
  const { activity, food } = locked;
  assertParticipant(activity, userId);
  if (userId !== activity.accepterId) throw new AppError(403, "ACTION_NOT_ALLOWED", "Only the person buying the food uploads the receipt");
  if (activity.status !== "ACCEPTED" || activity.subStatus !== "ORDER_CONFIRMED") {
    throw new AppError(409, "ORDER_NOT_CONFIRMED", "Both of you confirm the order details before the food is bought");
  }
  if (decimal(actualCost).greaterThan(food.orderFoodPrice!)) {
    throw new AppError(409, "OVER_BUDGET_APPROVAL_REQUIRED", "The cost is above the confirmed price. Ask the requester to approve it first", {
      data: { confirmedPrice: Number(food.orderFoodPrice) },
      fields: { actualCost: ["Above the confirmed price"] },
    });
  }
}
