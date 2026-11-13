import { describe, expect, it } from "vitest";
import { allRequestsQuery } from "../../src/modules/all-requests/all-requests.validation.js";

describe("All Requests query validation", () => {
  it("defaults to feature=all and page=1, limit=15", () => {
    const parsed = allRequestsQuery.parse({});
    expect(parsed.feature).toBe("all");
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(15);
  });

  it("accepts valid features", () => {
    for (const feature of ["all", "ride", "food", "carpool", "service"] as const) {
      expect(allRequestsQuery.parse({ feature }).feature).toBe(feature);
    }
  });

  it("rejects unknown features", () => {
    expect(() => allRequestsQuery.parse({ feature: "unknown" })).toThrow();
  });

  it("validates date format YYYY-MM-DD", () => {
    expect(allRequestsQuery.parse({ date: "2026-11-10" }).date).toBe("2026-11-10");
    expect(() => allRequestsQuery.parse({ date: "invalid-date" })).toThrow();
  });
});

