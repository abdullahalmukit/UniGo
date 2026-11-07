import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { setOutboundFetchForTests } from "../../src/lib/outbound.js";
import { dhakaDateString, dhakaWallTime } from "../../src/utils/time.js";
import { fromNow, HOUR, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { activeRider, fakeOsrm, offerBody, postOffer, postRequest, requestBody, subArea } from "./ride-helpers.js";

const list = (token: string, query: Record<string, string | number> = {}) => api().get("/api/rides").query(query).set(bearer(token));
const kinds = (body: { items: { kind: string; id: string }[] }) => body.items.map((item) => item.kind);

describe("the Ride page and Search a Ride", () => {
  it("shows every open request and offer by default, nearest time first, and marks your own", async () => {
    const area = await subArea();
    const viewer = await verifiedUser();
    const passenger = await verifiedUser();
    const rider = await activeRider();
    await postRequest(passenger.accessToken, requestBody(area.id, { startTime: fromNow(5 * HOUR).toISOString() }));
    await postOffer(rider.accessToken, offerBody(rider.vehicle.id, { departureTime: fromNow(2 * HOUR).toISOString() }));
    await postRequest(viewer.accessToken, requestBody(area.id, { startTime: fromNow(8 * HOUR).toISOString() }));

    const all = await list(viewer.accessToken);
    expect(all.status).toBe(200);
    expect(kinds(all.body)).toEqual(["OFFER", "REQUEST", "REQUEST"]);
    expect(all.body.items.map((item: { mine: boolean }) => item.mine)).toEqual([false, false, true]);
    expect(kinds((await list(viewer.accessToken, { type: "offers" })).body)).toEqual(["OFFER"]);
    expect(kinds((await list(viewer.accessToken, { type: "requests" })).body)).toEqual(["REQUEST", "REQUEST"]);
  });

  it("filters by pickup and destination within the chosen radius (Q6)", async () => {
    const area = await subArea();
    const viewer = await verifiedUser();
    const passenger = await verifiedUser();
    await postRequest(passenger.accessToken, requestBody(area.id));
    // Campus gate is at 23.8103, 90.4125; this point is about 1.5 km away
    const near = { pickupLat: 23.8238, pickupLng: 90.4125 };
    expect((await list(viewer.accessToken, { ...near, radiusKm: 2 })).body.items).toHaveLength(1);
    expect((await list(viewer.accessToken, { ...near, radiusKm: 1 })).body.items).toHaveLength(0);
    expect((await list(viewer.accessToken, { destinationLat: 23.7576, destinationLng: 90.3899 })).body.items).toHaveLength(1);
    expect((await list(viewer.accessToken, { destinationLat: 23.9, destinationLng: 90.5 })).body.items).toHaveLength(0);
    expect((await list(viewer.accessToken, { ...near, radiusKm: 3 })).status).toBe(400);
  });

  it("filters by the Asia/Dhaka day, the time range and the sub-area (B3a addition 5)", async () => {
    const [areaA, areaB] = await Promise.all([subArea(), subArea()]);
    const viewer = await verifiedUser();
    const passenger = await verifiedUser();
    // 01:30 Dhaka tomorrow is 19:30 UTC today: a UTC day filter would put it on the wrong day.
    const tomorrow = dhakaDateString(new Date(Date.now() + 24 * HOUR));
    const early = dhakaWallTime(tomorrow, 1, 30);
    const evening = dhakaWallTime(tomorrow, 18, 0);
    const a = await postRequest(passenger.accessToken, requestBody(areaA.id, { startTime: early.toISOString() }));
    const b = await postRequest(passenger.accessToken, requestBody(areaB.id, { startTime: evening.toISOString() }));
    // Tomorrow is always 15 min to 48 h ahead for both times
    expect([a.status, b.status]).toEqual([201, 201]);

    const day = await list(viewer.accessToken, { date: tomorrow });
    expect(day.body.items.map((i: { id: string }) => i.id).sort()).toEqual([a.body.request.id, b.body.request.id].sort());
    expect((await list(viewer.accessToken, { date: tomorrow, timeFrom: "17:00", timeTo: "19:00" })).body.items.map((i: { id: string }) => i.id)).toEqual([
      b.body.request.id,
    ]);
    expect((await list(viewer.accessToken, { timeTo: "02:00" })).body.items.map((i: { id: string }) => i.id)).toEqual([a.body.request.id]);
    expect((await list(viewer.accessToken, { subAreaId: areaB.id })).body.items.map((i: { id: string }) => i.id)).toEqual([b.body.request.id]);
  });

  it("leaves out blocked users both ways and offers of riders who are not Active", async () => {
    const viewer = await verifiedUser();
    const blockedRider = await activeRider();
    const blockingRider = await activeRider();
    const inactiveRider = await activeRider();
    for (const rider of [blockedRider, blockingRider, inactiveRider]) await postOffer(rider.accessToken, offerBody(rider.vehicle.id));
    await prisma.block.create({ data: { blockerId: viewer.id, blockedId: blockedRider.id } });
    await prisma.block.create({ data: { blockerId: blockingRider.id, blockedId: viewer.id } });
    await prisma.user.update({ where: { id: inactiveRider.id }, data: { riderActive: false } });

    expect((await list(viewer.accessToken)).body.items).toEqual([]);
    expect((await list((await verifiedUser()).accessToken)).body.items).toHaveLength(2);
  });

  it("is for verified students only", async () => {
    const unverified = await registerUser();
    expect((await list(unverified.accessToken)).body.error.code).toBe("NOT_VERIFIED");
    expect((await api().get("/api/rides")).status).toBe(401);
  });
});

describe("suggested fare (proposal 8.2)", () => {
  const estimate = (token: string) =>
    api().get("/api/rides/fare-estimate").query({ fromLat: 23.8103, fromLng: 90.4125, toLat: 23.7576, toLng: 90.3899 }).set(bearer(token));

  it("is the route distance times the admin rate, and nothing when either is missing", async () => {
    const user = await verifiedUser();
    fakeOsrm(7480);
    expect((await estimate(user.accessToken)).body).toEqual({ distanceKm: 7.48, ratePerKm: null, suggested: null });
    await prisma.fareSetting.create({ data: { ratePerKm: 12.5 } });
    expect((await estimate(user.accessToken)).body).toEqual({ distanceKm: 7.48, ratePerKm: 12.5, suggested: 94 });

    fakeOsrm(null);
    // Cached distance is used again; a new route with OSRM down gives none
    const other = await api().get("/api/rides/fare-estimate").query({ fromLat: 23.7, fromLng: 90.3, toLat: 23.75, toLng: 90.35 }).set(bearer(user.accessToken));
    expect(other.body).toEqual({ distanceKm: null, ratePerKm: 12.5, suggested: null });
  });

  it("is limited per user, since the route server is a public one", async () => {
    const user = await verifiedUser();
    fakeOsrm(1000);
    for (let i = 0; i < 20; i += 1) expect((await estimate(user.accessToken)).status).toBe(200);
    expect((await estimate(user.accessToken)).body.error.code).toBe("RATE_LIMITED");
  });
});

describe("Fare Settings (Super Admin)", () => {
  it("sets a new rate, keeps the history and writes the Audit Log", async () => {
    const admin = await registerUser({ role: "SUPER_ADMIN", studentVerificationStatus: "VERIFIED" });
    const moderator = await registerUser({ role: "MODERATOR", studentVerificationStatus: "VERIFIED" });
    expect((await api().get("/api/admin/fare-settings").set(bearer(moderator.accessToken))).status).toBe(403);

    await api().post("/api/admin/fare-settings").set(bearer(admin.accessToken)).send({ ratePerKm: 10 });
    const second = await api().post("/api/admin/fare-settings").set(bearer(admin.accessToken)).send({ ratePerKm: 12.345 });
    expect(second.status).toBe(201);
    expect(second.body.current).toBe(12.35);
    expect(second.body.history.map((h: { ratePerKm: number }) => h.ratePerKm)).toEqual([12.35, 10]);
    expect((await api().post("/api/admin/fare-settings").set(bearer(admin.accessToken)).send({ ratePerKm: 0 })).status).toBe(400);

    const audit = await prisma.auditLog.findMany({ where: { action: "FARE_RATE_SET" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.oldValue, a.newValue])).toEqual([
      [{ ratePerKm: null }, { ratePerKm: 10 }],
      [{ ratePerKm: 10 }, { ratePerKm: 12.35 }],
    ]);
  });
});

describe("place search through the server (Nominatim)", () => {
  function fakeNominatim() {
    const calls: { url: string; at: number; agent: string }[] = [];
    setOutboundFetchForTests(async (url, init) => {
      calls.push({ url, at: Date.now(), agent: init.headers["User-Agent"] });
      const body = url.includes("/reverse") ? { display_name: "Road 27, Dhanmondi" } : [{ display_name: "Dhanmondi Lake", lat: "23.74", lon: "90.37" }];
      return { ok: true, status: 200, json: async () => body };
    });
    return calls;
  }

  it("searches Bangladesh only, caches answers and keeps one request per second for the whole server", async () => {
    const calls = fakeNominatim();
    const [a, b] = await Promise.all([verifiedUser(), registerUser()]);
    const first = await api().get("/api/geo/search").query({ q: "Dhanmondi lake", lang: "en" }).set(bearer(a.accessToken));
    expect(first.body.places).toEqual([{ label: "Dhanmondi Lake", lat: 23.74, lng: 90.37 }]);
    // Another user, same question: answered from the cache
    await api().get("/api/geo/search").query({ q: "dhanmondi  LAKE", lang: "en" }).set(bearer(b.accessToken));
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).searchParams.get("countrycodes")).toBe("bd");
    expect(calls[0].agent).toMatch(/^UniGo\//);

    const [reverse] = await Promise.all([
      api().get("/api/geo/reverse").query({ lat: 23.7465, lng: 90.3762, lang: "bn" }).set(bearer(a.accessToken)),
      api().get("/api/geo/search").query({ q: "Mirpur 10", lang: "en" }).set(bearer(b.accessToken)),
    ]);
    expect(reverse.body).toEqual({ address: "Road 27, Dhanmondi" });
    expect(calls).toHaveLength(3);
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(990);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(990);
  });

  it("answers 503 when Nominatim fails, and needs a login", async () => {
    setOutboundFetchForTests(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const user = await verifiedUser();
    const failed = await api().get("/api/geo/search").query({ q: "Uttara" }).set(bearer(user.accessToken));
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe("GEO_UNAVAILABLE");
    expect((await api().get("/api/geo/search").query({ q: "Uttara" })).status).toBe(401);
  });
});
