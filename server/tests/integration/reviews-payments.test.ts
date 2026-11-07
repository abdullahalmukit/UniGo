import { describe, expect, it } from "vitest";
import { runActivitySweep } from "../../src/jobs/activity-timers.job.js";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { processJob } from "../../src/jobs/worker.js";
import { prisma } from "../../src/lib/prisma.js";
import { computeStats } from "../../src/modules/users/stats.service.js";
import { createActivity, fromNow, HOUR, MINUTE, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { channelsOf, settle } from "./notification-helpers.js";
import { activeRider, book, offerBody, postOffer, postRequest, requestBody, subArea } from "./ride-helpers.js";

const DAY = 24 * HOUR;

// An accepted request, completed through the engine (two-step completion).
async function completedRide() {
  const area = await subArea();
  const passenger = await verifiedUser();
  const rider = await activeRider();
  const request = (await postRequest(passenger.accessToken, requestBody(area.id))).body.request;
  await api().post(`/api/rides/requests/${request.id}/accept`).set(bearer(rider.accessToken)).send({ vehicleId: rider.vehicle.id });
  await prisma.activity.update({ where: { id: request.id }, data: { startTime: fromNow(10 * MINUTE) } });
  await api().post(`/api/activities/${request.id}/start`).set(bearer(rider.accessToken));
  await api().post(`/api/activities/${request.id}/request-completion`).set(bearer(rider.accessToken));
  const done = await api().post(`/api/activities/${request.id}/confirm-completion`).set(bearer(passenger.accessToken));
  expect(done.body.activity.status).toBe("COMPLETED");
  return { passenger, rider, id: request.id as string };
}

const review = (token: string, id: string, rating = 5, comment?: string) =>
  api().post(`/api/activities/${id}/review`).set(bearer(token)).send({ rating, ...(comment !== undefined && { comment }) });
const reviewsOf = (token: string, id: string) => api().get(`/api/activities/${id}/reviews`).set(bearer(token));

describe("blind reviews (proposal 15.1)", () => {
  it("hides a review from both until both have reviewed, then publishes both and tells each reviewee in-app", async () => {
    const { passenger, rider, id } = await completedRide();

    const first = await review(passenger.accessToken, id, 4, "Safe and on time");
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ canReview: false, mine: { rating: 4, publishedAt: null }, theirs: null, otherSubmitted: false });
    // The rider cannot see it yet
    const riderView = (await reviewsOf(rider.accessToken, id)).body;
    expect(riderView).toMatchObject({ canReview: true, mine: null, theirs: null, otherSubmitted: true });
    expect(JSON.stringify(riderView)).not.toContain("Safe and on time");
    expect((await api().get(`/api/users/${rider.id}/reviews`).set(bearer(passenger.accessToken))).body.reviews).toEqual([]);

    await review(rider.accessToken, id, 5);
    const after = (await reviewsOf(rider.accessToken, id)).body;
    expect(after.theirs).toMatchObject({ rating: 4, comment: "Safe and on time", reviewer: { id: passenger.id } });
    expect(after.mine.publishedAt).not.toBeNull();
    await settle();
    expect(await channelsOf(rider.id, "REVIEW_PUBLISHED")).toEqual(["IN_APP"]);
    expect(await channelsOf(passenger.id, "REVIEW_PUBLISHED")).toEqual(["IN_APP"]);
    const list = await api().get("/api/notifications").set(bearer(rider.accessToken));
    expect(list.body.notifications[0]).toMatchObject({ title: "You have a new review", link: `/u/${rider.id}` });
  });

  it("publishes a lone review when the 7 days end, by the job and the sweeper, only once", async () => {
    const { passenger, rider, id } = await completedRide();
    const completedAt = (await prisma.activity.findUniqueOrThrow({ where: { id } })).completedAt!;
    const due = new Date(completedAt.getTime() + 7 * DAY);
    expect(scheduledJobs.get(`review-publish-${id}-${due.getTime()}`)).toBeDefined();
    await review(passenger.accessToken, id, 3);

    // Before the 7 days the job publishes nothing
    expect(await processJob({ name: "review-publish", data: { id } } as never)).toBe(0);
    await prisma.activity.update({ where: { id }, data: { completedAt: new Date(Date.now() - 7 * DAY - MINUTE) } });
    expect(await processJob({ name: "review-publish", data: { id } } as never)).toBe(1);
    expect(await processJob({ name: "review-publish", data: { id } } as never)).toBe(0);
    expect((await runActivitySweep()).reviewsPublished).toBe(0);
    expect((await reviewsOf(rider.accessToken, id)).body.theirs).toMatchObject({ rating: 3 });
    // The window is closed for the rider now
    expect((await review(rider.accessToken, id)).body.error.code).toBe("REVIEW_WINDOW_CLOSED");
  });

  it("has the sweeper publish reviews whose job was lost", async () => {
    const { passenger, id } = await completedRide();
    await review(passenger.accessToken, id, 4);
    await prisma.activity.update({ where: { id }, data: { completedAt: new Date(Date.now() - 8 * DAY) } });
    expect((await runActivitySweep()).reviewsPublished).toBe(1);
  });

  it("allows one review per user and refuses CANCELLED, EXPIRED and NOT_MARKED activities and outsiders", async () => {
    const { passenger, id } = await completedRide();
    expect((await review(passenger.accessToken, id)).status).toBe(201);
    expect((await review(passenger.accessToken, id, 1)).body.error.code).toBe("ALREADY_REVIEWED");
    expect((await review((await verifiedUser()).accessToken, id)).status).toBe(404);
    expect((await review(passenger.accessToken, id, 6)).status).toBe(400);

    const [a, b] = await Promise.all([verifiedUser(), verifiedUser()]);
    for (const status of ["CANCELLED", "EXPIRED", "NOT_MARKED"] as const) {
      const other = await createActivity({ creatorId: a.id, accepterId: b.id, status });
      expect((await review(a.accessToken, other.id)).body.error.code).toBe("REVIEW_NOT_ALLOWED");
    }
  });

  it("lets the rider review each passenger of an offer, one review per booking", async () => {
    const rider = await activeRider();
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id))).body.offer;
    const [p1, p2] = await Promise.all([verifiedUser(), verifiedUser()]);
    const bookings = [(await book(p1.accessToken, offer.id)).body.booking, (await book(p2.accessToken, offer.id)).body.booking];
    await prisma.activity.updateMany({ where: { id: { in: bookings.map((b) => b.activityId) } }, data: { status: "COMPLETED", completedAt: new Date() } });

    for (const booking of bookings) expect((await review(rider.accessToken, booking.activityId, 5)).status).toBe(201);
    expect((await review(rider.accessToken, bookings[0].activityId, 4)).body.error.code).toBe("ALREADY_REVIEWED");
    const rows = await prisma.review.findMany({ where: { reviewerId: rider.id } });
    expect(rows.map((r) => r.revieweeId).sort()).toEqual([p1.id, p2.id].sort());
  });

  it("lets admins hide a review with a reason, audited, and drops it from user views", async () => {
    const { passenger, rider, id } = await completedRide();
    await review(passenger.accessToken, id, 1, "Rude words");
    await review(rider.accessToken, id, 5);
    const stored = await prisma.review.findFirstOrThrow({ where: { reviewerId: passenger.id } });
    const moderator = await registerUser({ role: "MODERATOR", studentVerificationStatus: "VERIFIED" });

    expect((await api().post(`/api/admin/reviews/${stored.id}/hide`).set(bearer(rider.accessToken)).send({ reason: "Abusive" })).status).toBe(403);
    expect((await api().post(`/api/admin/reviews/${stored.id}/hide`).set(bearer(moderator.accessToken)).send({})).status).toBe(400);
    expect((await api().post(`/api/admin/reviews/${stored.id}/hide`).set(bearer(moderator.accessToken)).send({ reason: "Abusive language" })).status).toBe(204);
    expect((await reviewsOf(rider.accessToken, id)).body.theirs).toBeNull();
    expect((await api().get(`/api/users/${rider.id}/reviews`).set(bearer(passenger.accessToken))).body.reviews).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: "REVIEW_HIDDEN", targetId: stored.id } })).toBe(1);
  });
});

describe("profile stats and badges (proposal 15.2)", () => {
  const flags = { verifiedStudent: true, verifiedRider: false };

  it("shows New below the minimum counts and computes the rates at the boundaries", () => {
    expect(computeStats({ completed: 4, cancelled: 0, late: 0 }, { avg: 5, count: 2 }, flags)).toMatchObject({ rating: null, completionRate: null, lateCancellationRate: null, accepted: 4 });
    expect(computeStats({ completed: 4, cancelled: 1, late: 1 }, { avg: 4.333, count: 3 }, flags)).toMatchObject({ rating: 4.33, completionRate: 0.8, lateCancellationRate: 0.2, lateCancellationWarning: true });
  });

  it("gives Top Rated from 4.5 with 5 reviews, and Reliable from 10 accepted, 90% completed and under 10% late", () => {
    expect(computeStats({ completed: 0, cancelled: 0, late: 0 }, { avg: 4.5, count: 5 }, flags).badges).toContain("TOP_RATED");
    expect(computeStats({ completed: 0, cancelled: 0, late: 0 }, { avg: 4.49, count: 5 }, flags).badges).not.toContain("TOP_RATED");
    expect(computeStats({ completed: 0, cancelled: 0, late: 0 }, { avg: 5, count: 4 }, flags).badges).not.toContain("TOP_RATED");

    expect(computeStats({ completed: 9, cancelled: 1, late: 0 }, undefined, flags).badges).toContain("RELIABLE");
    expect(computeStats({ completed: 9, cancelled: 0, late: 0 }, undefined, flags).badges).not.toContain("RELIABLE");
    expect(computeStats({ completed: 18, cancelled: 3, late: 0 }, undefined, flags).badges).not.toContain("RELIABLE");
    // 1 late of 10 is 10%: not under 10%
    expect(computeStats({ completed: 9, cancelled: 1, late: 1 }, undefined, flags).badges).not.toContain("RELIABLE");
    expect(computeStats({ completed: 0, cancelled: 0, late: 0 }, undefined, { verifiedStudent: true, verifiedRider: true }).badges).toEqual(["VERIFIED_STUDENT", "VERIFIED_RIDER"]);
  });

  it("counts only completed and own cancellations, never NOT_MARKED, running rides or others' cancellations", async () => {
    const [me, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const base = { creatorId: me.id, accepterId: other.id };
    const make = async (data: Parameters<typeof createActivity>[0], extra: Record<string, unknown> = {}) => {
      const row = await createActivity(data);
      await prisma.activity.update({ where: { id: row.id }, data: { acceptedAt: new Date(), ...extra } });
    };
    for (let i = 0; i < 4; i += 1) await make({ ...base, status: "COMPLETED" });
    await make({ ...base, status: "CANCELLED" }, { cancelledById: me.id, isLateCancellation: true });
    await make({ ...base, status: "CANCELLED" }, { cancelledById: other.id, isLateCancellation: true });
    await make({ ...base, status: "NOT_MARKED" });
    await make({ ...base, status: "ACCEPTED" });

    const profile = (await api().get(`/api/users/${me.id}/profile`).set(bearer(other.accessToken))).body.profile;
    expect(profile.stats).toMatchObject({ completed: 4, cancellations: 1, completionRate: 0.8, lateCancellationRate: 0.2, rating: null, reviewCount: 0 });
  });

  it("puts the stats and badges on ride cards", async () => {
    const rider = await activeRider();
    await postOffer(rider.accessToken, offerBody(rider.vehicle.id));
    const list = await api().get("/api/rides").set(bearer((await verifiedUser()).accessToken));
    expect(list.body.items[0].rider).toMatchObject({ rating: null, ratingCount: 0, completionRate: null, badges: ["VERIFIED_STUDENT", "VERIFIED_RIDER"] });
  });
});

describe("payment records (proposal 16)", () => {
  it("is created on acceptance with the request's amount, the rider receiving it", async () => {
    const area = await subArea();
    const passenger = await verifiedUser();
    const rider = await activeRider();
    const request = (await postRequest(passenger.accessToken, requestBody(area.id, { offeredAmount: 175 }))).body.request;
    await api().post(`/api/rides/requests/${request.id}/accept`).set(bearer(rider.accessToken)).send({ vehicleId: rider.vehicle.id });

    const forPassenger = (await api().get(`/api/activities/${request.id}/payment`).set(bearer(passenger.accessToken))).body.payment;
    expect(forPassenger).toMatchObject({ amount: 175, method: null, status: "UNPAID", payee: "OTHER", canMarkPaid: false });
    expect((await api().get(`/api/activities/${request.id}/payment`).set(bearer(rider.accessToken))).body.payment.payee).toBe("ME");
  });

  it("uses the booking amount for offers and lets only the receiver mark it paid, after a method is chosen", async () => {
    const rider = await activeRider();
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id))).body.offer;
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id, 2)).body.booking;
    const path = `/api/activities/${booking.activityId}/payment`;

    expect((await api().get(path).set(bearer(rider.accessToken))).body.payment).toMatchObject({ amount: 160, payee: "ME", canMarkPaid: false });
    expect((await api().post(`${path}/paid`).set(bearer(rider.accessToken))).body.error.code).toBe("PAYMENT_METHOD_REQUIRED");
    expect((await api().patch(path).set(bearer(passenger.accessToken)).send({ method: "PAYPAL" })).status).toBe(400);
    expect((await api().patch(path).set(bearer(passenger.accessToken)).send({ method: "BKASH" })).body.payment.method).toBe("BKASH");
    expect((await api().post(`${path}/paid`).set(bearer(passenger.accessToken))).body.error.code).toBe("NOT_PAYEE");
    expect((await api().get(path).set(bearer((await verifiedUser()).accessToken))).status).toBe(403);

    const paid = await api().post(`${path}/paid`).set(bearer(rider.accessToken));
    expect(paid.body.payment).toMatchObject({ status: "PAID", method: "BKASH" });
    expect((await api().post(`${path}/paid`).set(bearer(rider.accessToken))).body.error.code).toBe("PAYMENT_ALREADY_PAID");
    expect((await api().patch(path).set(bearer(passenger.accessToken)).send({ method: "CASH" })).body.error.code).toBe("PAYMENT_ALREADY_PAID");

    // Rider Dashboard: earnings are the PAID payments received
    const dashboard = await api().get("/api/rider/dashboard").set(bearer(rider.accessToken));
    expect(dashboard.body).toMatchObject({ totalRides: 1, accepted: 1, completed: 0, cancelled: 0, earnings: 160, activeCarpoolContracts: 0 });
  });

  it("cannot be marked paid for a cancelled ride", async () => {
    const rider = await activeRider();
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id))).body.offer;
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id)).body.booking;
    await api().patch(`/api/activities/${booking.activityId}/payment`).set(bearer(rider.accessToken)).send({ method: "CASH" });
    await api().post(`/api/activities/${booking.activityId}/cancel`).set(bearer(passenger.accessToken)).send({ reason: "Plans changed" });
    expect((await api().post(`/api/activities/${booking.activityId}/payment/paid`).set(bearer(rider.accessToken))).body.error.code).toBe("PAYMENT_NOT_DUE");
  });
});

describe("admin Ride Sharing (proposal 17)", () => {
  it("lists, shows and cancels rides for Moderators and Super Admins, audited, both notified", async () => {
    const area = await subArea();
    const passenger = await verifiedUser();
    const rider = await activeRider();
    const request = (await postRequest(passenger.accessToken, requestBody(area.id))).body.request;
    await api().post(`/api/rides/requests/${request.id}/accept`).set(bearer(rider.accessToken)).send({ vehicleId: rider.vehicle.id });
    const moderator = await registerUser({ role: "MODERATOR", studentVerificationStatus: "VERIFIED" });

    expect((await api().get("/api/admin/rides").set(bearer(passenger.accessToken))).status).toBe(403);
    const list = await api().get("/api/admin/rides").query({ kind: "requests", status: "ACCEPTED" }).set(bearer(moderator.accessToken));
    expect(list.body).toMatchObject({ total: 1, items: [{ id: request.id, status: "ACCEPTED", creator: { id: passenger.id }, accepter: { id: rider.id } }] });
    expect((await api().get("/api/admin/rides").query({ kind: "requests", q: "nobody-matches" }).set(bearer(moderator.accessToken))).body.total).toBe(0);

    const detail = (await api().get(`/api/admin/rides/activities/${request.id}`).set(bearer(moderator.accessToken))).body.ride;
    expect(detail.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(["OPEN", "ACCEPTED"]);
    expect(detail.payment).toMatchObject({ status: "UNPAID" });
    // Admins see the full vehicle number
    expect(detail.rideRequest.vehicle.registrationNumber).toBe(rider.vehicle.registrationNumber);

    expect((await api().post(`/api/admin/rides/activities/${request.id}/cancel`).set(bearer(moderator.accessToken)).send({})).status).toBe(400);
    const cancelled = await api().post(`/api/admin/rides/activities/${request.id}/cancel`).set(bearer(moderator.accessToken)).send({ reason: "Reported as unsafe" });
    expect(cancelled.body.ride.status).toBe("CANCELLED");
    await settle();
    expect(await channelsOf(passenger.id, "ACTIVITY_CANCELLED")).toContain("IN_APP");
    expect(await channelsOf(rider.id, "ACTIVITY_CANCELLED")).toContain("IN_APP");
    expect(await prisma.auditLog.count({ where: { action: "RIDE_CANCELLED_BY_ADMIN", targetId: request.id } })).toBe(1);
  });

  it("cancels an offer and its unfinished bookings", async () => {
    const rider = await activeRider();
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id))).body.offer;
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id)).body.booking;
    const admin = await registerUser({ role: "SUPER_ADMIN", studentVerificationStatus: "VERIFIED" });

    const result = await api().post(`/api/admin/rides/offers/${offer.id}/cancel`).set(bearer(admin.accessToken)).send({ reason: "Fake offer" });
    expect(result.body.offer).toMatchObject({ status: "CLOSED", closeReason: "ADMIN_REMOVED" });
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: booking.activityId } })).status).toBe("CANCELLED");
    expect((await api().get("/api/admin/rides").query({ kind: "offers", status: "CLOSED" }).set(bearer(admin.accessToken))).body.total).toBe(1);
  });
});
