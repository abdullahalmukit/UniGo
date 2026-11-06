import { describe, expect, it } from "vitest";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { prisma } from "../../src/lib/prisma.js";
import { onActivityTransition, type ActivityTransitionEvent } from "../../src/modules/activities/events.js";
import { transitionActivity } from "../../src/modules/activities/engine.js";
import { releaseRideOfferSeats, reserveRideOfferSeats } from "../../src/modules/activities/seats.js";
import { runActivityTransaction } from "../../src/modules/activities/transaction.js";
import { HOUR, MINUTE, createActivity, createRideOffer, fromNow, historyOf, outcomeCode, storedActivity, verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";

const post = (path: string, token: string, body: object = {}) => api().post(`/api/activities${path}`).set(bearer(token)).send(body);

describe("lifecycle endpoints", () => {
  it("runs a ride from start to two-step completion", async () => {
    const [passenger, rider] = await Promise.all([verifiedUser(), verifiedUser()]);
    const ride = await createActivity({ type: "RIDE_REQUEST", creatorId: passenger.id, accepterId: rider.id, status: "ACCEPTED", subStatus: "RIDE_CONFIRMED" });
    const events: ActivityTransitionEvent[] = [];
    const stop = onActivityTransition((event) => events.push(event));

    expect((await post(`/${ride.id}/start`, passenger.accessToken)).body.activity).toMatchObject({ status: "IN_PROGRESS", subStatus: "RIDE_CONFIRMED" });
    expect((await post(`/${ride.id}/request-completion`, passenger.accessToken)).body.activity.subStatus).toBe("COMPLETION_REQUESTED");
    expect([...scheduledJobs.values()].map((job) => job.name)).toEqual(["activity-auto-complete"]);

    // Nobody finalises completion alone
    const own = await post(`/${ride.id}/confirm-completion`, passenger.accessToken);
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe("ACTION_NOT_ALLOWED");

    const confirmed = await post(`/${ride.id}/confirm-completion`, rider.accessToken);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.activity.status).toBe("COMPLETED");
    expect(scheduledJobs.size).toBe(0);
    stop();

    const stored = await storedActivity(ride.id);
    expect(stored).toMatchObject({ completionRequestedById: passenger.id, closureReason: null, autoClosedAt: null });
    expect(stored.startedAt).toBeInstanceOf(Date);
    expect(stored.completedAt).toBeInstanceOf(Date);
    expect((await historyOf(ride.id)).map((row) => [row.toStatus, row.toSubStatus, row.actorId])).toEqual([
      ["IN_PROGRESS", "RIDE_CONFIRMED", passenger.id],
      ["IN_PROGRESS", "COMPLETION_REQUESTED", passenger.id],
      ["COMPLETED", "COMPLETION_REQUESTED", rider.id],
    ]);
    expect(events.map((event) => event.action)).toEqual(["START", "REQUEST_COMPLETION", "CONFIRM_COMPLETION"]);
  });

  it("refuses non-participants and the wrong side, per feature", async () => {
    const [creator, accepter, stranger] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    const service = await createActivity({ type: "SERVICE", creatorId: creator.id, accepterId: accepter.id, status: "ACCEPTED" });
    const food = await createActivity({ type: "FOOD", creatorId: creator.id, accepterId: accepter.id, status: "ACCEPTED", subStatus: "ORDER_CONFIRMED" });

    const outsider = await post(`/${service.id}/start`, stranger.accessToken);
    expect([outsider.status, outsider.body.error.code]).toEqual([403, "NOT_PARTICIPANT"]);
    const requester = await post(`/${service.id}/start`, creator.accessToken);
    expect([requester.status, requester.body.error.code]).toEqual([403, "ACTION_NOT_ALLOWED"]);
    const foodStart = await post(`/${food.id}/start`, accepter.accessToken);
    expect([foodStart.status, foodStart.body.error.code]).toEqual([409, "INVALID_TRANSITION"]);

    expect((await post(`/${service.id}/start`, accepter.accessToken)).status).toBe(200);
    const again = await post(`/${service.id}/start`, accepter.accessToken);
    expect([again.status, again.body.error.code]).toEqual([409, "INVALID_TRANSITION"]);
    const missing = await post(`/0190a000-0000-7000-8000-000000000000/start`, accepter.accessToken);
    expect([missing.status, missing.body.error.code]).toEqual([404, "ACTIVITY_NOT_FOUND"]);
  });

  it("records SERVICE_DELIVERED and COMPLETION_REQUESTED when the accepter delivers", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const service = await createActivity({ type: "SERVICE", creatorId: creator.id, accepterId: accepter.id, status: "IN_PROGRESS" });

    await transitionActivity(service.id, "DELIVER_SERVICE", { type: "USER", id: accepter.id });

    expect(await storedActivity(service.id)).toMatchObject({ status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED", completionRequestedById: accepter.id });
    expect((await historyOf(service.id)).map((row) => [row.fromSubStatus, row.toSubStatus])).toEqual([
      [null, "SERVICE_DELIVERED"],
      ["SERVICE_DELIVERED", "COMPLETION_REQUESTED"],
    ]);
  });

  it("cancels with a reason, records who cancelled and flags a late cancellation", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const soon = await createActivity({ creatorId: creator.id, accepterId: accepter.id, status: "ACCEPTED", startTime: fromNow(30 * MINUTE) });
    const later = await createActivity({ creatorId: creator.id, accepterId: accepter.id, status: "ACCEPTED", startTime: fromNow(3 * HOUR) });

    const noReason = await post(`/${soon.id}/cancel`, accepter.accessToken, {});
    expect([noReason.status, noReason.body.error.code]).toEqual([400, "VALIDATION_ERROR"]);

    expect((await post(`/${soon.id}/cancel`, accepter.accessToken, { reason: "Exam moved" })).status).toBe(200);
    expect((await post(`/${later.id}/cancel`, creator.accessToken, { reason: "Plans changed" })).status).toBe(200);

    expect(await storedActivity(soon.id)).toMatchObject({ status: "CANCELLED", cancelledById: accepter.id, cancellationReason: "Exam moved", isLateCancellation: true });
    expect(await storedActivity(later.id)).toMatchObject({ status: "CANCELLED", cancelledById: creator.id, isLateCancellation: false });
  });

  it("does not cancel while completion is requested", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const food = await createActivity({
      creatorId: creator.id,
      accepterId: accepter.id,
      status: "IN_PROGRESS",
      subStatus: "COMPLETION_REQUESTED",
      completionRequestedById: accepter.id,
      completionRequestedAt: new Date(),
    });
    const response = await post(`/${food.id}/cancel`, creator.accessToken, { reason: "Never arrived" });
    expect([response.status, response.body.error.code]).toEqual([409, "INVALID_TRANSITION"]);
  });

  it("soft-deletes an OPEN request for its creator only", async () => {
    const [creator, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const item = await createActivity({ creatorId: creator.id });

    expect((await api().delete(`/api/activities/${item.id}`).set(bearer(other.accessToken))).status).toBe(403);
    expect((await api().delete(`/api/activities/${item.id}`).set(bearer(creator.accessToken))).status).toBe(200);
    expect((await api().delete(`/api/activities/${item.id}`).set(bearer(creator.accessToken))).status).toBe(404);

    const stored = await storedActivity(item.id);
    expect(stored).toMatchObject({ status: "CANCELLED", closureReason: "DELETED_BY_CREATOR", isLateCancellation: false });
    expect(stored.deletedAt).toBeInstanceOf(Date);
  });

  it("gives a cancelled ride booking's seats back and reopens the full offer", async () => {
    const [rider, passenger] = await Promise.all([verifiedUser(), verifiedUser()]);
    const offer = await createRideOffer(rider.id, { seats: 2, seatsAvailable: 0, status: "FULL" });
    const booking = await createActivity({ type: "RIDE_BOOKING", creatorId: rider.id, accepterId: passenger.id, status: "ACCEPTED", subStatus: "RIDE_CONFIRMED", conflictGroupId: offer.id });
    await prisma.rideBooking.create({ data: { activityId: booking.id, rideOfferId: offer.id, seatsBooked: 2 } });

    expect((await post(`/${booking.id}/cancel`, passenger.accessToken, { reason: "Not going" })).status).toBe(200);

    expect(await prisma.rideOffer.findUniqueOrThrow({ where: { id: offer.id } })).toMatchObject({ status: "OPEN", seatsAvailable: 2 });
  });
});

describe("seat counting (B2a decision 7)", () => {
  it("lets only one of two bookings take the last seat", async () => {
    for (let round = 0; round < 5; round += 1) {
      const rider = await verifiedUser();
      const offer = await createRideOffer(rider.id, { seats: 3, seatsAvailable: 1 });

      const results = await Promise.all([
        outcomeCode(runActivityTransaction((tx) => reserveRideOfferSeats(tx, offer.id, 1))),
        outcomeCode(runActivityTransaction((tx) => reserveRideOfferSeats(tx, offer.id, 1))),
      ]);

      expect(results.sort()).toEqual(["ALREADY_TAKEN", "OK"]);
      expect(await prisma.rideOffer.findUniqueOrThrow({ where: { id: offer.id } })).toMatchObject({ seatsAvailable: 0, status: "FULL" });
    }
  });

  it("refuses more seats than are left, and a departed offer", async () => {
    const rider = await verifiedUser();
    const offer = await createRideOffer(rider.id, { seats: 3, seatsAvailable: 1 });
    const departed = await createRideOffer(rider.id, { departureTime: fromNow(-MINUTE) });

    expect(await outcomeCode(runActivityTransaction((tx) => reserveRideOfferSeats(tx, offer.id, 2)))).toBe("NOT_ENOUGH_SEATS");
    expect(await outcomeCode(runActivityTransaction((tx) => reserveRideOfferSeats(tx, departed.id, 1)))).toBe("ALREADY_TAKEN");
  });

  it("reopens a FULL offer only before departure, and never a CLOSED one", async () => {
    const rider = await verifiedUser();
    const future = await createRideOffer(rider.id, { seats: 2, seatsAvailable: 0, status: "FULL" });
    const departed = await createRideOffer(rider.id, { seats: 2, seatsAvailable: 0, status: "FULL", departureTime: fromNow(-MINUTE) });
    const closed = await createRideOffer(rider.id, { seats: 2, seatsAvailable: 0, status: "CLOSED" });

    await runActivityTransaction(async (tx) => {
      for (const offer of [future, departed, closed]) await releaseRideOfferSeats(tx, offer.id, 1);
    });
    // Never above the total
    await runActivityTransaction((tx) => releaseRideOfferSeats(tx, future.id, 5));

    const status = async (id: string) => prisma.rideOffer.findUniqueOrThrow({ where: { id } });
    expect(await status(future.id)).toMatchObject({ status: "OPEN", seatsAvailable: 1 });
    expect((await status(departed.id)).status).toBe("FULL");
    expect((await status(closed.id)).status).toBe("CLOSED");
  });
});
