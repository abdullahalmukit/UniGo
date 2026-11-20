import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "../../src/config/env.js";
import { parseBarikoiPlaces, parseBarikoiReverse, parseOsrmRoute } from "../../src/modules/geo/geo.service.js";
import { createLiveLocationGate } from "../../src/modules/geo/live-location.js";

const base = {
  DATABASE_URL: "mysql://user:pass@localhost:3306/unigo",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  FILE_SIGNING_SECRET: "c".repeat(32),
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
};

describe("map provider", () => {
  it("uses Barikoi when a key is set, OpenStreetMap otherwise, and OSM in tests unless forced", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development" }).data?.mapProvider).toBe("osm");
    expect(parseEnv({ ...base, NODE_ENV: "development", BARIKOI_API_KEY: "bkoi_x" }).data?.mapProvider).toBe("barikoi");
    expect(parseEnv({ ...base, NODE_ENV: "test", BARIKOI_API_KEY: "bkoi_x" }).data?.mapProvider).toBe("osm");
    expect(parseEnv({ ...base, NODE_ENV: "development", BARIKOI_API_KEY: "bkoi_x", MAP_PROVIDER: "osm" }).data?.mapProvider).toBe("osm");
  });

  it("refuses MAP_PROVIDER=barikoi without a key", () => {
    const result = parseEnv({ ...base, NODE_ENV: "development", MAP_PROVIDER: "barikoi" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain("BARIKOI_API_KEY");
  });
});

describe("Barikoi answers", () => {
  const places = {
    places: [
      { address: "Dhanmondi, Dhaka", address_bn: "ধানমন্ডি, ঢাকা", latitude: "23.7459", longitude: "90.3754" },
      { address: "Dhanmondi Thana", address_bn: null, latitude: "23.7467", longitude: "90.3743" },
      { address: "", latitude: "1", longitude: "2" },
      { address: "No point", latitude: "x", longitude: "90" },
    ],
  };

  it("reads places in the user's language, falling back to English, and skips broken ones", () => {
    expect(parseBarikoiPlaces(places, "en")).toEqual([
      { label: "Dhanmondi, Dhaka", lat: 23.7459, lng: 90.3754 },
      { label: "Dhanmondi Thana", lat: 23.7467, lng: 90.3743 },
    ]);
    expect(parseBarikoiPlaces(places, "bn").map((place) => place.label)).toEqual(["ধানমন্ডি, ঢাকা", "Dhanmondi Thana"]);
    expect(parseBarikoiPlaces({ message: "Address not found", status: 200 }, "en")).toEqual([]);
  });

  it("reads a reverse-geocoded address", () => {
    const body = { place: { address: "Road 9/A, Dhanmondi, Dhaka", address_bn: "রোড ৯/এ, ধানমন্ডি, ঢাকা" }, status: 200 };
    expect(parseBarikoiReverse(body, "en")).toBe("Road 9/A, Dhanmondi, Dhaka");
    expect(parseBarikoiReverse(body, "bn")).toBe("রোড ৯/এ, ধানমন্ডি, ঢাকা");
    expect(parseBarikoiReverse({ status: 200 }, "en")).toBeNull();
  });

  it("reads a route (Barikoi and OSRM share the shape)", () => {
    const body = {
      code: "Ok",
      routes: [{ distance: 8421.6, duration: 1240.2, geometry: { coordinates: [[90.37, 23.74], [90.41, 23.81], ["bad"]] } }],
    };
    expect(parseOsrmRoute(body)).toEqual({ distanceMeters: 8422, durationSeconds: 1240, coordinates: [[90.37, 23.74], [90.41, 23.81]] });
    expect(parseOsrmRoute({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseOsrmRoute({ code: "Ok", routes: [{ distance: 500 }] })).toEqual({ distanceMeters: 500, durationSeconds: 0, coordinates: [] });
  });
});

describe("live location gate", () => {
  it("drops updates closer together than the minimum interval, per activity", () => {
    let now = 10_000;
    const gate = createLiveLocationGate("user-1", () => now);
    expect(gate.take("a")).toBe(true);
    now += 1000;
    expect(gate.take("a")).toBe(false);
    expect(gate.take("b")).toBe(true);
    now += 1500;
    expect(gate.take("a")).toBe(true);
    gate.forget("a");
    expect(gate.take("a")).toBe(true);
    vi.restoreAllMocks();
  });
});
