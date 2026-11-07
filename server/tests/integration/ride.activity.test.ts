import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { formatDhakaDateTime } from "../../src/utils/time.js";
import { fromNow, HOUR, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { activeRider, book, offerBody, postOffer, postRequest, requestBody, subArea } from "./ride-helpers.js";

type Item = { kind: string; id: string; role: string; status: string; phone: string | null; bookings: { activityId: string; phone: string | null }[] };

const activity = (token: string, query: Record<string, string> = {}) => api().get("/api/activity").query(query).set(bearer(token));
const upcoming = (token: string, query: Record<string, string> = {}) => api().get("/api/upcoming").query(query).set(bearer(token));
const ids = (body: { items: Item[] }) => body.items.map((item) => `${item.kind}:${item.id}`);

async function acceptedRequest() {
  const area = await subArea();
  const passenger = await verifiedUser();
  const rider = await activeRider();
  const request = (await postRequest(passenger.accessToken, requestBody(area.id))).body.request;
  const accepted = await api().post(`/api/rides/requests/${request.id}/accept`).set(bearer(rider.accessToken)).send({ vehicleId: rider.vehicle.id });
  expect(accepted.status).toBe(200);
  return { passenger, rider, request };
}

async function bookedOffer() {
  const rider = await activeRider();
  const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id))).body.offer;
  const passenger = await verifiedUser();
  const booking = (await book(passenger.accessToken, offer.id)).body.booking;
  return { rider, passenger, offer, booking };
}

describe("Activity after acceptance (B3b-1 problem 1)", () => {
  it("lets the passenger and the rider find an accepted request", async () => {
    const { passenger, rider, request } = await acceptedRequest();

    const mine = await activity(passenger.accessToken);
    expect(ids(mine.body)).toEqual([`RIDE_REQUEST:${request.id}`]);
    expect(mine.body.items[0]).toMatchObject({ role: "REQUESTED", status: "ACCEPTED", otherPerson: { id: rider.id } });
    const accepted = await activity(rider.accessToken, { role: "accepted" });
    expect(ids(accepted.body)).toEqual([`RIDE_REQUEST:${request.id}`]);
    expect(accepted.body.items[0].role).toBe("ACCEPTED");
    expect((await activity(rider.accessToken, { role: "requested" })).body.items).toEqual([]);
  });

  it("shows the passenger's booking and the rider's offer with its bookings", async () => {
    const { rider, passenger, offer, booking } = await bookedOffer();

    const forPassenger = await activity(passenger.accessToken);
    expect(ids(forPassenger.body)).toEqual([`RIDE_BOOKING:${booking.activityId}`]);
    expect(forPassenger.body.items[0]).toMatchObject({ role: "ACCEPTED", status: "ACCEPTED", otherPerson: { id: rider.id }, seats: 1, amount: 80 });

    const forRider = await activity(rider.accessToken);
    expect(ids(forRider.body)).toEqual([`RIDE_OFFER:${offer.id}`]);
    expect(forRider.body.items[0]).toMatchObject({ role: "REQUESTED", status: "OPEN", activeBookings: 1 });
    expect(forRider.body.items[0].bookings.map((b: { activityId: string }) => b.activityId)).toEqual([booking.activityId]);
  });

  it("files items under Active, Ongoing and History by status", async () => {
    const { passenger, request } = await acceptedRequest();
    expect(ids((await activity(passenger.accessToken, { tab: "ongoing" })).body)).toEqual([]);

    await prisma.activity.update({ where: { id: request.id }, data: { status: "IN_PROGRESS" } });
    expect(ids((await activity(passenger.accessToken, { tab: "ongoing" })).body)).toEqual([`RIDE_REQUEST:${request.id}`]);
    expect(ids((await activity(passenger.accessToken, { tab: "active" })).body)).toEqual([`RIDE_REQUEST:${request.id}`]);

    await prisma.activity.update({ where: { id: request.id }, data: { status: "COMPLETED" } });
    expect(ids((await activity(passenger.accessToken, { tab: "active" })).body)).toEqual([]);
    expect(ids((await activity(passenger.accessToken, { tab: "history" })).body)).toEqual([`RIDE_REQUEST:${request.id}`]);
    // Other features have no items yet; deleted requests are hidden
    expect((await activity(passenger.accessToken, { tab: "history", feature: "food" })).body.items).toEqual([]);
  });

  it("keeps a stopped offer in Active while a booking runs, then moves it to History", async () => {
    const { rider, offer, booking } = await bookedOffer();
    await api().post(`/api/rides/offers/${offer.id}/stop`).set(bearer(rider.accessToken));
    expect(ids((await activity(rider.accessToken)).body)).toEqual([`RIDE_OFFER:${offer.id}`]);
    await prisma.activity.update({ where: { id: booking.activityId }, data: { status: "COMPLETED" } });
    expect((await activity(rider.accessToken)).body.items).toEqual([]);
    expect(ids((await activity(rider.accessToken, { tab: "history" })).body)).toEqual([`RIDE_OFFER:${offer.id}`]);
  });

  it("hides deleted requests from Activity, but their creator can still open them", async () => {
    const area = await subArea();
    const passenger = await verifiedUser();
    const request = (await postRequest(passenger.accessToken, requestBody(area.id))).body.request;
    await api().delete(`/api/activities/${request.id}`).set(bearer(passenger.accessToken));
    expect((await activity(passenger.accessToken, { tab: "history" })).body.items).toEqual([]);
    const opened = await api().get(`/api/rides/requests/${request.id}`).set(bearer(passenger.accessToken));
    expect(opened.body.request).toMatchObject({ id: request.id, status: "CANCELLED" });
    expect((await api().get(`/api/rides/requests/${request.id}`).set(bearer((await verifiedUser()).accessToken))).status).toBe(404);
  });

  it("lets the rider open their own offer whatever its status", async () => {
    const rider = await activeRider();
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id))).body.offer;
    await api().delete(`/api/rides/offers/${offer.id}`).set(bearer(rider.accessToken));
    expect((await api().get(`/api/rides/offers/${offer.id}`).set(bearer(rider.accessToken))).body.offer.status).toBe("CLOSED");
  });

  it("needs a login", async () => {
    expect((await api().get("/api/activity")).status).toBe(401);
    expect((await api().get("/api/upcoming")).status).toBe(401);
  });
});

describe("Upcoming (proposal 12.3)", () => {
  it("lists future accepted rides nearest first, an offer only while it has an accepted booking", async () => {
    const rider = await activeRider();
    const area = await subArea();
    const passenger = await verifiedUser();
    const later = (await postRequest(passenger.accessToken, requestBody(area.id, { startTime: fromNow(10 * HOUR).toISOString() }))).body.request;
    await api().post(`/api/rides/requests/${later.id}/accept`).set(bearer(rider.accessToken)).send({ vehicleId: rider.vehicle.id });
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id, { departureTime: fromNow(5 * HOUR).toISOString() }))).body.offer;

    // An offer without bookings is not in Upcoming (still in Activity)
    expect(ids((await upcoming(rider.accessToken)).body)).toEqual([`RIDE_REQUEST:${later.id}`]);

    const booking = (await book(passenger.accessToken, offer.id, 2)).body.booking;
    const forRider = await upcoming(rider.accessToken);
    expect(ids(forRider.body)).toEqual([`RIDE_OFFER:${offer.id}`, `RIDE_REQUEST:${later.id}`]);
    expect(forRider.body.items[0].activeBookings).toBe(1);
    expect(ids((await upcoming(rider.accessToken, { role: "accepted" })).body)).toEqual([`RIDE_REQUEST:${later.id}`]);
    expect(ids((await upcoming(passenger.accessToken, { limit: "1" })).body)).toEqual([`RIDE_BOOKING:${booking.activityId}`]);

    // Started rides leave Upcoming
    await prisma.activity.update({ where: { id: later.id }, data: { status: "IN_PROGRESS" } });
    expect(ids((await upcoming(passenger.accessToken)).body)).toEqual([`RIDE_BOOKING:${booking.activityId}`]);
  });
});

describe("phone numbers after acceptance (B3b-1 fix D)", () => {
  it("shows each side the other's phone on the request, and hides it after a terminal status", async () => {
    const { passenger, rider, request } = await acceptedRequest();
    const [p, r] = await Promise.all([passenger, rider].map((u) => prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { phone: true } })));

    expect((await api().get(`/api/rides/requests/${request.id}`).set(bearer(passenger.accessToken))).body.request.phone).toBe(r.phone);
    expect((await api().get(`/api/rides/requests/${request.id}`).set(bearer(rider.accessToken))).body.request.phone).toBe(p.phone);
    expect((await activity(passenger.accessToken)).body.items[0].phone).toBe(r.phone);

    await api().post(`/api/activities/${request.id}/cancel`).set(bearer(passenger.accessToken)).send({ reason: "Plans changed" });
    expect((await api().get(`/api/rides/requests/${request.id}`).set(bearer(passenger.accessToken))).body.request.phone).toBeNull();
    expect((await activity(passenger.accessToken, { tab: "history" })).body.items[0].phone).toBeNull();
  });

  it("shows the rider each passenger's phone and the passenger the rider's, never an email", async () => {
    const { rider, passenger, offer, booking } = await bookedOffer();
    const [p, r] = await Promise.all([passenger, rider].map((u) => prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { phone: true } })));

    const asRider = (await api().get(`/api/rides/offers/${offer.id}`).set(bearer(rider.accessToken))).body.offer;
    expect(asRider.bookings[0].phone).toBe(p.phone);
    expect((await activity(rider.accessToken)).body.items[0].bookings[0].phone).toBe(p.phone);
    const asPassenger = (await api().get(`/api/rides/bookings/${booking.activityId}`).set(bearer(passenger.accessToken))).body.booking;
    expect(asPassenger.phone).toBe(r.phone);
    expect(asPassenger.rider).toMatchObject({ id: rider.id });
    expect((await api().get(`/api/rides/offers/${offer.id}`).set(bearer(passenger.accessToken))).body.offer.myBooking.phone).toBe(r.phone);
    for (const body of [asRider, asPassenger]) {
      expect(JSON.stringify(body)).not.toContain(passenger.email);
      expect(JSON.stringify(body)).not.toContain(rider.email);
    }
  });

  it("hides the phone at once when either user blocks the other", async () => {
    const { passenger, rider, request } = await acceptedRequest();
    // A direct block row: the block endpoint would also cancel the ride
    await prisma.block.create({ data: { blockerId: rider.id, blockedId: passenger.id } });
    expect((await api().get(`/api/rides/requests/${request.id}`).set(bearer(passenger.accessToken))).body.request.phone).toBeNull();
    expect((await api().get(`/api/rides/requests/${request.id}`).set(bearer(rider.accessToken))).body.request.phone).toBeNull();
    expect((await activity(passenger.accessToken)).body.items[0].phone).toBeNull();
  });
});

describe("public profile (B3b-1 G)", () => {
  it("shows the public details, badges, masked vehicles and open rides, never a phone or email", async () => {
    const rider = await activeRider();
    await prisma.profile.update({ where: { userId: rider.id }, data: { department: "CSE", batch: "2023" } });
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id))).body.offer;
    const viewer = await verifiedUser();
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: rider.id }, select: { phone: true } });

    const response = await api().get(`/api/users/${rider.id}/profile`).set(bearer(viewer.accessToken));
    expect(response.status).toBe(200);
    const profile = response.body.profile;
    expect(profile).toMatchObject({
      id: rider.id,
      department: "CSE",
      batch: "2023",
      badges: ["VERIFIED_STUDENT", "VERIFIED_RIDER"],
      stats: { rating: null, completionRate: null, lateCancellationRate: null },
      reviews: [],
      isMe: false,
    });
    expect(profile.vehicles[0].registrationNumber).toContain("••");
    expect(profile.openRides.map((r: { id: string }) => r.id)).toEqual([offer.id]);
    const text = JSON.stringify(profile);
    expect(text).not.toContain(rider.email);
    expect(text).not.toContain(stored.phone);
    expect(text).not.toContain(rider.vehicle.registrationNumber);
  });

  it("is refused between blocked users either way, for banned accounts and for unverified viewers", async () => {
    const [a, b, banned] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    await prisma.block.create({ data: { blockerId: a.id, blockedId: b.id } });
    expect((await api().get(`/api/users/${b.id}/profile`).set(bearer(a.accessToken))).body.error.code).toBe("PROFILE_NOT_FOUND");
    expect((await api().get(`/api/users/${a.id}/profile`).set(bearer(b.accessToken))).body.error.code).toBe("PROFILE_NOT_FOUND");
    await prisma.user.update({ where: { id: banned.id }, data: { accountStatus: "BANNED" } });
    expect((await api().get(`/api/users/${banned.id}/profile`).set(bearer(a.accessToken))).status).toBe(404);
    const unverified = await registerUser();
    expect((await api().get(`/api/users/${a.id}/profile`).set(bearer(unverified.accessToken))).body.error.code).toBe("NOT_VERIFIED");
    expect((await api().get(`/api/users/${a.id}/profile`).set(bearer(a.accessToken))).body.profile.isMe).toBe(true);
  });
});

describe("12-hour clock (B3b-1)", () => {
  it("writes email and notification times with am/pm, never 24-hour", () => {
    const at = new Date("2026-11-07T08:20:00.000Z");
    expect(formatDhakaDateTime(at, "EN")).toBe("7 November 2026 at 2:20 pm");
    expect(formatDhakaDateTime(at, "BN")).toContain("PM");
    expect(formatDhakaDateTime(at, "EN")).not.toContain("14:20");
  });
});
