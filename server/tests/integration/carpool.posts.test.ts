import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { runCarpoolPostCloseJob } from "../../src/modules/carpool/carpool.jobs.js";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";
import { addVehicle, activeRider } from "./ride-helpers.js";
import { acceptSeat, createPost, getPost, heldSeat, inDays, postBody, requested, riderWithPost, today } from "./carpool-helpers.js";
import { channelsOf, settle, subscribeDevice } from "./notification-helpers.js";

const patch = (token: string, id: string, body: Record<string, unknown>) => api().patch(`/api/carpool/posts/${id}`).set(bearer(token)).send(body);

describe("creating carpool posts (B6a)", () => {
  it("is for Active riders only", async () => {
    const student = await verifiedUser();
    const vehicle = await addVehicle(student.id);
    const response = await createPost(student.accessToken, postBody(vehicle.id));
    expect([response.status, response.body.error.code]).toEqual([403, "RIDER_NOT_ACTIVE"]);
  });

  it("creates a post with its prices, seats and dates", async () => {
    const { post } = await riderWithPost({ validUntil: inDays(200) });
    expect(post).toMatchObject({ status: "OPEN", seatsAvailable: 2, totalSeats: 2, paused: false, validFrom: today(), validUntil: inDays(200) });
    expect((post as unknown as { prices: unknown[] }).prices).toHaveLength(4);
    // The post closes when its end date has passed
    expect([...scheduledJobs.values()].some((job) => job.name === "carpool-post-close")).toBe(true);
  });

  it("allows exactly 1 seat on a BIKE and 1-4 on a CAR, within the vehicle's capacity", async () => {
    const biker = await activeRider("BIKE");
    expect((await createPost(biker.accessToken, postBody(biker.vehicle.id, { seats: 2 }))).body.error.code).toBe("SEATS_EXCEED_CAPACITY");
    expect((await createPost(biker.accessToken, postBody(biker.vehicle.id, { seats: 1 }))).status).toBe(201);

    const driver = await activeRider("CAR");
    expect((await createPost(driver.accessToken, postBody(driver.vehicle.id, { seats: 5 }))).status).toBe(400);
    expect((await createPost(driver.accessToken, postBody(driver.vehicle.id, { seats: 4 }))).status).toBe(201);
    const small = await addVehicle(driver.id, "CAR", 3);
    const tooMany = await createPost(driver.accessToken, postBody(small.id, { seats: 4, departureMinute: 14 * 60 }));
    expect([tooMany.status, tooMany.body.error.code]).toEqual([400, "SEATS_EXCEED_CAPACITY"]);
  });

  it("allows at most 12 schedules; a removed post no longer counts", async () => {
    const rider = await activeRider();
    // Every day, two hours apart: 12 schedules that never overlap
    for (let i = 0; i < 12; i += 1) {
      const response = await createPost(rider.accessToken, postBody(rider.vehicle.id, { departureMinute: i * 120 }));
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    }
    const thirteenth = await createPost(rider.accessToken, postBody(rider.vehicle.id, { departureMinute: 60, daysOfWeek: 1 }));
    expect([thirteenth.status, thirteenth.body.error.code, thirteenth.body.error.max]).toEqual([409, "SCHEDULE_LIMIT_REACHED", 12]);

    const first = await prisma.carpoolPost.findFirstOrThrow({ where: { riderId: rider.id, departureMinute: 0 } });
    expect((await api().delete(`/api/carpool/posts/${first.id}`).set(bearer(rider.accessToken))).status).toBe(200);
    expect((await createPost(rider.accessToken, postBody(rider.vehicle.id, { departureMinute: 0 }))).status).toBe(201);
  });

  it("refuses a schedule within 90 minutes of the rider's own on a shared day; a paused post still counts", async () => {
    const { rider, post } = await riderWithPost({ daysOfWeek: 1 << 2, departureMinute: 8 * 60 });
    const near = await createPost(rider.accessToken, postBody(rider.vehicle.id, { daysOfWeek: (1 << 2) | (1 << 3), departureMinute: 9 * 60 }));
    expect([near.status, near.body.error.code, near.body.error.postId]).toEqual([409, "SCHEDULE_OVERLAP", post.id]);
    // Exactly 90 minutes apart, or another day: allowed
    expect((await createPost(rider.accessToken, postBody(rider.vehicle.id, { daysOfWeek: 1 << 2, departureMinute: 9 * 60 + 30 }))).status).toBe(201);
    expect((await createPost(rider.accessToken, postBody(rider.vehicle.id, { daysOfWeek: 1 << 3, departureMinute: 8 * 60 }))).status).toBe(201);

    await api().post(`/api/carpool/posts/${post.id}/pause`).set(bearer(rider.accessToken));
    const again = await createPost(rider.accessToken, postBody(rider.vehicle.id, { daysOfWeek: 1 << 2, departureMinute: 7 * 60 + 30 }));
    expect(again.body.error.code).toBe("SCHEDULE_OVERLAP");
  });

  it("checks the post's dates", async () => {
    const rider = await activeRider();
    const body = (overrides: Record<string, unknown>) => createPost(rider.accessToken, postBody(rider.vehicle.id, overrides));
    expect((await body({ validFrom: inDays(-1) })).body.error.code).toBe("VALID_FROM_IN_PAST");
    expect((await body({ validFrom: inDays(61) })).body.error.code).toBe("VALID_FROM_TOO_LATE");
    expect((await body({ validFrom: inDays(5), validUntil: inDays(4) })).body.error.code).toBe("VALID_UNTIL_BEFORE_FROM");
    // The shortest duration offered (1 month) must fit
    expect((await body({ validUntil: inDays(10) })).body.error.code).toBe("VALIDITY_TOO_SHORT");
  });
});

describe("changing carpool posts (B6a Q6, Q7)", () => {
  it("can be edited while nobody holds a seat; pending requests are then declined", async () => {
    const { rider, post } = await riderWithPost();
    const { passenger, id } = await requested(post.id);
    await subscribeDevice(passenger.id);
    const edited = await patch(rider.accessToken, post.id, { departureMinute: 9 * 60, seats: 3 });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.post).toMatchObject({ departureMinute: 9 * 60, totalSeats: 3, seatsAvailable: 3 });
    const booking = await prisma.activity.findUniqueOrThrow({ where: { id } });
    expect([booking.status, booking.closureReason]).toEqual(["CANCELLED", "POST_CHANGED"]);
    await settle();
    expect(await channelsOf(passenger.id, "CARPOOL_BOOKING_REJECTED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
  });

  it("after a seat is held only adds seats, pauses and resumes; it cannot be removed", async () => {
    const { rider, post } = await heldSeat();
    expect((await patch(rider.accessToken, post.id, { notes: "New notes" })).body.error.code).toBe("POST_LOCKED");
    const removed = await api().delete(`/api/carpool/posts/${post.id}`).set(bearer(rider.accessToken));
    expect(removed.body.error.code).toBe("POST_HAS_CONTRACTS");

    const seats = await api().post(`/api/carpool/posts/${post.id}/seats`).set(bearer(rider.accessToken)).send({ seats: 3 });
    expect(seats.body.post).toMatchObject({ totalSeats: 3, seatsAvailable: 2 });
    const lower = await api().post(`/api/carpool/posts/${post.id}/seats`).set(bearer(rider.accessToken)).send({ seats: 2 });
    expect(lower.body.error.code).toBe("SEATS_NOT_HIGHER");

    const paused = await api().post(`/api/carpool/posts/${post.id}/pause`).set(bearer(rider.accessToken));
    expect(paused.body.post).toMatchObject({ paused: true, status: "OPEN" });
    const resumed = await api().post(`/api/carpool/posts/${post.id}/resume`).set(bearer(rider.accessToken));
    expect(resumed.body.post).toMatchObject({ paused: false, status: "OPEN" });
  });

  it("a paused post takes no new requests or accepts and is not listed", async () => {
    const { rider, post } = await riderWithPost();
    const { id } = await requested(post.id);
    await api().post(`/api/carpool/posts/${post.id}/pause`).set(bearer(rider.accessToken));
    const passenger = await verifiedUser();
    const response = await api()
      .post(`/api/carpool/posts/${post.id}/bookings`)
      .set(bearer(passenger.accessToken))
      .send({ durationMonths: 1, startDate: inDays(3) });
    expect(response.body.error.code).toBe("POST_PAUSED");
    expect((await acceptSeat(rider.accessToken, id)).body.error.code).toBe("POST_PAUSED");
    expect((await api().get("/api/carpool").set(bearer(passenger.accessToken))).body.items).toEqual([]);
    // Still open to view, marked paused
    expect((await getPost(passenger.accessToken, post.id)).body.post.paused).toBe(true);
  });

  it("closes a post whose end date has passed; CLOSED is final", async () => {
    const { rider, post } = await riderWithPost({ validUntil: inDays(40) });
    const later = new Date(Date.now() + 42 * 24 * 60 * 60 * 1000);
    expect(await runCarpoolPostCloseJob(post.id, later)).toBe(1);
    expect(await runCarpoolPostCloseJob(post.id, later)).toBe(0);
    const stored = await prisma.carpoolPost.findUniqueOrThrow({ where: { id: post.id } });
    expect([stored.status, stored.closeReason]).toEqual(["CLOSED", "ENDED"]);
    expect((await api().post(`/api/carpool/posts/${post.id}/resume`).set(bearer(rider.accessToken))).body.error.code).toBe("POST_CLOSED");
  });
});

describe("search (B6a)", () => {
  it("filters by weekday, time and place, and leaves out blocked riders", async () => {
    const { rider: tuesday, post } = await riderWithPost({ daysOfWeek: 1 << 2, departureMinute: 8 * 60 });
    await riderWithPost({ daysOfWeek: 1 << 3, departureMinute: 17 * 60, pickup: { address: "Uttara", lat: 23.8759, lng: 90.3795 } });
    const viewer = await verifiedUser();
    const search = (query: Record<string, unknown>) => api().get("/api/carpool").query(query).set(bearer(viewer.accessToken));

    expect((await search({})).body.items).toHaveLength(2);
    expect((await search({ day: 2 })).body.items.map((p: { id: string }) => p.id)).toEqual([post.id]);
    expect((await search({ timeFrom: "16:00", timeTo: "18:00" })).body.items).toHaveLength(1);
    expect((await search({ pickupLat: 23.8103, pickupLng: 90.4125, radiusKm: 1 })).body.items.map((p: { id: string }) => p.id)).toEqual([post.id]);
    const item = (await search({ day: 2 })).body.items[0];
    expect(item).toMatchObject({ riderSessionCancellations: 0, vehicle: { registrationNumber: expect.stringContaining("••") } });

    await prisma.block.create({ data: { blockerId: tuesday.id, blockedId: viewer.id } });
    expect((await search({ day: 2 })).body.items).toEqual([]);
  });
});
