import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";
import { HOUR, fromNow, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { activeRider, book, offerBody, postOffer, postRequest, requestBody, subArea } from "./ride-helpers.js";
import { foodBody, postFood, acceptFood } from "./food-helpers.js";
import { postBody, createPost } from "./carpool-helpers.js";

// B9 Stage 1 (proposal section 20): ranked, explained suggestions; the log
// for Stage 2; admin metrics; the service category hint.

const suggestions = (token: string, query: Record<string, string | number>) => api().get("/api/matching/suggestions").query(query).set(bearer(token));
const farAway = { address: "Uttara", lat: 23.8759, lng: 90.3795 };
const nearCampus = { address: "Near the campus", lat: 23.812, lng: 90.414 };

describe("ride suggestions", () => {
  it("ranks open offers for my request by place, time and the rider, explains why, and leaves out what I cannot book", async () => {
    const area = await subArea();
    const passenger = await verifiedUser();
    const mine = await postRequest(passenger.accessToken, requestBody(area.id, { passengerCount: 2 }));
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);

    const [best, later, far, small] = await Promise.all([activeRider(), activeRider(), activeRider(), activeRider()]);
    const bestOffer = (await postOffer(best.accessToken, offerBody(best.vehicle.id, { pickup: nearCampus, departureTime: fromNow(3 * HOUR).toISOString() }))).body.offer;
    const laterOffer = (await postOffer(later.accessToken, offerBody(later.vehicle.id, { departureTime: fromNow(5 * HOUR).toISOString() }))).body.offer;
    await postOffer(far.accessToken, offerBody(far.vehicle.id, { pickup: farAway }));
    // Only one seat: cannot take my 2 passengers
    await postOffer(small.accessToken, offerBody(small.vehicle.id, { seats: 1 }));
    // My own offer is never suggested to me
    await prisma.user.update({ where: { id: passenger.id }, data: { isVerifiedRider: true } });

    const result = await suggestions(passenger.accessToken, { feature: "ride", from: mine.body.request.id });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.target).toBe("ride_offer");
    const ids = result.body.suggestions.map((s: { item: { id: string } }) => s.item.id);
    expect(ids).toEqual([bestOffer.id, laterOffer.id]);
    expect(result.body.suggestions[0]).toMatchObject({ rank: 1, target: "ride_offer" });
    expect(result.body.suggestions[0].score).toBeGreaterThan(result.body.suggestions[1].score);
    expect(result.body.suggestions[0].reasons.map((r: { code: string }) => r.code)).toContain("PICKUP_NEAR");
    // No email or phone of anyone in the suggestions
    expect(JSON.stringify(result.body)).not.toMatch(/@|\+880/);
  });

  it("suggests passenger requests for my offer, and needs a place or one of my own items", async () => {
    const area = await subArea();
    const rider = await activeRider();
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id, { seats: 2 }))).body.offer;
    const fits = await verifiedUser();
    const tooMany = await verifiedUser();
    const request = (await postRequest(fits.accessToken, requestBody(area.id))).body.request;
    await postRequest(tooMany.accessToken, requestBody(area.id, { passengerCount: 3 }));

    const result = await suggestions(rider.accessToken, { feature: "ride", from: offer.id });
    expect(result.body.target).toBe("ride_request");
    expect(result.body.suggestions.map((s: { item: { id: string } }) => s.item.id)).toEqual([request.id]);

    expect((await suggestions(rider.accessToken, { feature: "ride" })).body.error.code).toBe("MATCH_CONTEXT_REQUIRED");
    const someoneElse = await verifiedUser();
    expect((await suggestions(someoneElse.accessToken, { feature: "ride", from: offer.id })).body.error.code).toBe("MATCH_SOURCE_NOT_FOUND");
    const unverified = await registerUser();
    expect((await suggestions(unverified.accessToken, { feature: "ride", pickupLat: 23.81, pickupLng: 90.41 })).status).toBe(403);
  });

  it("never suggests a blocked user's offer", async () => {
    const passenger = await verifiedUser();
    const rider = await activeRider();
    await postOffer(rider.accessToken, offerBody(rider.vehicle.id));
    await prisma.block.create({ data: { blockerId: rider.id, blockedId: passenger.id } });
    const result = await suggestions(passenger.accessToken, { feature: "ride", target: "offers", pickupLat: 23.8103, pickupLng: 90.4125 });
    expect(result.body.suggestions).toEqual([]);
  });
});

describe("other features", () => {
  it("ranks carpool posts by place and departure time", async () => {
    const [early, late] = await Promise.all([activeRider(), activeRider()]);
    const earlyPost = (await createPost(early.accessToken, postBody(early.vehicle.id, { departureMinute: 8 * 60 }))).body.post;
    const latePost = (await createPost(late.accessToken, postBody(late.vehicle.id, { departureMinute: 11 * 60 }))).body.post;
    const passenger = await verifiedUser();
    // 08:10 Asia/Dhaka = 02:10 UTC
    const result = await suggestions(passenger.accessToken, { feature: "carpool", pickupLat: 23.8103, pickupLng: 90.4125, time: "2026-12-01T02:10:00.000Z" });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.suggestions.map((s: { item: { id: string } }) => s.item.id)).toEqual([earlyPost.id, latePost.id]);
  });

  it("ranks food requests near me and service requests; logs what was shown and what was taken", async () => {
    const area = await subArea();
    const requester = await verifiedUser();
    const food = (await postFood(requester.accessToken, foodBody(area.id))).body.request;
    const accepter = await verifiedUser();
    const restaurant = foodBody(area.id).restaurant as { lat: number; lng: number };

    const result = await suggestions(accepter.accessToken, { feature: "food", pickupLat: restaurant.lat, pickupLng: restaurant.lng });
    expect(result.body.suggestions.map((s: { item: { id: string } }) => s.item.id)).toEqual([food.id]);
    await settleBackgroundTasks();
    // Shown once per hour, however often the page asks
    await suggestions(accepter.accessToken, { feature: "food", pickupLat: restaurant.lat, pickupLng: restaurant.lng });
    await settleBackgroundTasks();
    expect(await prisma.matchSuggestion.count({ where: { viewerId: accepter.id } })).toBe(1);

    expect((await acceptFood(accepter.accessToken, food.id)).status).toBe(200);
    await settleBackgroundTasks();
    const row = await prisma.matchSuggestion.findFirstOrThrow({ where: { viewerId: accepter.id } });
    expect(row).toMatchObject({ feature: "food", target: "food", candidateId: food.id, rank: 1 });
    expect(row.takenAt).toBeInstanceOf(Date);

    const services = await suggestions(accepter.accessToken, { feature: "service", destinationLat: 23.81, destinationLng: 90.41 });
    expect(services.status).toBe(200);
  });
});

describe("admin metrics and the category hint", () => {
  it("shows shown, taken, acceptance and precision@k to admins only", async () => {
    const passenger = await verifiedUser();
    const rider = await activeRider();
    const offer = (await postOffer(rider.accessToken, offerBody(rider.vehicle.id))).body.offer;
    await suggestions(passenger.accessToken, { feature: "ride", target: "offers", pickupLat: 23.8103, pickupLng: 90.4125 });
    await settleBackgroundTasks();
    expect((await book(passenger.accessToken, offer.id)).status).toBe(201);
    await settleBackgroundTasks();

    const moderator = await registerUser({ role: "MODERATOR" });
    const metrics = await api().get("/api/admin/matching/metrics").set(bearer(moderator.accessToken));
    expect(metrics.status).toBe(200);
    expect(metrics.body).toMatchObject({ shown: 1, taken: 1, acceptanceRate: 1, precisionAt1: 1 });
    expect(metrics.body.features).toEqual([{ feature: "ride", shown: 1, taken: 1, acceptanceRate: 1 }]);
    expect((await api().get("/api/admin/matching/metrics").set(bearer(passenger.accessToken))).status).toBe(403);
  });

  it("suggests a Uni Service category from the description, and nothing for short or unclear text", async () => {
    const user = await verifiedUser();
    const pharmacy = await prisma.serviceCategory.upsert({
      where: { code: "PHARMACY_HEALTHCARE" },
      update: { isActive: true },
      create: { code: "PHARMACY_HEALTHCARE", sortOrder: 3, isActive: true },
    });
    const hint = await api().get("/api/matching/service-category").query({ text: "Buy medicine from the pharmacy with my prescription" }).set(bearer(user.accessToken));
    expect(hint.body.suggestion).toMatchObject({ categoryId: pharmacy.id, code: "PHARMACY_HEALTHCARE" });
    expect((await api().get("/api/matching/service-category").query({ text: "hi" }).set(bearer(user.accessToken))).body.suggestion).toBeNull();
  });
});
