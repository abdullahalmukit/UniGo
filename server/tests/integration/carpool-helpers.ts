import { expect } from "vitest";
import type { VehicleType } from "../../src/generated/prisma/client.js";
import { addDays } from "../../src/modules/carpool/carpool-dates.js";
import { dhakaDateString } from "../../src/utils/time.js";
import { verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";
import { activeRider } from "./ride-helpers.js";

// Carpool test helpers (B6a). Days are bitmasks: bit 0 = Sunday ... bit 6 = Saturday.

export const EVERY_DAY = 127;
export const today = (now = new Date()) => dhakaDateString(now);
export const inDays = (days: number, now = new Date()) => addDays(today(now), days);

const campus = { address: "Campus gate", lat: 23.8103, lng: 90.4125 };
const farmgate = { address: "Farmgate", lat: 23.7576, lng: 90.3899 };

export function postBody(vehicleId: string, overrides: Record<string, unknown> = {}) {
  return {
    daysOfWeek: EVERY_DAY,
    departureMinute: 8 * 60,
    pickup: campus,
    destination: farmgate,
    vehicleId,
    seats: 2,
    notes: "Leaves from the main gate",
    prices: [
      { durationMonths: 1, monthlyPrice: 2000 },
      { durationMonths: 2, monthlyPrice: 1900 },
      { durationMonths: 3, monthlyPrice: 1800 },
      { durationMonths: 4, monthlyPrice: 1700 },
    ],
    validFrom: today(),
    validUntil: null,
    ...overrides,
  };
}

export const createPost = (token: string, body: Record<string, unknown>) => api().post("/api/carpool/posts").set(bearer(token)).send(body);
export const requestSeat = (token: string, postId: string, body: Record<string, unknown> = {}) =>
  api()
    .post(`/api/carpool/posts/${postId}/bookings`)
    .set(bearer(token))
    .send({ durationMonths: 1, startDate: inDays(3), ...body });
export const acceptSeat = (token: string, id: string) => api().post(`/api/carpool/bookings/${id}/accept`).set(bearer(token));
export const rejectSeat = (token: string, id: string, reason?: string) =>
  api().post(`/api/carpool/bookings/${id}/reject`).set(bearer(token)).send(reason ? { reason } : {});
export const agree = (token: string, id: string) => api().post(`/api/carpool/bookings/${id}/agree`).set(bearer(token));
export const getBooking = (token: string, id: string) => api().get(`/api/carpool/bookings/${id}`).set(bearer(token));
export const getPost = (token: string, id: string) => api().get(`/api/carpool/posts/${id}`).set(bearer(token));

// An Active rider with a post.
export async function riderWithPost(overrides: Record<string, unknown> = {}, type: VehicleType = "CAR") {
  const rider = await activeRider(type);
  const response = await createPost(rider.accessToken, postBody(rider.vehicle.id, overrides));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { rider, post: response.body.post as { id: string; seatsAvailable: number; status: string } };
}

// A booking request by a new verified student.
export async function requested(postId: string, body: Record<string, unknown> = {}) {
  const passenger = await verifiedUser();
  const response = await requestSeat(passenger.accessToken, postId, body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { passenger, id: response.body.booking.activityId as string };
}

// A held seat: requested, then accepted by the rider.
export async function heldSeat(overrides: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  const { rider, post } = await riderWithPost(overrides);
  const { passenger, id } = await requested(post.id, body);
  const accepted = await acceptSeat(rider.accessToken, id);
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  return { rider, post, passenger, id };
}

// A contract: held, then both pressed Agree.
export async function contracted(overrides: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  const held = await heldSeat(overrides, body);
  expect((await agree(held.rider.accessToken, held.id)).status).toBe(200);
  const second = await agree(held.passenger.accessToken, held.id);
  expect(second.status, JSON.stringify(second.body)).toBe(200);
  return held;
}
