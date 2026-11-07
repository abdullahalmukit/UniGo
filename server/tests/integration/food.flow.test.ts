import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { fromNow, MINUTE, verifiedUser } from "./activity-helpers.js";
import { api, bearer, files, registerUser } from "./helpers.js";
import {
  acceptedFood,
  activityRow,
  askApproval,
  cancel,
  collectedFood,
  confirmedFood,
  confirmOrder,
  decide,
  getFood,
  paymentRow,
  saveOrder,
  uploadReceipt,
} from "./food-helpers.js";
import { channelsOf, settle } from "./notification-helpers.js";

const money = (value: unknown) => Number(value);

describe("order details and ORDER_CONFIRMED (10.3 step 3)", () => {
  it("needs both to confirm the same version; the saver's save counts as their confirmation", async () => {
    const { requester, accepter, id } = await acceptedFood();
    expect((await confirmOrder(requester.accessToken, id, 1)).body.error.code).toBe("ORDER_NOT_SET");

    const saved = await saveOrder(accepter.accessToken, id);
    expect(saved.body.request.subStatus).toBeNull();
    expect(saved.body.request.order).toMatchObject({ version: 1, foodPrice: 580, deliveryCharge: 60, paymentMethod: "BKASH", confirmedByMe: true, confirmedByOther: false });
    await settle();
    expect(await channelsOf(requester.id, "FOOD_ORDER_TO_CONFIRM")).toEqual(["IN_APP", "PUSH"]);

    // A stranger cannot see or change it; the saver confirming again changes nothing
    expect((await saveOrder((await verifiedUser()).accessToken, id)).body.error.code).toBe("NOT_PARTICIPANT");
    expect((await confirmOrder(accepter.accessToken, id, 1)).body.request.subStatus).toBeNull();

    const confirmed = await confirmOrder(requester.accessToken, id, 1);
    expect(confirmed.body.request).toMatchObject({ status: "ACCEPTED", subStatus: "ORDER_CONFIRMED" });
    // The payment record takes the confirmed amounts and method
    const payment = await paymentRow(id);
    expect([money(payment.foodCost), money(payment.deliveryCharge), money(payment.amount), payment.method]).toEqual([580, 60, 640, "BKASH"]);
    const messages = await prisma.message.findMany({ where: { chat: { activityId: id }, kind: "SYSTEM" }, orderBy: { createdAt: "asc" } });
    expect(messages.map((m) => m.systemCode)).toEqual(["ACCEPTED", "ORDER_UPDATED", "ORDER_CONFIRMED"]);
  });

  it("resets the confirmation on any change after it and needs confirming again", async () => {
    const { requester, accepter, id } = await confirmedFood();

    const changed = await saveOrder(requester.accessToken, id, { deliveryCharge: 70 });
    expect(changed.body.request.subStatus).toBeNull();
    expect(changed.body.request.order).toMatchObject({ version: 2, deliveryCharge: 70, confirmedByMe: true, confirmedByOther: false });
    const history = await prisma.activityStatusHistory.findMany({ where: { activityId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(history.map((h) => h.toSubStatus)).toEqual([null, null, "ORDER_CONFIRMED", null]);
    // Not bought before confirming again
    expect((await uploadReceipt(accepter.accessToken, id, 500)).body.error.code).toBe("ORDER_NOT_CONFIRMED");

    // A confirmation of an old version is refused
    expect((await confirmOrder(accepter.accessToken, id, 1)).body.error).toMatchObject({ code: "ORDER_CHANGED" });
    expect((await confirmOrder(accepter.accessToken, id, 2)).body.request.subStatus).toBe("ORDER_CONFIRMED");
    expect(money((await paymentRow(id)).deliveryCharge)).toBe(70);
  });

  it("treats saving the same details again as a confirmation", async () => {
    const { requester, accepter, id } = await acceptedFood();
    await saveOrder(accepter.accessToken, id);
    const same = await saveOrder(requester.accessToken, id);
    expect(same.body.request.subStatus).toBe("ORDER_CONFIRMED");
    expect(same.body.request.order.version).toBe(1);
  });

  it("refuses the payment-method endpoint for food: the method is part of the order", async () => {
    const { requester, id } = await acceptedFood();
    const response = await api().patch(`/api/activities/${id}/payment`).set(bearer(requester.accessToken)).send({ method: "CASH" });
    expect(response.body.error.code).toBe("USE_ORDER_DETAILS");
  });
});

describe("receipt and FOOD_COLLECTED (10.3 step 4)", () => {
  it("needs the confirmed order and the accepter's receipt to reach IN_PROGRESS; there is no Start", async () => {
    const { requester, accepter, id } = await acceptedFood();
    expect((await api().post(`/api/activities/${id}/start`).set(bearer(accepter.accessToken))).body.error.code).toBe("INVALID_TRANSITION");
    expect((await uploadReceipt(accepter.accessToken, id, 500)).body.error.code).toBe("ORDER_NOT_CONFIRMED");

    await saveOrder(accepter.accessToken, id);
    await confirmOrder(requester.accessToken, id, 1);
    expect((await uploadReceipt(requester.accessToken, id, 500)).body.error.code).toBe("ACTION_NOT_ALLOWED");
    // The receipt is required: no file, a non-image or no cost is refused
    const noFile = await api().post(`/api/food/requests/${id}/receipt`).set(bearer(accepter.accessToken)).field("actualCost", "500");
    expect(noFile.body.error.code).toBe("FILE_REQUIRED");
    const pdf = await api()
      .post(`/api/food/requests/${id}/receipt`)
      .set(bearer(accepter.accessToken))
      .field("actualCost", "500")
      .attach("receipt", files.pdf, { filename: "bill.pdf", contentType: "application/pdf" });
    expect(pdf.body.error.code).toBe("IMAGE_TYPE_NOT_ALLOWED");
    expect((await uploadReceipt(accepter.accessToken, id, "")).body.error.code).toBe("VALIDATION_ERROR");
    expect((await activityRow(id)).status).toBe("ACCEPTED");

    const response = await uploadReceipt(accepter.accessToken, id, 560);
    expect(response.status).toBe(201);
    expect(response.body.request).toMatchObject({ status: "IN_PROGRESS", subStatus: "FOOD_COLLECTED" });
    expect(response.body.request.receipts).toHaveLength(1);
    expect(response.body.request.receipts[0]).toMatchObject({ actualCost: 560 });
    expect(response.body.request.receipts[0].image.url).toContain("/api/files/");
    // The payment record takes the actual cost; the receipt is in the chat too
    expect([money((await paymentRow(id)).foodCost), money((await paymentRow(id)).amount)]).toEqual([560, 620]);
    expect(await prisma.message.count({ where: { chat: { activityId: id }, kind: "IMAGE" } })).toBe(1);
    // The order is locked now
    expect((await saveOrder(requester.accessToken, id, { foodPrice: 600 })).body.error.code).toBe("ORDER_LOCKED");
  });
});

describe("over-budget approval (10.4, B4 Q1)", () => {
  it("refuses a receipt above the confirmed price until the requester approves the new amount", async () => {
    const { requester, accepter, id } = await confirmedFood();
    const over = await uploadReceipt(accepter.accessToken, id, 650);
    expect(over.body.error).toMatchObject({ code: "OVER_BUDGET_APPROVAL_REQUIRED", confirmedPrice: 580 });

    expect((await askApproval(requester.accessToken, id, 650)).body.error.code).toBe("ACTION_NOT_ALLOWED");
    expect((await askApproval(accepter.accessToken, id, 580)).body.error.code).toBe("AMOUNT_NOT_HIGHER");
    const asked = await askApproval(accepter.accessToken, id, 650);
    expect(asked.status).toBe(201);
    const approval = asked.body.request.approvals[0];
    expect(approval).toMatchObject({ amount: 650, previousAmount: 580, status: "PENDING" });
    expect((await askApproval(accepter.accessToken, id, 700)).body.error.code).toBe("APPROVAL_PENDING");

    // The card in the chat
    const chatId = asked.body.request.chatId;
    const messages = await api().get(`/api/chats/${chatId}/messages`).set(bearer(requester.accessToken));
    const card = messages.body.messages.find((m: { kind: string }) => m.kind === "APPROVAL");
    expect(card.approval).toMatchObject({ id: approval.id, amount: 650, status: "PENDING" });
    await settle();
    expect(await channelsOf(requester.id, "FOOD_BUDGET_APPROVAL_REQUESTED")).toEqual(["IN_APP", "PUSH"]);
    // No "new chat message" notification for the card itself
    expect(await channelsOf(requester.id, "NEW_CHAT_MESSAGE")).toEqual([]);

    expect((await decide(accepter.accessToken, id, approval.id, true)).body.error.code).toBe("ACTION_NOT_ALLOWED");
    const approved = await decide(requester.accessToken, id, approval.id, true);
    expect(approved.body.request).toMatchObject({ subStatus: "ORDER_CONFIRMED", order: { foodPrice: 650, version: 2 } });
    expect(approved.body.request.approvals[0]).toMatchObject({ status: "APPROVED" });
    expect((await decide(requester.accessToken, id, approval.id, false)).body.error.code).toBe("APPROVAL_DECIDED");
    expect(await prisma.foodBudgetApproval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "APPROVED", decidedById: requester.id });
    await settle();
    expect(await channelsOf(accepter.id, "FOOD_BUDGET_APPROVAL_DECIDED")).toEqual(["IN_APP", "PUSH"]);
    expect(money((await paymentRow(id)).foodCost)).toBe(650);

    expect((await uploadReceipt(accepter.accessToken, id, 650)).status).toBe(201);
  });

  it("keeps the price when the requester rejects, and records the decision", async () => {
    const { requester, accepter, id } = await confirmedFood();
    const approval = (await askApproval(accepter.accessToken, id, 700)).body.request.approvals[0];
    const rejected = await decide(requester.accessToken, id, approval.id, false);
    expect(rejected.body.request).toMatchObject({ subStatus: "ORDER_CONFIRMED", order: { foodPrice: 580 } });
    expect(rejected.body.request.approvals[0].status).toBe("REJECTED");
    expect((await uploadReceipt(accepter.accessToken, id, 700)).body.error.code).toBe("OVER_BUDGET_APPROVAL_REQUIRED");
    const codes = (await prisma.message.findMany({ where: { chat: { activityId: id }, kind: "SYSTEM" } })).map((m) => m.systemCode);
    expect(codes).toContain("BUDGET_REJECTED");
  });

  it("withdraws a pending approval when the order details change", async () => {
    const { requester, accepter, id } = await confirmedFood();
    const approval = (await askApproval(accepter.accessToken, id, 700)).body.request.approvals[0];
    await saveOrder(requester.accessToken, id, { items: "1 chicken biryani" });
    expect((await prisma.foodBudgetApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("WITHDRAWN");
    expect((await decide(requester.accessToken, id, approval.id, true)).body.error.code).toBe("APPROVAL_DECIDED");
  });
});

describe("cancelling food (5.8, B4)", () => {
  it("lets either side cancel with a reason before the receipt, with the late flag", async () => {
    const { requester, accepter, id } = await confirmedFood();
    expect((await api().post(`/api/activities/${id}/cancel`).set(bearer(requester.accessToken)).send({})).status).toBe(400);
    await prisma.activity.update({ where: { id }, data: { startTime: fromNow(30 * MINUTE) } });
    const response = await cancel(requester.accessToken, id);
    expect(response.status).toBe(200);
    expect(await activityRow(id)).toMatchObject({ status: "CANCELLED", cancelledById: requester.id, isLateCancellation: true });
    await settle();
    expect(await channelsOf(accepter.id, "ACTIVITY_CANCELLED")).toContain("IN_APP");
  });

  it("lets only the accepter cancel after the receipt; the requester cannot", async () => {
    const { requester, accepter, id } = await collectedFood();
    expect((await cancel(requester.accessToken, id)).body.error.code).toBe("ACTION_NOT_ALLOWED");
    expect((await activityRow(id)).status).toBe("IN_PROGRESS");
    expect((await cancel(accepter.accessToken, id, "Shop closed after buying")).status).toBe(200);
    expect(await activityRow(id)).toMatchObject({ status: "CANCELLED", cancelledById: accepter.id });
  });
});

describe("completion, reviews and payment (10.3 steps 5-6, proposal 16)", () => {
  it("completes in two steps and lets both review", async () => {
    const { requester, accepter, id } = await collectedFood();
    expect((await api().post(`/api/activities/${id}/request-completion`).set(bearer(accepter.accessToken))).status).toBe(200);
    // Nobody finalises alone
    expect((await api().post(`/api/activities/${id}/confirm-completion`).set(bearer(accepter.accessToken))).status).toBe(403);
    const done = await api().post(`/api/activities/${id}/confirm-completion`).set(bearer(requester.accessToken));
    expect(done.body.activity.status).toBe("COMPLETED");
    expect((await api().post(`/api/activities/${id}/review`).set(bearer(requester.accessToken)).send({ rating: 5 })).status).toBe(201);
    expect((await api().post(`/api/activities/${id}/review`).set(bearer(accepter.accessToken)).send({ rating: 4 })).status).toBe(201);
    const stats = (await api().get(`/api/users/${accepter.id}/profile`).set(bearer(requester.accessToken))).body.profile;
    expect(stats.completed ?? stats.stats?.completed).toBe(1);
  });

  it("lets only the accepter mark PAID, from ORDER_CONFIRMED on, never when cancelled (B4 Q3)", async () => {
    const { requester, accepter, id } = await acceptedFood();
    const paid = (token: string) => api().post(`/api/activities/${id}/payment/paid`).set(bearer(token));
    // Before the order is confirmed: no method and not due
    expect((await paid(accepter.accessToken)).body.error.code).toBe("PAYMENT_NOT_DUE");
    await saveOrder(accepter.accessToken, id, { paymentMethod: "NAGAD" });
    expect((await paid(accepter.accessToken)).body.error.code).toBe("PAYMENT_NOT_DUE");
    await confirmOrder(requester.accessToken, id, 1);

    const view = await api().get(`/api/activities/${id}/payment`).set(bearer(requester.accessToken));
    expect(view.body.payment).toMatchObject({ foodCost: 580, deliveryCharge: 60, amount: 640, method: "NAGAD", payee: "OTHER", canChooseMethod: false, canMarkPaid: false });
    expect((await paid(requester.accessToken)).body.error.code).toBe("NOT_PAYEE");
    const marked = await paid(accepter.accessToken);
    expect(marked.body.payment).toMatchObject({ status: "PAID", payee: "ME" });
    // A paid order cannot change; its record stays as paid
    expect((await saveOrder(requester.accessToken, id, { foodPrice: 500 })).body.error.code).toBe("ORDER_PAID");
    expect((await uploadReceipt(accepter.accessToken, id, 570)).status).toBe(201);
    expect(money((await paymentRow(id)).foodCost)).toBe(580);
  });

  it("cannot be marked paid once cancelled", async () => {
    const { requester, accepter, id } = await confirmedFood();
    await cancel(requester.accessToken, id);
    expect((await api().post(`/api/activities/${id}/payment/paid`).set(bearer(accepter.accessToken))).body.error.code).toBe("PAYMENT_NOT_DUE");
  });
});

describe("Activity, Upcoming and details", () => {
  it("shows food in My Orders, Accepted Orders and Upcoming", async () => {
    const { requester, accepter, id } = await confirmedFood();
    const feed = async (token: string, query: Record<string, unknown>) =>
      (await api().get("/api/activity").query(query).set(bearer(token))).body.items as { id: string; feature: string; food: { restaurantName: string } }[];
    const mine = await feed(requester.accessToken, { feature: "food", role: "requested" });
    expect(mine.map((i) => i.id)).toEqual([id]);
    expect(mine[0]).toMatchObject({ feature: "FOOD", kind: "FOOD", food: { restaurantName: "Star Kabab", foodPrice: 580, deliveryCharge: 60 } });
    expect((await feed(accepter.accessToken, { feature: "food", role: "accepted" })).map((i) => i.id)).toEqual([id]);
    expect(await feed(requester.accessToken, { feature: "food", role: "accepted" })).toEqual([]);
    expect(await feed(requester.accessToken, { feature: "ride" })).toEqual([]);
    const upcoming = (await api().get("/api/upcoming").set(bearer(accepter.accessToken))).body.items;
    expect(upcoming.map((i: { id: string }) => i.id)).toEqual([id]);
  });

  it("never shows another user's email; shows the order only to participants", async () => {
    const { requester, accepter, id } = await confirmedFood();
    const body = JSON.stringify((await getFood(requester.accessToken, id)).body);
    expect(body).not.toContain(accepter.email);
    expect(body).not.toContain(requester.email);
  });
});

describe("admin Food module (proposal 17)", () => {
  it("lists, shows and cancels food requests for Moderators, audited, both notified", async () => {
    const { requester, accepter, id } = await collectedFood();
    const moderator = await registerUser({ role: "MODERATOR", studentVerificationStatus: "VERIFIED" });

    expect((await api().get("/api/admin/food").set(bearer(requester.accessToken))).status).toBe(403);
    const list = await api().get("/api/admin/food").query({ status: "IN_PROGRESS" }).set(bearer(moderator.accessToken));
    expect(list.body).toMatchObject({ total: 1, items: [{ id, restaurantName: "Star Kabab", requester: { id: requester.id }, accepter: { id: accepter.id } }] });
    expect((await api().get("/api/admin/food").query({ q: "nobody-matches" }).set(bearer(moderator.accessToken))).body.total).toBe(0);

    const detail = (await api().get(`/api/admin/food/${id}`).set(bearer(moderator.accessToken))).body.food;
    expect(detail.history.map((h: { toSubStatus: string | null }) => h.toSubStatus)).toEqual([null, null, "ORDER_CONFIRMED", "FOOD_COLLECTED"]);
    expect(detail.order).toMatchObject({ foodPrice: 580, deliveryCharge: 60 });
    expect(detail.receipts[0].image.url).toContain("/api/files/");
    expect(detail.payment).toMatchObject({ foodCost: 560, deliveryCharge: 60, payeeId: accepter.id });

    expect((await api().post(`/api/admin/food/${id}/cancel`).set(bearer(moderator.accessToken)).send({})).status).toBe(400);
    const cancelled = await api().post(`/api/admin/food/${id}/cancel`).set(bearer(moderator.accessToken)).send({ reason: "Reported as a scam" });
    expect(cancelled.body.food.status).toBe("CANCELLED");
    await settle();
    expect(await channelsOf(requester.id, "ACTIVITY_CANCELLED")).toContain("IN_APP");
    expect(await channelsOf(accepter.id, "ACTIVITY_CANCELLED")).toContain("IN_APP");
    expect(await prisma.auditLog.count({ where: { action: "FOOD_CANCELLED_BY_ADMIN", targetId: id } })).toBe(1);
  });
});
