import { describe, expect, it } from "vitest";
import { createSpacedQueue, createTtlCache } from "../../src/lib/ttl-cache.js";
import { boundingBox, distanceKm } from "../../src/modules/geo/distance.js";
import { suggestedAmount } from "../../src/modules/ride/fare.service.js";

describe("distance for the radius search (B3a Q6)", () => {
  const campus = { lat: 23.8103, lng: 90.4125 };

  it("measures straight-line km", () => {
    expect(distanceKm(campus, campus)).toBe(0);
    expect(distanceKm(campus, { lat: 23.7576, lng: 90.3899 })).toBeCloseTo(6.3, 1);
    expect(distanceKm(campus, { lat: 23.8238, lng: 90.4125 })).toBeCloseTo(1.5, 1);
  });

  it("puts every point within the radius inside the box", () => {
    const box = boundingBox(campus, 2);
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const rad = (bearing * Math.PI) / 180;
      const point = { lat: campus.lat + (1.99 / 111.2) * Math.cos(rad), lng: campus.lng + (1.99 / (111.2 * Math.cos((campus.lat * Math.PI) / 180))) * Math.sin(rad) };
      expect(distanceKm(campus, point)).toBeLessThan(2);
      expect(point.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(point.lat).toBeLessThanOrEqual(box.maxLat);
      expect(point.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(point.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });
});

describe("suggested fare (proposal 8.2)", () => {
  it("is distance x rate in whole taka, inside the 10-1000 range", () => {
    expect(suggestedAmount(7.48, 12.5)).toBe(94);
    expect(suggestedAmount(0.3, 12)).toBe(10);
    expect(suggestedAmount(400, 12)).toBe(1000);
  });
});

describe("cache and spaced queue", () => {
  it("expires entries and drops the oldest at the cap", () => {
    let clock = 0;
    const cache = createTtlCache<number>(2, 100, () => clock);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    clock = 150;
    expect(cache.get("c")).toBeUndefined();
  });

  it("runs tasks one after another, at least the interval apart, and goes on after a failure", async () => {
    let clock = 0;
    const queue = createSpacedQueue(1000, () => clock, async (ms) => {
      clock += ms;
    });
    const at: number[] = [];
    const results = await Promise.allSettled([
      queue.run(async () => at.push(clock)),
      queue.run(async () => {
        at.push(clock);
        throw new Error("busy");
      }),
      queue.run(async () => at.push(clock)),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(at).toEqual([0, 1000, 2000]);
  });
});
