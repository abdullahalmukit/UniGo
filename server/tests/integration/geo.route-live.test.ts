import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { rules } from "../../src/config/rules.js";
import { prisma } from "../../src/lib/prisma.js";
import { setOutboundFetchForTests } from "../../src/lib/outbound.js";
import { resetGeoForTests, setMapProviderForTests } from "../../src/modules/geo/geo.service.js";
import { attachSockets } from "../../src/sockets/index.js";
import { acceptedWithChat, verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";

afterEach(() => {
  setOutboundFetchForTests(null);
  setMapProviderForTests(null);
  resetGeoForTests();
});

describe("road route (GET /api/geo/route)", () => {
  const query = { fromLat: 23.7461, fromLng: 90.3742, toLat: 23.8103, toLng: 90.4125 };

  it("asks Barikoi with the key on the server and answers distance, time and the road line", async () => {
    const user = await verifiedUser();
    setMapProviderForTests("barikoi");
    const urls: string[] = [];
    setOutboundFetchForTests(async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: "Ok",
          routes: [{ distance: 9120, duration: 1500, geometry: { coordinates: [[90.3742, 23.7461], [90.4125, 23.8103]] } }],
        }),
      };
    });

    const response = await api().get("/api/geo/route").query(query).set(bearer(user.accessToken));
    expect(response.status).toBe(200);
    expect(response.body.route).toEqual({
      distanceMeters: 9120,
      durationSeconds: 1500,
      coordinates: [[90.3742, 23.7461], [90.4125, 23.8103]],
    });
    expect(urls[0]).toContain("/v2/api/route/90.374200,23.746100;90.412500,23.810300");
    expect(urls[0]).toContain("geometries=geojson");

    // Cached: the same route again makes no call.
    await api().get("/api/geo/route").query(query).set(bearer(user.accessToken));
    expect(urls).toHaveLength(1);
  });

  it("uses OSRM without Barikoi, answers 503 when the route server fails, and needs a login", async () => {
    const user = await verifiedUser();
    setOutboundFetchForTests(async (url) => {
      expect(url).toContain("/route/v1/driving/");
      return { ok: false, status: 502, json: async () => ({}) };
    });
    const failed = await api().get("/api/geo/route").query(query).set(bearer(user.accessToken));
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe("GEO_UNAVAILABLE");
    expect((await api().get("/api/geo/route").query(query)).status).toBe(401);
  });

  it("tells the client which map tiles to use", async () => {
    const user = await verifiedUser();
    const response = await api().get("/api/geo/config").set(bearer(user.accessToken));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ provider: "osm", styles: null });
  });
});

describe("live location over the socket", () => {
  let server: HttpServer;
  let sockets: ReturnType<typeof attachSockets>;
  let url: string;
  const open: Socket[] = [];

  beforeAll(async () => {
    server = createServer(app);
    sockets = attachSockets(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => {
    for (const socket of open.splice(0)) socket.disconnect();
  });
  afterAll(async () => {
    await sockets.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function connected(token: string) {
    const socket = connect(url, { path: rules.socket.path, auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
    open.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
  const emit = (socket: Socket, event: string, payload: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => socket.emit(event, payload, resolve));
  const next = <T,>(socket: Socket, event: string) => new Promise<T>((resolve) => socket.once(event, resolve));

  it("relays a participant's position to the other participant only, and tells them when sharing stops", async () => {
    const { creator, accepter, activity } = await acceptedWithChat("RIDE_REQUEST");
    const outsider = await verifiedUser();
    const [rider, passenger, stranger] = await Promise.all([
      connected(accepter.accessToken),
      connected(creator.accessToken),
      connected(outsider.accessToken),
    ]);
    const strangerSaw: unknown[] = [];
    stranger.onAny((event) => strangerSaw.push(event));

    const arrived = next<Record<string, unknown>>(passenger, "location:update");
    expect(await emit(rider, "location:share", { activityId: activity.id, lat: 23.75, lng: 90.38, accuracy: 12 })).toEqual({ ok: true });
    expect(await arrived).toMatchObject({ activityId: activity.id, userId: accepter.id, lat: 23.75, lng: 90.38, accuracy: 12 });

    // Too soon after the last one: dropped.
    expect(await emit(rider, "location:share", { activityId: activity.id, lat: 23.751, lng: 90.381 })).toEqual({ ok: true, dropped: true });

    const stopped = next<Record<string, unknown>>(passenger, "location:stopped");
    rider.emit("location:stop", { activityId: activity.id });
    expect(await stopped).toEqual({ activityId: activity.id, userId: accepter.id });

    // An outsider can neither share on the ride nor receive anything.
    const refused = await emit(stranger, "location:share", { activityId: activity.id, lat: 23.75, lng: 90.38 });
    expect((refused.error as { code: string }).code).toBe("NOT_FOUND");
    expect(strangerSaw).toEqual([]);
  });

  it("is refused once the ride is finished, and for activities that are not rides", async () => {
    const ride = await acceptedWithChat("RIDE_REQUEST");
    await prisma.activity.update({ where: { id: ride.activity.id }, data: { status: "COMPLETED" } });
    const food = await acceptedWithChat("FOOD");
    const rideSocket = await connected(ride.accepter.accessToken);
    const foodSocket = await connected(food.accepter.accessToken);

    const finished = await emit(rideSocket, "location:share", { activityId: ride.activity.id, lat: 23.75, lng: 90.38 });
    expect((finished.error as { code: string }).code).toBe("LIVE_LOCATION_NOT_AVAILABLE");
    const notRide = await emit(foodSocket, "location:share", { activityId: food.activity.id, lat: 23.75, lng: 90.38 });
    expect((notRide.error as { code: string }).code).toBe("LIVE_LOCATION_NOT_AVAILABLE");
  });
});
