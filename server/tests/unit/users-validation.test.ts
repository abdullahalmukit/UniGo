import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import {
  createAddressSchema,
  setSubAreasSchema,
  updateAddressSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from "../../src/modules/users/users.validation.js";

const uuid = (n: number) => `0190a7c4-0000-7000-8000-${String(n).padStart(12, "0")}`;

describe("A7 validation", () => {
  it("profile: trims, turns blanks into null and normalises the phone", () => {
    expect(updateProfileSchema.parse({ name: " Rina ", phone: "01712-345678", batch: " ", department: "EEE" })).toEqual({
      name: "Rina",
      phone: "+8801712345678",
      batch: null,
      department: "EEE",
    });
  });

  it("profile: refuses email, university, unknown fields and an empty change", () => {
    for (const body of [{ email: "a@b.com" }, { universityId: uuid(1) }, { photoKey: "x" }, {}]) {
      expect(updateProfileSchema.safeParse(body).success).toBe(false);
    }
    expect(updateProfileSchema.safeParse({ name: "x".repeat(rules.profile.name.maxLength + 1) }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ location: "x".repeat(rules.profile.locationMaxLength + 1) }).success).toBe(false);
  });

  it("addresses: Custom needs a name; other labels drop it", () => {
    const base = { address: "Mirpur 10", lat: 23.8, lng: 90.36 };
    expect(createAddressSchema.safeParse({ ...base, label: "CUSTOM" }).success).toBe(false);
    expect(createAddressSchema.parse({ ...base, label: "CUSTOM", customLabel: " Gym " }).customLabel).toBe("Gym");
    expect(createAddressSchema.parse({ ...base, label: "HALL", customLabel: "Ignored" }).customLabel).toBeNull();
    expect(createAddressSchema.safeParse({ ...base, label: "SCHOOL" }).success).toBe(false);
    expect(createAddressSchema.safeParse({ ...base, label: "HOME", lng: 181 }).success).toBe(false);
    expect(updateAddressSchema.safeParse({}).success).toBe(false);
  });

  it(`sub-areas: at most ${rules.subAreas.maxPerUser}, repeats removed`, () => {
    expect(setSubAreasSchema.parse({ subAreaIds: [uuid(1), uuid(1), uuid(2)] }).subAreaIds).toEqual([uuid(1), uuid(2)]);
    const tooMany = Array.from({ length: rules.subAreas.maxPerUser + 1 }, (_, i) => uuid(i));
    expect(setSubAreasSchema.safeParse({ subAreaIds: tooMany }).success).toBe(false);
  });

  it("preferences: only language, theme and the email setting", () => {
    expect(updatePreferencesSchema.parse({ theme: "SYSTEM" })).toEqual({ theme: "SYSTEM" });
    expect(updatePreferencesSchema.safeParse({ pushEnabled: true }).success).toBe(false);
  });
});
