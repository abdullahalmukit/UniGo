import { describe, expect, it } from "vitest";
import { actionSchemas } from "../../src/modules/admin/moderation.service.js";
import { accountStatusEmail } from "../../src/modules/email/account-status-templates.js";
import { formatDhakaDateTime, startOfDhakaDay } from "../../src/utils/time.js";

describe("startOfDhakaDay", () => {
  it("is midnight in Asia/Dhaka (18:00 UTC the day before)", () => {
    expect(startOfDhakaDay(new Date("2026-11-04T05:00:00Z")).toISOString()).toBe("2026-11-03T18:00:00.000Z");
    // 23:30 UTC is already 05:30 the next day in Dhaka.
    expect(startOfDhakaDay(new Date("2026-11-04T23:30:00Z")).toISOString()).toBe("2026-11-04T18:00:00.000Z");
    expect(startOfDhakaDay(new Date("2026-11-04T18:00:00Z")).toISOString()).toBe("2026-11-04T18:00:00.000Z");
  });

  it("formats dates in Asia/Dhaka", () => {
    expect(formatDhakaDateTime(new Date("2026-11-04T18:30:00Z"), "EN")).toContain("5 November 2026");
  });
});

describe("account action input", () => {
  it("needs a reason of 3-500 characters for every action", () => {
    for (const schema of Object.values(actionSchemas)) {
      expect(schema.safeParse({ reason: "  " }).success).toBe(false);
      expect(schema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    }
    expect(actionSchemas.warn.parse({ reason: " Spam " }).reason).toBe("Spam");
  });

  it("needs an end date to suspend; restriction end is optional", () => {
    expect(actionSchemas.suspend.safeParse({ reason: "Abuse" }).success).toBe(false);
    expect(actionSchemas.suspend.parse({ reason: "Abuse", endsAt: "2026-11-10T00:00:00Z" }).endsAt).toBeInstanceOf(Date);
    expect(actionSchemas.restrict.safeParse({ reason: "Abuse" }).success).toBe(true);
    expect(actionSchemas.restrict.safeParse({ reason: "Abuse", endsAt: "not a date" }).success).toBe(false);
  });
});

describe("account status emails", () => {
  const startsAt = new Date("2026-11-05T04:00:00Z");
  const endsAt = new Date("2026-11-12T04:00:00Z");

  it("give the reason and the suspension dates in Asia/Dhaka", () => {
    const email = accountStatusEmail("EN", "SUSPEND", { name: "Rahim", reason: "Repeated no-shows", startsAt, endsAt });
    expect(email.subject).toBe("Your UniGo account is suspended");
    expect(email.text).toContain("5 November 2026");
    expect(email.text).toContain("12 November 2026");
    expect(email.text).toContain("Reason: Repeated no-shows");
  });

  it("say a restriction without an end lasts until an admin lifts it", () => {
    expect(accountStatusEmail("EN", "RESTRICT", { name: "Rahim", reason: "Spam" }).text).toContain(
      "until an admin lifts the restriction",
    );
  });

  it("are written in Bangla with the reason escaped in HTML", () => {
    const email = accountStatusEmail("BN", "BAN", { name: "Rahim", reason: "<i>x</i>" });
    expect(email.subject).toBe("আপনার UniGo অ্যাকাউন্ট নিষিদ্ধ করা হয়েছে");
    expect(email.html).toContain("&lt;i&gt;x&lt;/i&gt;");
    expect(email.html).toContain('lang="bn"');
  });

  it("exist for every kind in both languages", () => {
    for (const kind of ["WARN", "RESTRICT", "SUSPEND", "BAN", "UNBAN", "REACTIVATE", "SUSPENSION_ENDED", "RESTRICTION_ENDED"] as const) {
      for (const language of ["EN", "BN"] as const) {
        expect(accountStatusEmail(language, kind, { name: "R", startsAt, endsAt }).subject).not.toBe("");
      }
    }
  });
});
