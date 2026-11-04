import { describe, expect, it } from "vitest";
import { assertCanAccess, effectiveAccountStatus } from "../../src/modules/auth/account-status.js";

const NOW = new Date("2026-11-03T10:00:00Z");
const before = new Date("2026-11-03T09:59:59Z");
const after = new Date("2026-11-03T10:00:01Z");

describe("effectiveAccountStatus", () => {
  it("treats a suspension whose end has passed (or is now) as ACTIVE", () => {
    expect(effectiveAccountStatus({ accountStatus: "SUSPENDED", suspendedUntil: before }, NOW)).toBe("ACTIVE");
    expect(effectiveAccountStatus({ accountStatus: "SUSPENDED", suspendedUntil: NOW }, NOW)).toBe("ACTIVE");
  });

  it("keeps a suspension that has not ended, or has no end date", () => {
    expect(effectiveAccountStatus({ accountStatus: "SUSPENDED", suspendedUntil: after }, NOW)).toBe("SUSPENDED");
    expect(effectiveAccountStatus({ accountStatus: "SUSPENDED", suspendedUntil: null }, NOW)).toBe("SUSPENDED");
  });

  it.each(["ACTIVE", "RESTRICTED", "BANNED"] as const)("leaves %s unchanged", (status) => {
    expect(effectiveAccountStatus({ accountStatus: status, suspendedUntil: before }, NOW)).toBe(status);
  });
});

describe("assertCanAccess", () => {
  it("lets ACTIVE and RESTRICTED accounts in", () => {
    expect(() => assertCanAccess("ACTIVE")).not.toThrow();
    expect(() => assertCanAccess("RESTRICTED")).not.toThrow();
  });

  it("refuses SUSPENDED and BANNED accounts", () => {
    expect(() => assertCanAccess("SUSPENDED")).toThrow(expect.objectContaining({ code: "ACCOUNT_SUSPENDED" }));
    expect(() => assertCanAccess("BANNED")).toThrow(expect.objectContaining({ code: "ACCOUNT_BANNED" }));
  });
});
