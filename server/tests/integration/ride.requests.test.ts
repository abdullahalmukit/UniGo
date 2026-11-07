import { describe, expect, it } from "vitest";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { prisma } from "../../src/lib/prisma.js";
import { runSubAreaNotifyJob } from "../../src/modules/notifications/sub-area.service.js";
import { fromNow, HOUR, MINUTE, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { channelsOf, settle } from "./notification-helpers.js";
import { activeRider, addVehicle, fakeOsrm, offerBody, postOffer, postRequest, requestBody, subArea } from "./ride-helpers.js";

describe("Need a Ride: creating a passenger request", () => {
  it("creates an OPEN request with its route distance, and queues expiry and the sub-area notice", async () => {
    fakeOsrm(5230);
    const area = await subArea();
    const passenger = await verifiedUser();
    const response = await postRequest(passenger.accessToken, requestBody(area.id));

    expect(response.status).toBe(201);
    const request = response.body.request;
    expect(request).toMatchObject({ kind: "REQUEST", status: "OPEN", offeredAmount: 150, passengerCount: 1, routeDistanceKm: 5.23, mine: true });
    expect(request.passenger).toMatchObject({ name: "Test Student", rating: null });
    expect(JSON.stringify(request)).not.toContain(passenger.email);
    const names = [...scheduledJobs.values()].map((job) => job.name);
    expect(names).toEqual(expect.arrayContaining(["activity-expire", "sub-area-notify"]));
  });

  it("still works when the route server does not answer", async () => {
    fakeOsrm(null);
    const area = await subArea();
    const passenger = await verifiedUser();
    const response = await postRequest(passenger.accessToken, requestBody(area.id));
    expect(response.status).toBe(201);
    expect(response.body.request.routeDistanceKm).toBeNull();
  });

  it("refuses unverified and restricted users, bad times, amounts and sub-areas", async () => {
    const area = await subArea();
    const unverified = await registerUser();
    const restricted = await verifiedUser();
    await prisma.user.update({ where: { id: restricted.id }, data: { accountStatus: "RESTRICTED" } });
    const passenger = await verifiedUser();

    expect((await postRequest(unverified.accessToken, requestBody(area.id))).body.error.code).toBe("NOT_VERIFIED");
    expect((await postRequest(restricted.accessToken, requestBody(area.id))).body.error.code).toBe("ACCOUNT_RESTRICTED");
    expect((await postRequest(passenger.accessToken, requestBody(area.id, { startTime: fromNow(5 * MINUTE).toISOString() }))).body.error.code).toBe("START_TOO_SOON");
    expect((await postRequest(passenger.accessToken, requestBody(area.id, { startTime: fromNow(49 * HOUR).toISOString() }))).body.error.code).toBe("START_TOO_LATE");
    expect((await postRequest(passenger.accessToken, requestBody(area.id, { offeredAmount: 1001 }))).status).toBe(400);
    expect((await postRequest(passenger.accessToken, requestBody(area.id, { offeredAmount: 9 }))).status).toBe(400);
    expect((await postRequest(passenger.accessToken, requestBody(area.id, { passengerCount: 5 }))).status).toBe(400);
    await prisma.subArea.update({ where: { id: area.id }, data: { isActive: false } });
    expect((await postRequest(passenger.accessToken, requestBody(area.id))).body.error.code).toBe("SUB_AREA_NOT_FOUND");
  });

  it("counts requests and offers together in the open limit", async () => {
    const area = await subArea();
    const rider = await activeRider();
    for (let i = 0; i < 2; i += 1) {
      expect((await postRequest(rider.accessToken, requestBody(area.id, { startTime: fromNow((3 + i * 3) * HOUR).toISOString() }))).status).toBe(201);
    }
    expect((await postOffer(rider.accessToken, offerBody(rider.vehicle.id, { departureTime: fromNow(12 * HOUR).toISOString() }))).status).toBe(201);
    const fourth = await postRequest(rider.accessToken, requestBody(area.id, { startTime: fromNow(20 * HOUR).toISOString() }));
    expect(fourth.body.error.code).toBe("OPEN_LIMIT_REACHED");
  });

  it("tells Active riders who saved the sub-area, and nobody else (B3a Q1)", async () => {
    const area = await subArea();
    const passenger = await verifiedUser();
    const rider = await activeRider();
    const inactiveRider = await activeRider();
    await prisma.user.update({ where: { id: inactiveRider.id }, data: { riderActive: false } });
    const student = await verifiedUser();
    await prisma.userSubArea.createMany({ data: [rider, inactiveRider, student].map((u) => ({ userId: u.id, subAreaId: area.id })) });

    const created = await postRequest(passenger.accessToken, requestBody(area.id));
    await runSubAreaNotifyJob(created.body.request.id);
    await settle();
    expect(await channelsOf(rider.id, "SUB_AREA_NEW_REQUEST")).toEqual(["IN_APP", "PUSH"]);
    expect(await channelsOf(inactiveRider.id, "SUB_AREA_NEW_REQUEST")).toEqual([]);
    expect(await channelsOf(student.id, "SUB_AREA_NEW_REQUEST")).toEqual([]);
    const list = await api().get("/api/notifications").set(bearer(rider.accessToken));
    expect(list.body.notifications[0].link).toBe(`/ride/requests/${created.body.request.id}`);
  });
});

describe("editing, upgrading and deleting an OPEN request", () => {
  it("lets the creator change it and moves its jobs with the start time", async () => {
    const area = await subArea();
    const passenger = await verifiedUser();
    const created = (await postRequest(passenger.accessToken, requestBody(area.id))).body.request;
    const newStart = fromNow(6 * HOUR);

    const edited = await api()
      .patch(`/api/rides/requests/${created.id}`)
      .set(bearer(passenger.accessToken))
      .send({ startTime: newStart.toISOString(), passengerCount: 2, notes: "" });
    expect(edited.status).toBe(200);
    expect(edited.body.request).toMatchObject({ passengerCount: 2, notes: null });
    expect(scheduledJobs.has(`activity-expire-${created.id}-${newStart.getTime()}`)).toBe(true);
    expect(scheduledJobs.has(`activity-expire-${created.id}-${new Date(created.startTime).getTime()}`)).toBe(false);

    const lower = await api().post(`/api/rides/requests/${created.id}/upgrade`).set(bearer(passenger.accessToken)).send({ offeredAmount: 100 });
    expect(lower.body.error.code).toBe("AMOUNT_NOT_HIGHER");
    const higher = await api().post(`/api/rides/requests/${created.id}/upgrade`).set(bearer(passenger.accessToken)).send({ offeredAmount: 200 });
    expect(higher.body.request.offeredAmount).toBe(200);

    const stranger = await verifiedUser();
    expect((await api().patch(`/api/rides/requests/${created.id}`).set(bearer(stranger.accessToken)).send({ passengerCount: 3 })).status).toBe(403);

    expect((await api().delete(`/api/activities/${created.id}`).set(bearer(passenger.accessToken))).status).toBe(200);
    expect((await api().get(`/api/rides/requests/${created.id}`).set(bearer(stranger.accessToken))).status).toBe(404);
  });
});

describe("accepting a passenger request (proposal 8.5)", () => {
  async function openRequest(passengerCount = 1) {
    const area = await subArea();
    const passenger = await verifiedUser();
    const request = (await postRequest(passenger.accessToken, requestBody(area.id, { passengerCount }))).body.request;
    return { passenger, request };
  }

  const accept = (token: string, id: string, vehicleId: string) => api().post(`/api/rides/requests/${id}/accept`).set(bearer(token)).send({ vehicleId });

  it("is only for Active riders with an approved vehicle that has enough seats", async () => {
    const { passenger, request } = await openRequest(2);
    const student = await verifiedUser();
    const studentVehicle = await addVehicle(student.id);
    const bikeRider = await activeRider("BIKE");
    const rider = await activeRider();
    const otherRidersCar = await addVehicle((await activeRider()).id);

    expect((await accept(student.accessToken, request.id, studentVehicle.id)).body.error.code).toBe("RIDER_NOT_ACTIVE");
    expect((await accept(bikeRider.accessToken, request.id, bikeRider.vehicle.id)).body.error.code).toBe("SEATS_EXCEED_CAPACITY");
    expect((await accept(rider.accessToken, request.id, otherRidersCar.id)).body.error.code).toBe("VEHICLE_NOT_USABLE");
    expect((await accept(passenger.accessToken, request.id, rider.vehicle.id)).body.error.code).toBe("OWN_ITEM");

    const ok = await accept(rider.accessToken, request.id, rider.vehicle.id);
    expect(ok.status).toBe(200);
    expect(ok.body.request).toMatchObject({ status: "ACCEPTED", subStatus: "RIDE_CONFIRMED", role: "RIDER", chatId: expect.any(String) });
    // The vehicle is shown masked, never in full
    expect(ok.body.request.vehicle.registrationNumber).toContain("••");
    const seenByPassenger = await api().get(`/api/rides/requests/${request.id}`).set(bearer(passenger.accessToken));
    expect(seenByPassenger.body.request.rider).toMatchObject({ id: rider.id });
    expect(seenByPassenger.body.request.vehicle.registrationNumber).not.toBe(rider.vehicle.registrationNumber);
  });

  it("lets only one of two riders accepting at the same moment succeed", async () => {
    const { request } = await openRequest();
    const [a, b] = await Promise.all([activeRider(), activeRider()]);
    const results = await Promise.all([accept(a.accessToken, request.id, a.vehicle.id), accept(b.accessToken, request.id, b.vehicle.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe("ALREADY_TAKEN");
  });

  it("refuses a rider with an OPEN offer of their own within 90 minutes until they stop its bookings", async () => {
    const { request } = await openRequest();
    const rider = await activeRider();
    const offer = await postOffer(rider.accessToken, offerBody(rider.vehicle.id, { departureTime: new Date(new Date(request.startTime).getTime() + 30 * MINUTE).toISOString() }));
    const refused = await accept(rider.accessToken, request.id, rider.vehicle.id);
    expect(refused.body.error).toMatchObject({ code: "OWN_OFFER_CONFLICT", offerId: offer.body.offer.id });
    expect(refused.body.error.message).toContain("Stop new bookings");

    await api().post(`/api/rides/offers/${offer.body.offer.id}/stop`).set(bearer(rider.accessToken));
    expect((await accept(rider.accessToken, request.id, rider.vehicle.id)).status).toBe(200);
  });

  it("notifies the passenger, who can start from 30 minutes before (Q4) and finish in two steps", async () => {
    const { passenger, request } = await openRequest();
    const rider = await activeRider();
    await accept(rider.accessToken, request.id, rider.vehicle.id);
    await settle();
    expect(await channelsOf(passenger.id, "REQUEST_ACCEPTED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);

    const early = await api().post(`/api/activities/${request.id}/start`).set(bearer(passenger.accessToken));
    expect(early.body.error.code).toBe("START_TOO_EARLY");

    await prisma.activity.update({ where: { id: request.id }, data: { startTime: fromNow(20 * MINUTE) } });
    expect((await api().post(`/api/activities/${request.id}/start`).set(bearer(rider.accessToken))).status).toBe(200);
    expect((await api().post(`/api/activities/${request.id}/request-completion`).set(bearer(rider.accessToken))).status).toBe(200);
    const done = await api().post(`/api/activities/${request.id}/confirm-completion`).set(bearer(passenger.accessToken));
    expect(done.body.activity.status).toBe("COMPLETED");
  });

  it("hides a request from users the passenger blocked, in both directions", async () => {
    const { passenger, request } = await openRequest();
    const rider = await activeRider();
    await prisma.block.create({ data: { blockerId: passenger.id, blockedId: rider.id } });
    expect((await api().get(`/api/rides/requests/${request.id}`).set(bearer(rider.accessToken))).status).toBe(404);
    const list = await api().get("/api/rides").set(bearer(rider.accessToken));
    expect(list.body.items).toEqual([]);
    expect((await accept(rider.accessToken, request.id, rider.vehicle.id)).body.error.code).toBe("NOT_AVAILABLE");
  });
});
