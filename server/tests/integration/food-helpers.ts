import sharp from "sharp";
import { expect } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { fromNow, HOUR, verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";
import { subArea } from "./ride-helpers.js";

// Food Delivery test helpers (B4).

export const restaurant = { address: "Star Kabab, Dhanmondi", lat: 23.7465, lng: 90.3762 };
export const hall = { address: "Shahidullah Hall", lat: 23.7266, lng: 90.3984 };

export function foodBody(subAreaId: string, overrides: Record<string, unknown> = {}) {
  return {
    restaurantName: "Star Kabab",
    restaurant,
    items: "2 chicken biryani, 1 borhani",
    details: "Less spicy please",
    quantity: 3,
    estimatedBudget: 600,
    pickup: restaurant,
    delivery: hall,
    subAreaId,
    expectedDeliveryTime: fromNow(3 * HOUR).toISOString(),
    deliveryCharge: 60,
    ...overrides,
  };
}

export const postFood = (token: string, body: Record<string, unknown>) => api().post("/api/food/requests").set(bearer(token)).send(body);
export const acceptFood = (token: string, id: string) => api().post(`/api/food/requests/${id}/accept`).set(bearer(token));
export const getFood = (token: string, id: string) => api().get(`/api/food/requests/${id}`).set(bearer(token));
export const saveOrder = (token: string, id: string, body: Record<string, unknown> = {}) =>
  api()
    .put(`/api/food/requests/${id}/order`)
    .set(bearer(token))
    .send({ items: "2 chicken biryani, 1 borhani", foodPrice: 580, deliveryCharge: 60, paymentMethod: "BKASH", ...body });
export const confirmOrder = (token: string, id: string, version: number) =>
  api().post(`/api/food/requests/${id}/order/confirm`).set(bearer(token)).send({ version });
export const askApproval = (token: string, id: string, amount: number) =>
  api().post(`/api/food/requests/${id}/budget-approvals`).set(bearer(token)).send({ amount });
export const decide = (token: string, id: string, approvalId: string, approve: boolean) =>
  api().post(`/api/food/requests/${id}/budget-approvals/${approvalId}/${approve ? "approve" : "reject"}`).set(bearer(token));
export const cancel = (token: string, id: string, reason = "Plans changed") => api().post(`/api/activities/${id}/cancel`).set(bearer(token)).send({ reason });

export const receiptImage = () => sharp({ create: { width: 40, height: 60, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer();

export async function uploadReceipt(token: string, id: string, actualCost: number | string) {
  return api()
    .post(`/api/food/requests/${id}/receipt`)
    .set(bearer(token))
    .field("actualCost", String(actualCost))
    .attach("receipt", await receiptImage(), { filename: "bill.jpg", contentType: "image/jpeg" });
}

// An OPEN food request by a new verified student.
export async function openFood(overrides: Record<string, unknown> = {}) {
  const area = await subArea();
  const requester = await verifiedUser();
  const response = await postFood(requester.accessToken, foodBody(area.id, overrides));
  expect(response.status).toBe(201);
  return { area, requester, request: response.body.request as { id: string } };
}

// An accepted food request.
export async function acceptedFood(overrides: Record<string, unknown> = {}) {
  const { area, requester, request } = await openFood(overrides);
  const accepter = await verifiedUser();
  const accepted = await acceptFood(accepter.accessToken, request.id);
  expect(accepted.status).toBe(200);
  return { area, requester, accepter, id: request.id };
}

// Accepted, with the order details saved by the accepter and confirmed by the requester.
export async function confirmedFood(order: Record<string, unknown> = {}) {
  const food = await acceptedFood();
  const saved = await saveOrder(food.accepter.accessToken, food.id, order);
  expect(saved.status).toBe(200);
  const confirmed = await confirmOrder(food.requester.accessToken, food.id, saved.body.request.order.version);
  expect(confirmed.body.request.subStatus).toBe("ORDER_CONFIRMED");
  return food;
}

// Confirmed, receipt uploaded: IN_PROGRESS + FOOD_COLLECTED.
export async function collectedFood(actualCost = 560) {
  const food = await confirmedFood();
  const response = await uploadReceipt(food.accepter.accessToken, food.id, actualCost);
  expect(response.status).toBe(201);
  return food;
}

export const activityRow = (id: string) => prisma.activity.findUniqueOrThrow({ where: { id } });
export const paymentRow = (id: string) => prisma.paymentRecord.findUniqueOrThrow({ where: { activityId: id } });
