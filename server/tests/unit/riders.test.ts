import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { activeBlocker, licenceExpired, riderSuspensionInForce } from "../../src/modules/riders/rider-status.js";
import { applicationDataSchema, vehicleSchema } from "../../src/modules/riders/riders.validation.js";
import { toPublicVehicle } from "../../src/modules/vehicles/vehicles.js";
import { maskRegistrationNumber } from "../../src/utils/registration-number.js";
import { dhakaDateString } from "../../src/utils/time.js";

const bike = { type: "BIKE", brand: "Honda", model: "CB Hornet", colour: "Red", registrationNumber: "Dhaka Metro-HA 12-3456", seatCapacity: 1 };
const car = { ...bike, type: "CAR", brand: "Toyota", model: "Axio", registrationNumber: "Dhaka Metro-GA 11-2233", seatCapacity: 4 };
const today = () => "2026-11-04";

describe("maskRegistrationNumber", () => {
  it.each([
    ["Dhaka Metro-LA 12-1234", "Dhaka Metro-LA 12-••34"],
    ["Dhaka Metro-LA 12-3456", "Dhaka Metro-LA 12-••56"],
    ["DHAKA METRO GA 112233", "DHAKA METRO GA ••••33"],
    ["ঢাকা মেট্রো-ল ১২-৩৪৫৬", "ঢাকা মেট্রো-ল ১২-••৫৬"],
    ["CTG-12", "CTG-•2"],
    ["NO DIGITS", "NO DIGITS"],
  ])("%s -> %s", (input, masked) => {
    expect(maskRegistrationNumber(input)).toBe(masked);
  });

  it("is used for every vehicle students see", () => {
    expect(toPublicVehicle({ id: "v", ...car, type: "CAR" })).toEqual({
      id: "v",
      type: "CAR",
      brand: "Toyota",
      model: "Axio",
      colour: "Red",
      seatCapacity: 4,
      registrationNumber: "Dhaka Metro-GA 11-••33",
    });
  });
});

describe("vehicle rules", () => {
  it("allows BIKE = 1 and CAR = 1-4 passenger seats", () => {
    expect(vehicleSchema.safeParse(bike).success).toBe(true);
    expect(vehicleSchema.safeParse({ ...bike, seatCapacity: 2 }).success).toBe(false);
    for (const seats of [1, 4]) expect(vehicleSchema.safeParse({ ...car, seatCapacity: seats }).success).toBe(true);
    for (const seats of [0, 5]) expect(vehicleSchema.safeParse({ ...car, seatCapacity: seats }).success).toBe(false);
  });

  it("needs a registration number with digits", () => {
    expect(vehicleSchema.safeParse({ ...bike, registrationNumber: "ABCDEF" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...bike, registrationNumber: "12" }).success).toBe(false);
  });

  it("refuses the same vehicle twice in one application, however it is typed", () => {
    const result = applicationDataSchema(today).safeParse({
      licenceExpiresOn: "2030-01-01",
      vehicles: [bike, { ...bike, registrationNumber: "dhaka metro ha 123456" }],
    });
    expect(result.success).toBe(false);
  });

  it(`allows at most ${rules.rider.maxVehiclesPerApplication} vehicles`, () => {
    const vehicles = Array.from({ length: rules.rider.maxVehiclesPerApplication + 1 }, (_, i) => ({
      ...car,
      registrationNumber: `Dhaka Metro-GA 11-00${i}0`,
    }));
    expect(applicationDataSchema(today).safeParse({ licenceExpiresOn: "2030-01-01", vehicles }).success).toBe(false);
  });
});

describe("licence expiry", () => {
  const parse = (licenceExpiresOn: string) => applicationDataSchema(today).safeParse({ licenceExpiresOn, vehicles: [bike] }).success;

  it(`must be after today and at most ${rules.rider.licenceMaxYearsAhead} years ahead`, () => {
    expect(parse("2026-11-04")).toBe(false);
    expect(parse("2026-11-05")).toBe(true);
    expect(parse("2036-11-04")).toBe(true);
    expect(parse("2036-11-05")).toBe(false);
    expect(parse("2027-02-30")).toBe(false);
    expect(parse("05/11/2027")).toBe(false);
  });

  it("is valid through its whole day in Asia/Dhaka", () => {
    // 23:30 on 4 November in Dhaka is 17:30 UTC
    expect(licenceExpired("2026-11-04", new Date("2026-11-04T17:30:00Z"))).toBe(false);
    // 00:30 on 5 November in Dhaka is 18:30 UTC on 4 November
    expect(licenceExpired("2026-11-04", new Date("2026-11-04T18:30:00Z"))).toBe(true);
    expect(licenceExpired(null)).toBe(true);
    expect(dhakaDateString(new Date("2026-11-04T18:30:00Z"))).toBe("2026-11-05");
  });
});

describe("Active switch", () => {
  const rider = {
    isVerifiedRider: true,
    studentVerificationStatus: "VERIFIED",
    accountStatus: "ACTIVE",
    riderSuspended: false,
    riderSuspendedUntil: null as Date | null,
  };
  const now = new Date("2026-11-04T06:00:00Z");

  it("is allowed for a verified rider with a valid licence", () => {
    expect(activeBlocker(rider, "2027-01-01", now)).toBeNull();
  });

  it("names what blocks it", () => {
    expect(activeBlocker({ ...rider, isVerifiedRider: false }, "2027-01-01", now)).toBe("NOT_A_RIDER");
    expect(activeBlocker({ ...rider, studentVerificationStatus: "PENDING" }, "2027-01-01", now)).toBe("NOT_VERIFIED");
    expect(activeBlocker({ ...rider, accountStatus: "RESTRICTED" }, "2027-01-01", now)).toBe("ACCOUNT_RESTRICTED");
    expect(activeBlocker({ ...rider, riderSuspended: true }, "2027-01-01", now)).toBe("RIDER_SUSPENDED");
    expect(activeBlocker(rider, "2026-11-03", now)).toBe("LICENCE_EXPIRED");
  });

  it("treats a suspension past its end date as over", () => {
    expect(riderSuspensionInForce({ riderSuspended: true, riderSuspendedUntil: new Date("2026-11-04T05:00:00Z") }, now)).toBe(false);
    expect(riderSuspensionInForce({ riderSuspended: true, riderSuspendedUntil: null }, now)).toBe(true);
  });
});
