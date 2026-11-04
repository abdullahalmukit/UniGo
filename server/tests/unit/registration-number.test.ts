import { describe, expect, it } from "vitest";
import { normalizeRegistrationNumber } from "../../src/utils/registration-number.js";

describe("normalizeRegistrationNumber", () => {
  it("ignores case, spaces, hyphens and dots", () => {
    const expected = "DHAKAMETROLA123456";

    expect(normalizeRegistrationNumber("Dhaka Metro-LA 12-3456")).toBe(expected);
    expect(normalizeRegistrationNumber("dhaka metro la 123456")).toBe(expected);
    expect(normalizeRegistrationNumber("  DHAKA.METRO-LA.12.3456 ")).toBe(expected);
  });

  it("treats Bangla and English digits as the same", () => {
    expect(normalizeRegistrationNumber("ঢাকা মেট্রো-ল ১২-৩৪৫৬")).toBe(
      normalizeRegistrationNumber("ঢাকা মেট্রো-ল 12-3456"),
    );
  });

  it("keeps Bangla letters and vowel signs", () => {
    expect(normalizeRegistrationNumber("ঢাকা মেট্রো-ল ১২-৩৪৫৬")).toBe("ঢাকামেট্রোল123456");
  });
});
