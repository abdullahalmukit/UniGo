import { describe, expect, it } from "vitest";
import { runCloseRideOfferJob } from "../../src/jobs/activity-timers.job.js";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { prisma } from "../../src/lib/prisma.js";
import { applyAccountAction } from "../../src/modules/admin/moderation.service.js";
import { fromNow, HOUR, MINUTE, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { channelsOf, settle } from "./notification-helpers.js";
import { activeRider, addVehicle, book, offerBody, postOffer, postRequest, requestBody, subArea } from "./ride-helpers.js";

async function openOffer(seats = 3, overrides: Record<string, unknown> = {}) {
  const rider = await activeRider();
  const response = await postOffer(rider.accessToken, offerBody(rider.vehicle.id, { seats, ...overrides }));
  expect(response.status).toBe(201);
  return { rider, offer: response.body.offer };
}

const getOffer = (token: string, id: string) => api().get(`/api/rides/offers/${id}`).set(bearer(token));
const offerRow = (id: string) => prisma.rideOffer.findUniqueOrThrow({ where: { id } });

describe("Offer a Ride", () => {
  it("is for Active riders, with their approved vehicle and seats within its capacity", async () => {
    const student = await verifiedUser();
    const studentCar = await addVehicle(student.id);
    expect((await postOffer(student.accessToken, offerBody(studentCar.id))).body.error.code).toBe("RIDER_NOT_ACTIVE");

    const rider = await activeRider();
    const smallCar = await addVehicle(rider.id, "CAR", 2);
    const bike = await addVehicle(rider.id, "BIKE");
    expect((await postOffer(rider.accessToken, offerBody(smallCar.id, { seats: 3 }))).body.error).toMatchObject({ code: "SEATS_EXCEED_CAPACITY", max: 2 });
    expect((await postOffer(rider.accessToken, offerBody(bike.id, { seats: 2 }))).body.error).toMatchObject({ code: "SEATS_EXCEED_CAPACITY", max: 1 });
    const pending = await addVehicle(rider.id);
    await prisma.vehicle.update({ where: { id: pending.id }, data: { status: "PENDING" } });
    expect((await postOffer(rider.accessToken, offerBody(pending.id))).body.error.code).toBe("VEHICLE_NOT_USABLE");

    const created = await postOffer(rider.accessToken, offerBody(bike.id, { seats: 1, subAreaId: (await subArea()).id }));
    expect(created.status).toBe(201);
    expect(created.body.offer).toMatchObject({ status: "OPEN", totalSeats: 1, seatsAvailable: 1, farePerSeat: 80, mine: true, bookings: [] });
    expect(created.body.offer.vehicle.registrationNumber).toContain("••");
    expect([...scheduledJobs.values()].some((job) => job.name === "ride-offer-close" && job.data.id === created.body.offer.id)).toBe(true);
  });

  it("refuses an offer within 90 minutes of the rider's other offers or accepted activities (Q2)", async () => {
    const { rider, offer } = await openOffer();
    const near = new Date(new Date(offer.departureTime).getTime() + 60 * MINUTE).toISOString();
    expect((await postOffer(rider.accessToken, offerBody(rider.vehicle.id, { departureTime: near }))).body.error.code).toBe("TIME_CONFLICT");
    const apart = new Date(new Date(offer.departureTime).getTime() + 90 * MINUTE).toISOString();
    expect((await postOffer(rider.accessToken, offerBody(rider.vehicle.id, { departureTime: apart }))).status).toBe(201);
  });
});

describe("booking seats (proposal 8.4)", () => {
  it("books one seat by default, fixes the amount, opens a chat and tells the rider", async () => {
    const { rider, offer } = await openOffer(3);
    const passenger = await verifiedUser();
    const response = await book(passenger.accessToken, offer.id);
    expect(response.status).toBe(201);
    expect(response.body.booking).toMatchObject({ status: "ACCEPTED", subStatus: "RIDE_CONFIRMED", seatsBooked: 1, amount: 80, role: "PASSENGER", chatId: expect.any(String) });
    expect((await offerRow(offer.id)).seatsAvailable).toBe(2);
    await settle();
    expect(await channelsOf(rider.id, "SEAT_BOOKED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);

    const companions = await book((await verifiedUser()).accessToken, offer.id, 2);
    expect(companions.body.booking).toMatchObject({ seatsBooked: 2, amount: 160 });
    expect(await offerRow(offer.id)).toMatchObject({ seatsAvailable: 0, status: "FULL" });
  });

  it("keeps the booked amount when the rider later adds seats", async () => {
    const { rider, offer } = await openOffer(2);
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id, 2)).body.booking;
    expect((await offerRow(offer.id)).status).toBe("FULL");

    const fare = await api().patch(`/api/rides/offers/${offer.id}`).set(bearer(rider.accessToken)).send({ farePerSeat: 200 });
    expect(fare.body.error).toMatchObject({ code: "OFFER_LOCKED", fields: ["farePerSeat"] });
    const fewer = await api().patch(`/api/rides/offers/${offer.id}`).set(bearer(rider.accessToken)).send({ seats: 1 });
    expect(fewer.body.error.code).toBe("OFFER_LOCKED");
    const more = await api().patch(`/api/rides/offers/${offer.id}`).set(bearer(rider.accessToken)).send({ seats: 4 });
    expect(more.body.offer).toMatchObject({ totalSeats: 4, seatsAvailable: 2, status: "OPEN" });
    const stored = await prisma.rideBooking.findUniqueOrThrow({ where: { activityId: booking.activityId } });
    expect(Number(stored.amount)).toBe(160);
  });

  it("refuses more seats than are left, a second booking by the same passenger, and the rider's own offer", async () => {
    const { rider, offer } = await openOffer(2);
    const passenger = await verifiedUser();
    expect((await book(passenger.accessToken, offer.id, 3)).body.error).toMatchObject({ code: "NOT_ENOUGH_SEATS", seatsAvailable: 2 });
    expect((await book(passenger.accessToken, offer.id)).status).toBe(201);
    expect((await book(passenger.accessToken, offer.id)).body.error.code).toBe("ALREADY_BOOKED");
    expect((await book(rider.accessToken, offer.id)).body.error.code).toBe("OWN_ITEM");
  });

  it("prevents a duplicate booking from two requests by the same passenger at the same moment", async () => {
    const { offer } = await openOffer(3);
    const passenger = await verifiedUser();
    const results = await Promise.all([book(passenger.accessToken, offer.id), book(passenger.accessToken, offer.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.rideBooking.count({ where: { rideOfferId: offer.id } })).toBe(1);
    expect((await offerRow(offer.id)).seatsAvailable).toBe(2);
  });

  it("never overbooks: two passengers race for the last seat", async () => {
    const { offer } = await openOffer(1);
    const [a, b] = await Promise.all([verifiedUser(), verifiedUser()]);
    const results = await Promise.all([book(a.accessToken, offer.id), book(b.accessToken, offer.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await offerRow(offer.id)).toMatchObject({ seatsAvailable: 0, status: "FULL" });
  });

  it("gives seats back when a booking is cancelled, and the FULL offer opens again", async () => {
    const { offer } = await openOffer(1);
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id)).body.booking;
    const cancel = await api().post(`/api/activities/${booking.activityId}/cancel`).set(bearer(passenger.accessToken)).send({ reason: "Plans changed" });
    expect(cancel.status).toBe(200);
    expect(await offerRow(offer.id)).toMatchObject({ seatsAvailable: 1, status: "OPEN" });
    // After a cancelled booking the passenger may book again
    expect((await book(passenger.accessToken, offer.id)).status).toBe(201);
  });

  it("refuses inactive riders' offers, blocked users and passengers with their own open offer nearby", async () => {
    const { rider, offer } = await openOffer(3);
    const blocked = await verifiedUser();
    await prisma.block.create({ data: { blockerId: rider.id, blockedId: blocked.id } });
    expect((await book(blocked.accessToken, offer.id)).body.error.code).toBe("NOT_AVAILABLE");

    const otherRider = await activeRider();
    await postOffer(otherRider.accessToken, offerBody(otherRider.vehicle.id, { departureTime: offer.departureTime }));
    expect((await book(otherRider.accessToken, offer.id)).body.error.code).toBe("OWN_OFFER_CONFLICT");

    await prisma.user.update({ where: { id: rider.id }, data: { riderActive: false } });
    expect((await book((await verifiedUser()).accessToken, offer.id)).body.error.code).toBe("RIDER_NOT_AVAILABLE");
    const unverified = await registerUser();
    expect((await book(unverified.accessToken, offer.id)).body.error.code).toBe("NOT_VERIFIED");
  });
});

describe("privacy on shared offers (B3a addition 2)", () => {
  it("shows the rider every booking and a passenger only their own", async () => {
    const { rider, offer } = await openOffer(3);
    const [first, second] = await Promise.all([verifiedUser(), verifiedUser()]);
    await prisma.profile.update({ where: { userId: first.id }, data: { fullName: "Rina First" } });
    await prisma.profile.update({ where: { userId: second.id }, data: { fullName: "Karim Second" } });
    const firstBooking = (await book(first.accessToken, offer.id)).body.booking;
    const secondBooking = (await book(second.accessToken, offer.id, 2)).body.booking;

    const asRider = (await getOffer(rider.accessToken, offer.id)).body.offer;
    expect(asRider.bookings.map((b: { passenger: { name: string } }) => b.passenger.name)).toEqual(["Rina First", "Karim Second"]);

    const asFirst = (await getOffer(first.accessToken, offer.id)).body.offer;
    expect(asFirst.bookings).toEqual([]);
    expect(asFirst.myBooking).toMatchObject({ activityId: firstBooking.activityId, seatsBooked: 1 });
    expect(asFirst.seatsAvailable).toBe(0);
    const text = JSON.stringify(asFirst);
    expect(text).not.toContain("Karim Second");
    expect(text).not.toContain(second.id);
    expect(text).not.toContain(secondBooking.activityId);

    // Another passenger's booking is not reachable either
    expect((await api().get(`/api/rides/bookings/${secondBooking.activityId}`).set(bearer(first.accessToken))).status).toBe(404);
    const own = await api().get(`/api/rides/bookings/${firstBooking.activityId}`).set(bearer(first.accessToken));
    expect(own.body.booking).toMatchObject({ role: "PASSENGER", amount: 80 });
    expect(JSON.stringify(own.body.booking)).not.toContain("Karim Second");
  });
});

describe("stopping, removing and cancelling an offer (Q3)", () => {
  it("stops new bookings and keeps the accepted ones", async () => {
    const { rider, offer } = await openOffer(3);
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id)).body.booking;
    expect((await api().delete(`/api/rides/offers/${offer.id}`).set(bearer(rider.accessToken))).body.error.code).toBe("OFFER_HAS_BOOKINGS");

    const stopped = await api().post(`/api/rides/offers/${offer.id}/stop`).set(bearer(rider.accessToken));
    expect(stopped.body.offer).toMatchObject({ status: "CLOSED", closeReason: "STOPPED_BY_RIDER" });
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: booking.activityId } })).status).toBe("ACCEPTED");
    expect((await book((await verifiedUser()).accessToken, offer.id)).body.error.code).toBe("ALREADY_TAKEN");
  });

  it("removes an offer nobody booked", async () => {
    const { rider, offer } = await openOffer(2);
    const removed = await api().delete(`/api/rides/offers/${offer.id}`).set(bearer(rider.accessToken));
    expect(removed.body.offer).toMatchObject({ status: "CLOSED", closeReason: "REMOVED_BY_RIDER" });
    expect([...scheduledJobs.values()].some((job) => job.name === "ride-offer-close" && job.data.id === offer.id)).toBe(false);
  });

  it("cancels every accepted booking with the reason and notifies each passenger", async () => {
    const { rider, offer } = await openOffer(3, { departureTime: fromNow(50 * MINUTE).toISOString() });
    const [a, b] = await Promise.all([verifiedUser(), verifiedUser()]);
    const bookings = [(await book(a.accessToken, offer.id)).body.booking, (await book(b.accessToken, offer.id)).body.booking];

    const noReason = await api().post(`/api/rides/offers/${offer.id}/cancel`).set(bearer(rider.accessToken)).send({});
    expect(noReason.status).toBe(400);
    const cancelled = await api().post(`/api/rides/offers/${offer.id}/cancel`).set(bearer(rider.accessToken)).send({ reason: "Car broke down" });
    expect(cancelled.body.offer).toMatchObject({ status: "CLOSED", closeReason: "CANCELLED_BY_RIDER" });
    await settle();

    for (const [i, user] of [a, b].entries()) {
      const activity = await prisma.activity.findUniqueOrThrow({ where: { id: bookings[i].activityId } });
      expect(activity).toMatchObject({ status: "CANCELLED", cancelledById: rider.id, cancellationReason: "Car broke down", isLateCancellation: true });
      expect(await channelsOf(user.id, "ACTIVITY_CANCELLED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
    }
  });

  it("refuses to cancel while a booking has started", async () => {
    const { rider, offer } = await openOffer(2);
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id)).body.booking;
    await prisma.activity.update({ where: { id: booking.activityId }, data: { status: "IN_PROGRESS" } });
    const refused = await api().post(`/api/rides/offers/${offer.id}/cancel`).set(bearer(rider.accessToken)).send({ reason: "Car broke down" });
    expect(refused.body.error.code).toBe("OFFER_HAS_STARTED_BOOKINGS");
  });

  it("closes at departure; bookings carry on and the offer never reopens", async () => {
    const { offer } = await openOffer(1);
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id)).body.booking;
    await prisma.rideOffer.update({ where: { id: offer.id }, data: { departureTime: fromNow(-MINUTE) } });
    expect(await runCloseRideOfferJob(offer.id)).toBe(true);
    expect(await offerRow(offer.id)).toMatchObject({ status: "CLOSED", closeReason: "DEPARTED" });
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: booking.activityId } })).status).toBe("ACCEPTED");
  });
});

describe("account lock and ride sharing (proposal 17.1)", () => {
  it("closes the rider's offers, cancels their open requests and keeps accepted bookings, telling the passengers", async () => {
    const admin = await registerUser({ role: "SUPER_ADMIN", studentVerificationStatus: "VERIFIED" });
    const { rider, offer } = await openOffer(3);
    const area = await subArea();
    const request = (await postRequest(rider.accessToken, requestBody(area.id, { startTime: fromNow(8 * HOUR).toISOString() }))).body.request;
    const passenger = await verifiedUser();
    const booking = (await book(passenger.accessToken, offer.id)).body.booking;

    await applyAccountAction(admin.id, rider.id, "suspend", { reason: "Unsafe driving", endsAt: fromNow(48 * HOUR) });
    await settle();

    expect(await offerRow(offer.id)).toMatchObject({ status: "CLOSED", closeReason: "ACCOUNT_MODERATED" });
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("CANCELLED");
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: booking.activityId } })).status).toBe("ACCEPTED");
    expect(await channelsOf(passenger.id, "PARTICIPANT_ACCOUNT_LOCKED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
  });
});
