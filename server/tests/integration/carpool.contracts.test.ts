import { describe, expect, it } from "vitest";
import { runAccountStatusJob } from "../../src/jobs/account-status.job.js";
import { prisma } from "../../src/lib/prisma.js";
import { transitionActivity } from "../../src/modules/activities/engine.js";
import { completeCarpoolSession, runCarpoolPaymentsJob } from "../../src/modules/carpool/carpool.contract.js";
import { runCarpoolContractEndJob } from "../../src/modules/carpool/carpool.jobs.js";
import { addDays } from "../../src/modules/carpool/carpool-dates.js";
import { userStats } from "../../src/modules/users/stats.service.js";
import { dateOnlyString, dhakaWallTime } from "../../src/utils/time.js";
import { HOUR, MINUTE, outcomeCode, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { activeRider } from "./ride-helpers.js";
import { contracted, createPost, getBooking, getPost, inDays, postBody, requested, requestSeat, riderWithPost } from "./carpool-helpers.js";
import { channelsOf, settle } from "./notification-helpers.js";

const DAY = 24 * HOUR;

async function contractOf(activityId: string) {
  return prisma.carpoolContract.findFirstOrThrow({ where: { booking: { activityId } } });
}

async function sessionsOf(contractId: string) {
  return prisma.activity.findMany({
    where: { carpoolSession: { contractId } },
    orderBy: { startTime: "asc" },
    select: { id: true, status: true, startTime: true, cancelledById: true, closureReason: true, isLateCancellation: true },
  });
}

const termination = (token: string, id: string, reason = "Moving to another campus") =>
  api().post(`/api/carpool/bookings/${id}/termination`).set(bearer(token)).send({ reason });
const answer = (token: string, id: string, choice: "agree" | "decline") => api().post(`/api/carpool/bookings/${id}/termination/${choice}`).set(bearer(token));

describe("carpool sessions (B6b #1)", () => {
  it("either side marks a session Completed in one step, from 30 minutes before departure", async () => {
    const { rider, passenger, id } = await contracted();
    const [first, second] = await sessionsOf((await contractOf(id)).id);

    expect(await outcomeCode(completeCarpoolSession(passenger.id, first!.id, new Date(first!.startTime.getTime() - 2 * HOUR)))).toBe("SESSION_TOO_EARLY");
    const done = await completeCarpoolSession(passenger.id, first!.id, new Date(first!.startTime.getTime() - 20 * MINUTE));
    expect(done.activity.status).toBe("COMPLETED");
    // Only once; and never by an outsider
    expect(await outcomeCode(completeCarpoolSession(rider.id, first!.id, first!.startTime))).toBe("INVALID_TRANSITION");
    const outsider = await verifiedUser();
    expect(await outcomeCode(completeCarpoolSession(outsider.id, second!.id, second!.startTime))).toBe("NOT_PARTICIPANT");

    // Over HTTP the window is checked against the real clock
    const early = await api().post(`/api/carpool/sessions/${second!.id}/complete`).set(bearer(rider.accessToken));
    expect(early.body.error.code).toBe("SESSION_TOO_EARLY");
  });

  it("cancels a session with a reason; records who, the late flag, and tells the other person", async () => {
    const { rider, passenger, id } = await contracted();
    const contract = await contractOf(id);
    const [first, second] = await sessionsOf(contract.id);

    const noReason = await api().post(`/api/activities/${first!.id}/cancel`).set(bearer(rider.accessToken)).send({});
    expect(noReason.status).toBe(400);
    await transitionActivity(first!.id, "CANCEL", { type: "USER", id: rider.id }, { reason: "Car in the workshop", now: new Date(first!.startTime.getTime() - 30 * MINUTE) });
    await transitionActivity(second!.id, "CANCEL", { type: "USER", id: passenger.id }, { reason: "Exam day", now: new Date(second!.startTime.getTime() - DAY) });
    await settle();

    const [a, b] = await sessionsOf(contract.id);
    expect(a).toMatchObject({ status: "CANCELLED", cancelledById: rider.id, isLateCancellation: true });
    expect(b).toMatchObject({ status: "CANCELLED", cancelledById: passenger.id, isLateCancellation: false });
    expect(await channelsOf(passenger.id, "ACTIVITY_CANCELLED")).toContain("IN_APP");

    // Monthly history, from each side
    const mine = (await getBooking(passenger.accessToken, id)).body.booking;
    expect(mine.history[0]).toMatchObject({ monthNumber: 1, cancelledByMe: 1, cancelledByOther: 1, completed: 0 });
    // The rider's cancellation is on the post for passengers to see (9.6)
    const post = await prisma.carpoolBooking.findUniqueOrThrow({ where: { activityId: id }, select: { postId: true } });
    expect((await getPost(passenger.accessToken, post.postId)).body.post.riderSessionCancellations).toBe(1);
  });
});

describe("monthly payment records (9.5)", () => {
  it("creates each month's record UNPAID when the month begins, once, and tells the passenger", async () => {
    const { rider, passenger, id } = await contracted({}, { durationMonths: 2 });
    const contract = await contractOf(id);
    const start = dateOnlyString(contract.startDate);

    expect(await runCarpoolPaymentsJob(dhakaWallTime(addDays(start, -1), 12, 0))).toBe(0);
    expect(await runCarpoolPaymentsJob(dhakaWallTime(start, 0, 5))).toBe(1);
    expect(await runCarpoolPaymentsJob(dhakaWallTime(start, 6, 0))).toBe(0);
    await settle();
    expect(await channelsOf(passenger.id, "CARPOOL_PAYMENT_DUE")).toEqual(["IN_APP"]);

    const payments = await prisma.carpoolMonthlyPayment.findMany({ where: { contractId: contract.id }, orderBy: { monthNumber: "asc" } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ monthNumber: 1, status: "UNPAID", method: null });
    expect(Number(payments[0]!.amount)).toBe(1900);

    // Month 2 at its start
    const month2 = dateOnlyString(payments[0]!.periodEnd);
    expect(await runCarpoolPaymentsJob(dhakaWallTime(addDays(month2, 1), 1, 0))).toBe(1);

    // Method by either side; PAID only by the rider, after a method
    const paymentId = payments[0]!.id;
    const paidTooSoon = await api().post(`/api/carpool/payments/${paymentId}/paid`).set(bearer(rider.accessToken));
    expect(paidTooSoon.body.error.code).toBe("PAYMENT_METHOD_REQUIRED");
    const method = await api().patch(`/api/carpool/payments/${paymentId}`).set(bearer(passenger.accessToken)).send({ method: "BKASH" });
    expect(method.status).toBe(200);
    expect(method.body.payment.method).toBe("BKASH");
    const byPassenger = await api().post(`/api/carpool/payments/${paymentId}/paid`).set(bearer(passenger.accessToken));
    expect(byPassenger.body.error.code).toBe("NOT_PAYEE");
    const paid = await api().post(`/api/carpool/payments/${paymentId}/paid`).set(bearer(rider.accessToken));
    expect(paid.body.payment).toMatchObject({ status: "PAID", method: "BKASH" });
    // PAID is final for users
    const change = await api().patch(`/api/carpool/payments/${paymentId}`).set(bearer(passenger.accessToken)).send({ method: "CASH" });
    expect(change.body.error.code).toBe("PAYMENT_ALREADY_PAID");
    const outsider = await verifiedUser();
    expect((await api().patch(`/api/carpool/payments/${paymentId}`).set(bearer(outsider.accessToken)).send({ method: "CASH" })).status).toBe(404);

    // The booking page lists the months; the rider's dashboard counts the earnings
    const view = (await getBooking(passenger.accessToken, id)).body.booking;
    expect(view.payments.map((p: { monthNumber: number; status: string }) => [p.monthNumber, p.status])).toEqual([
      [1, "PAID"],
      [2, "UNPAID"],
    ]);
    const dashboard = await api().get("/api/rider/dashboard").set(bearer(rider.accessToken));
    expect(dashboard.body).toMatchObject({ activeCarpoolContracts: 1, carpoolEarnings: 1900 });
  });
});

describe("early termination (9.6)", () => {
  it("one side asks, the other declines or agrees; agreeing ends it and closes the future sessions for nobody's account", async () => {
    const { rider, passenger, post, id } = await contracted();
    const contract = await contractOf(id);

    const asked = await termination(passenger.accessToken, id);
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    expect(asked.body.booking.contract.termination).toMatchObject({ requestedBy: "ME", reason: "Moving to another campus" });
    expect((await termination(rider.accessToken, id)).body.error.code).toBe("TERMINATION_ALREADY_REQUESTED");
    expect((await answer(passenger.accessToken, id, "agree")).body.error.code).toBe("OWN_TERMINATION_REQUEST");
    await settle();
    expect(await channelsOf(rider.id, "CARPOOL_TERMINATION_REQUESTED")).toEqual(["IN_APP", "PUSH"]);

    const declined = await answer(rider.accessToken, id, "decline");
    expect(declined.body.booking.contract.termination).toBeNull();
    expect(declined.body.booking.contract.status).toBe("ACTIVE");
    await settle();
    expect(await channelsOf(passenger.id, "CARPOOL_TERMINATION_ANSWERED")).toEqual(["IN_APP", "PUSH"]);

    // Asked again, taken back, asked again by the rider, agreed by the passenger
    expect((await termination(passenger.accessToken, id)).status).toBe(200);
    expect((await api().post(`/api/carpool/bookings/${id}/termination/withdraw`).set(bearer(rider.accessToken))).body.error.code).toBe("NO_TERMINATION_REQUEST");
    expect((await api().post(`/api/carpool/bookings/${id}/termination/withdraw`).set(bearer(passenger.accessToken))).status).toBe(200);
    expect((await termination(rider.accessToken, id, "Graduating this month")).status).toBe(200);
    const agreed = await answer(passenger.accessToken, id, "agree");
    expect(agreed.status, JSON.stringify(agreed.body)).toBe(200);
    expect(agreed.body.booking.status).toBe("CANCELLED");
    expect(agreed.body.booking.contract.status).toBe("TERMINATED");

    const sessions = await sessionsOf(contract.id);
    expect(sessions.every((s) => s.status === "CANCELLED" && s.cancelledById === null && s.closureReason === "CONTRACT_TERMINATED")).toBe(true);
    // Counts against nobody, and only that seat reopens
    expect((await userStats(rider.id)).cancellations).toBe(0);
    expect((await getPost(rider.accessToken, post.id)).body.post).toMatchObject({ status: "OPEN", seatsAvailable: 2 });
    const dashboard = await api().get("/api/rider/dashboard").set(bearer(rider.accessToken));
    expect(dashboard.body).toMatchObject({ activeCarpoolContracts: 0, carpoolSessionCancellations: 0 });
    // Terminated early: no reviews (B6b #5)
    const review = await api().post(`/api/activities/${id}/review`).set(bearer(passenger.accessToken)).send({ rating: 5 });
    expect(review.body.error.code).toBe("REVIEW_NOT_ALLOWED");
  });
});

describe("contract end: reviews and Renew (9.3 step 8)", () => {
  it("opens reviews and lets the passenger renew once, within 7 days, as a normal request", async () => {
    const { rider, passenger, post, id } = await contracted();
    const contract = await contractOf(id);
    expect(await runCarpoolContractEndJob(contract.id, new Date(contract.endDate.getTime() + 2 * DAY))).toBe(true);

    const review = await api().post(`/api/activities/${id}/review`).set(bearer(passenger.accessToken)).send({ rating: 5, comment: "Always on time" });
    expect(review.status, JSON.stringify(review.body)).toBe(201);

    const view = (await getBooking(passenger.accessToken, id)).body.booking;
    expect(view.renewal).toMatchObject({ available: true, postId: post.id });
    expect((await getBooking(rider.accessToken, id)).body.booking.renewal).toBeNull();
    expect((await api().post(`/api/carpool/bookings/${id}/renew`).set(bearer(rider.accessToken)).send({ durationMonths: 1 })).status).toBe(404);

    const renewed = await api().post(`/api/carpool/bookings/${id}/renew`).set(bearer(passenger.accessToken)).send({ durationMonths: 2 });
    expect(renewed.status, JSON.stringify(renewed.body)).toBe(201);
    expect(renewed.body.booking).toMatchObject({ status: "OPEN", durationMonths: 2, isRenewal: true, startDate: view.renewal.startDate });
    expect((await api().post(`/api/carpool/bookings/${id}/renew`).set(bearer(passenger.accessToken)).send({ durationMonths: 1 })).body.error.code).toBe("ALREADY_BOOKED");
    await settle();
    expect(await channelsOf(rider.id, "CARPOOL_BOOKING_REQUESTED")).toContain("IN_APP");

    // After the 7 days, no more Renew
    await api().post(`/api/carpool/bookings/${renewed.body.booking.activityId}/withdraw`).set(bearer(passenger.accessToken));
    await prisma.carpoolContract.update({ where: { id: contract.id }, data: { endedAt: new Date(Date.now() - 8 * DAY) } });
    expect((await api().post(`/api/carpool/bookings/${id}/renew`).set(bearer(passenger.accessToken)).send({ durationMonths: 1 })).body.error.code).toBe("RENEW_NOT_AVAILABLE");
  });
});

describe("carpool access suspension (9.6, B6b #2 #3)", () => {
  it("Super Admin only, with an end date; pauses posts, refuses new carpool work, keeps contracts, and ends by itself", async () => {
    const { rider, post, id } = await contracted();
    const admin = await registerUser({ role: "SUPER_ADMIN" });
    const moderator = await registerUser({ role: "MODERATOR" });
    const endsAt = new Date(Date.now() + 3 * DAY).toISOString();

    expect((await api().post(`/api/admin/carpool/riders/${rider.id}/suspend`).set(bearer(moderator.accessToken)).send({ reason: "Too many cancellations", endsAt })).status).toBe(403);
    const noDate = await api().post(`/api/admin/carpool/riders/${rider.id}/suspend`).set(bearer(admin.accessToken)).send({ reason: "Too many cancellations" });
    expect(noDate.status).toBe(400);
    const suspended = await api().post(`/api/admin/carpool/riders/${rider.id}/suspend`).set(bearer(admin.accessToken)).send({ reason: "Too many cancellations", endsAt });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(suspended.body.carpoolSuspendedUntil).not.toBeNull();
    await settle();
    expect(await channelsOf(rider.id, "CARPOOL_ACCESS_CHANGED")).toEqual(["EMAIL", "IN_APP"]);

    // The post is paused, not closed; the contract carries on
    expect((await getPost(rider.accessToken, post.id)).body.post).toMatchObject({ status: "OPEN", paused: true });
    expect((await contractOf(id)).status).toBe("ACTIVE");
    expect((await api().post(`/api/carpool/posts/${post.id}/resume`).set(bearer(rider.accessToken))).body.error.code).toBe("CARPOOL_SUSPENDED");
    const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { ownerId: rider.id } });
    const another = await createPost(rider.accessToken, postBody(vehicle.id, { departureMinute: 18 * 60 }));
    expect(another.body.error.code).toBe("CARPOOL_SUSPENDED");
    const passenger = await verifiedUser();
    expect((await requestSeat(passenger.accessToken, post.id)).body.error.code).toBe("POST_PAUSED");
    const audit = await prisma.auditLog.findFirst({ where: { action: "CARPOOL_SUSPEND", targetUserId: rider.id } });
    expect(audit).not.toBeNull();

    // The account-status job ends it at its date and tells the rider
    const result = await runAccountStatusJob(new Date(Date.now() + 4 * DAY));
    expect(result.carpoolSuspensionsEnded).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rider.id } })).carpoolSuspendedUntil).toBeNull();
    expect((await api().post(`/api/carpool/posts/${post.id}/resume`).set(bearer(rider.accessToken))).status).toBe(200);
  });

  it("can be lifted early by a Super Admin", async () => {
    const rider = await activeRider();
    const admin = await registerUser({ role: "SUPER_ADMIN" });
    const endsAt = new Date(Date.now() + 3 * DAY).toISOString();
    await api().post(`/api/admin/carpool/riders/${rider.id}/suspend`).set(bearer(admin.accessToken)).send({ reason: "Warning period", endsAt });
    const lifted = await api().post(`/api/admin/carpool/riders/${rider.id}/reinstate`).set(bearer(admin.accessToken)).send({ reason: "Resolved" });
    expect(lifted.status).toBe(200);
    expect(lifted.body.carpoolSuspendedUntil).toBeNull();
    expect((await api().post(`/api/admin/carpool/riders/${rider.id}/reinstate`).set(bearer(admin.accessToken)).send({ reason: "Again" })).body.error.code).toBe(
      "INVALID_STATUS_CHANGE",
    );
    expect((await createPost(rider.accessToken, postBody(rider.vehicle.id))).status).toBe(201);
  });
});

describe("admin Carpool module (17)", () => {
  it("lists posts, booking requests and contracts; shows a booking with sessions and payments; closes a post", async () => {
    const { rider, post, id } = await contracted();
    const pending = await requested(post.id);
    const moderator = await registerUser({ role: "MODERATOR" });
    const normal = await verifiedUser();
    expect((await api().get("/api/admin/carpool").set(bearer(normal.accessToken))).status).toBe(403);

    const posts = await api().get("/api/admin/carpool").query({ kind: "posts" }).set(bearer(moderator.accessToken));
    expect(posts.body.items.map((item: { id: string }) => item.id)).toContain(post.id);
    const contracts = await api().get("/api/admin/carpool").query({ kind: "contracts", status: "ACTIVE" }).set(bearer(moderator.accessToken));
    expect(contracts.body.items[0]).toMatchObject({ activityId: id, status: "ACTIVE", rider: { id: rider.id } });
    const bookings = await api().get("/api/admin/carpool").query({ kind: "bookings", status: "OPEN" }).set(bearer(moderator.accessToken));
    expect(bookings.body.items.map((item: { id: string }) => item.id)).toEqual([pending.id]);

    const detail = await api().get(`/api/admin/carpool/bookings/${id}`).set(bearer(moderator.accessToken));
    expect(detail.body.booking.contract.sessions.length).toBeGreaterThan(0);
    expect(detail.body.booking.rider.email).toBeTruthy();

    const closed = await api().post(`/api/admin/carpool/posts/${post.id}/close`).set(bearer(moderator.accessToken)).send({ reason: "Fake schedule" });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.post).toMatchObject({ status: "CLOSED", closeReason: "ADMIN_REMOVED" });
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("CANCELLED");
    // The running contract carries on
    expect((await contractOf(id)).status).toBe("ACTIVE");
    expect(await prisma.auditLog.count({ where: { action: "CARPOOL_POST_CLOSED_BY_ADMIN", targetId: post.id } })).toBe(1);
  });
});

describe("account locked during a contract (B6b #6)", () => {
  it("keeps the contract and tells the other person once, not once per session", async () => {
    const { rider, passenger, id } = await contracted();
    const admin = await registerUser({ role: "SUPER_ADMIN" });
    const restricted = await api().post(`/api/admin/users/${passenger.id}/restrict`).set(bearer(admin.accessToken)).send({ reason: "Spam reports" });
    expect(restricted.status, JSON.stringify(restricted.body)).toBe(200);
    await settle();
    const rows = await prisma.notification.findMany({ where: { userId: rider.id, type: "PARTICIPANT_ACCOUNT_LOCKED", channel: "IN_APP" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.activityId).toBe(id);
    expect((await contractOf(id)).status).toBe("ACTIVE");
  });
});

describe("unchanged rules", () => {
  it("still refuses a block between people with a running contract (B2b #8)", async () => {
    const { rider, passenger } = await contracted();
    const blocked = await api().post("/api/me/blocks").set(bearer(passenger.accessToken)).send({ userId: rider.id });
    expect(blocked.body.error.code).toBe("BLOCK_CARPOOL_CONTRACT");
  });

  it("a rider's own post cannot be renewed or booked", async () => {
    const { rider, post } = await riderWithPost();
    expect((await requestSeat(rider.accessToken, post.id, { startDate: inDays(3) })).body.error.code).toBe("OWN_ITEM");
  });
});
