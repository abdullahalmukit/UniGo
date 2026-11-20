import { describe, expect, it } from "vitest";
import { suggestServiceCategory } from "../../src/modules/matching/category-hint.js";
import { closeness, minuteGap, sameDirection, scoreMatch } from "../../src/modules/matching/score.js";

const campus = { lat: 23.8103, lng: 90.4125 };
const farmgate = { lat: 23.7576, lng: 90.3899 };
const at = (iso: string) => new Date(iso);

describe("matching score parts (B9, proposal 20)", () => {
  it("closeness falls linearly to 0 at 5 km", () => {
    expect(closeness(0)).toBe(1);
    expect(closeness(2.5)).toBe(0.5);
    expect(closeness(7)).toBe(0);
  });

  it("same direction is 1, opposite is 0, right angles 0.5", () => {
    expect(sameDirection({ from: campus, to: farmgate }, { from: campus, to: farmgate })).toBeCloseTo(1);
    expect(sameDirection({ from: campus, to: farmgate }, { from: farmgate, to: campus })).toBeCloseTo(0);
    const east = { lat: campus.lat, lng: campus.lng + 0.05 };
    const north = { lat: campus.lat + 0.05, lng: campus.lng };
    expect(sameDirection({ from: campus, to: east }, { from: campus, to: north })).toBeCloseTo(0.5, 1);
    expect(sameDirection({ from: campus, to: campus }, { from: campus, to: farmgate })).toBeNull();
  });

  it("measures carpool minutes across midnight", () => {
    expect(minuteGap(23 * 60 + 50, 10)).toBe(20);
    expect(minuteGap(480, 540)).toBe(60);
  });
});

describe("scoreMatch", () => {
  const context = { pickup: campus, destination: farmgate, time: at("2026-11-21T02:00:00Z") };

  it("ranks a near, same-way, on-time match above a far or late one, and explains why", () => {
    const good = scoreMatch(context, { pickup: campus, destination: farmgate, time: at("2026-11-21T02:10:00Z"), rating: 4.8, completionRate: 0.95 });
    const far = scoreMatch(context, { pickup: { lat: 23.85, lng: 90.45 }, destination: farmgate, time: at("2026-11-21T02:10:00Z") });
    const late = scoreMatch(context, { pickup: campus, destination: farmgate, time: at("2026-11-21T05:00:00Z") });
    expect(good.score).toBeGreaterThan(far.score);
    expect(good.score).toBeGreaterThan(late.score);
    expect(good.score).toBeLessThanOrEqual(1);
    expect(good.reasons.map((r) => r.code)).toEqual(["PICKUP_NEAR", "DESTINATION_NEAR", "TIME_CLOSE"]);
    expect(late.parts.time).toBe(0);
  });

  it("treats people without a rating or rate yet as neutral, not bad", () => {
    const fresh = scoreMatch({ pickup: campus }, { pickup: campus });
    expect(fresh.parts.rating).toBe(0.5);
    expect(fresh.parts.completion).toBe(0.5);
    const poor = scoreMatch({ pickup: campus }, { pickup: campus, rating: 1, completionRate: 0.2 });
    expect(poor.score).toBeLessThan(fresh.score);
  });

  it("leaves out parts without data", () => {
    const onlyPickup = scoreMatch({ pickup: campus }, { pickup: campus, destination: farmgate });
    expect(onlyPickup.parts).not.toHaveProperty("destination");
    expect(onlyPickup.parts).not.toHaveProperty("route");
    expect(onlyPickup.parts).not.toHaveProperty("time");
  });

  it("uses minutes of the day for carpool", () => {
    const close = scoreMatch({ pickup: campus, minuteOfDay: 8 * 60 }, { pickup: campus, minuteOfDay: 8 * 60 + 15 });
    expect(close.parts.time).toBeCloseTo(1 - 15 / 90, 3);
  });
});

describe("service category hint", () => {
  it("suggests a category from English or Bangla text", () => {
    expect(suggestServiceCategory("Please buy a notebook and some groceries from the market")?.code).toBe("SHOPPING_PURCHASING");
    expect(suggestServiceCategory("ফার্মেসি থেকে ওষুধ এনে দিন, প্রেসক্রিপশন আছে")?.code).toBe("PHARMACY_HEALTHCARE");
    expect(suggestServiceCategory("Print and photocopy my assignment, then submit it")?.code).toBe("DOCUMENT_ACADEMIC");
    expect(suggestServiceCategory("Take my laptop to the service center for repair")?.code).toBe("WARRANTY_REPAIR");
    expect(suggestServiceCategory("Pay my tuition fee at the bank")?.code).toBe("FINANCIAL_ADMINISTRATIVE");
    expect(suggestServiceCategory("Pick up a parcel from the courier office")?.code).toBe("PARCEL_DELIVERY");
  });

  it("gives no hint for unrelated text", () => {
    expect(suggestServiceCategory("hello there friend")).toBeNull();
  });
});
