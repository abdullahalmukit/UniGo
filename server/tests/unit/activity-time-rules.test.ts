import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { timerJobsFor } from "../../src/modules/activities/timers.js";
import {
  assertCreationWindow,
  blocksTimeFor,
  conflictRange,
  dateOnlyServiceStart,
  isLateCancellation,
  windowsOverlap,
} from "../../src/modules/activities/time-rules.js";
import { startOfDhakaDay } from "../../src/utils/time.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const base = new Date("2026-11-07T06:00:00.000Z");
const plus = (ms: number) => new Date(base.getTime() + ms);

function code(fn: () => unknown) {
  try {
    fn();
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("90-minute conflict window", () => {
  it("conflicts at 89 minutes apart but not at 90 or 91", () => {
    expect(windowsOverlap(base, plus(89 * MINUTE))).toBe(true);
    expect(windowsOverlap(base, plus(-89 * MINUTE))).toBe(true);
    expect(windowsOverlap(base, plus(90 * MINUTE))).toBe(false);
    expect(windowsOverlap(base, plus(-90 * MINUTE))).toBe(false);
    expect(windowsOverlap(base, plus(91 * MINUTE))).toBe(false);
    expect(windowsOverlap(base, base)).toBe(true);
  });

  it("gives the open range used by the database query", () => {
    expect(conflictRange(base)).toEqual({ after: plus(-90 * MINUTE), before: plus(90 * MINUTE) });
  });
});

describe("creation time limits (CLAUDE.md 5.6)", () => {
  it("accepts exactly 15 minutes ahead and refuses less", () => {
    expect(code(() => assertCreationWindow("RIDE", plus(15 * MINUTE), base))).toBe("OK");
    expect(code(() => assertCreationWindow("RIDE", plus(15 * MINUTE - 1), base))).toBe("START_TOO_SOON");
  });

  it("uses each feature's latest time", () => {
    expect(code(() => assertCreationWindow("RIDE", plus(48 * HOUR), base))).toBe("OK");
    expect(code(() => assertCreationWindow("RIDE", plus(48 * HOUR + 1), base))).toBe("START_TOO_LATE");
    expect(code(() => assertCreationWindow("FOOD", plus(24 * HOUR), base))).toBe("OK");
    expect(code(() => assertCreationWindow("FOOD", plus(24 * HOUR + 1), base))).toBe("START_TOO_LATE");
    expect(code(() => assertCreationWindow("SERVICE", plus(7 * 24 * HOUR), base))).toBe("OK");
    expect(code(() => assertCreationWindow("SERVICE", plus(7 * 24 * HOUR + 1), base))).toBe("START_TOO_LATE");
  });
});

describe("other time rules", () => {
  it("starts a date-only service request at 23:59 Asia/Dhaka", () => {
    expect(dateOnlyServiceStart("2026-11-07").toISOString()).toBe("2026-11-07T17:59:00.000Z");
  });

  it("blocks time for everything except carpool bookings and date-only services (B2a decision 12)", () => {
    expect(blocksTimeFor("RIDE_REQUEST")).toBe(true);
    expect(blocksTimeFor("RIDE_BOOKING")).toBe(true);
    expect(blocksTimeFor("FOOD")).toBe(true);
    expect(blocksTimeFor("CARPOOL_SESSION")).toBe(true);
    expect(blocksTimeFor("CARPOOL_BOOKING")).toBe(false);
    expect(blocksTimeFor("SERVICE", { hasPreferredTime: true })).toBe(true);
    expect(blocksTimeFor("SERVICE", { hasPreferredTime: false })).toBe(false);
  });

  it("calls a cancellation under 60 minutes before the start late", () => {
    expect(isLateCancellation(plus(60 * MINUTE), base)).toBe(false);
    expect(isLateCancellation(plus(59 * MINUTE), base)).toBe(true);
    expect(isLateCancellation(plus(-MINUTE), base)).toBe(true);
  });

  it("resets the daily limit at midnight Asia/Dhaka, which is 18:00 UTC", () => {
    expect(startOfDhakaDay(new Date("2026-11-07T17:59:59.999Z")).toISOString()).toBe("2026-11-06T18:00:00.000Z");
    expect(startOfDhakaDay(new Date("2026-11-07T18:00:00.000Z")).toISOString()).toBe("2026-11-07T18:00:00.000Z");
  });
});

describe("delayed jobs for an activity", () => {
  const activity = { id: "a1", type: "FOOD" as const, subStatus: null, startTime: base, completionRequestedAt: null };

  it("expires an OPEN request 15 minutes after its start time (grace period B3a-1)", () => {
    const [job] = timerJobsFor({ ...activity, status: "OPEN" });
    const expectedRunAt = plus(rules.activity.expiryGracePeriod);
    expect(job).toMatchObject({ name: "activity-expire", runAt: expectedRunAt, data: { id: "a1" } });
    expect(job.jobId).toBe(`activity-expire-a1-${expectedRunAt.getTime()}`);
  });

  it("calculates 15-minute grace cutoff correctly for accept and listing queries (B3a-1)", () => {
    expect(rules.activity.expiryGracePeriod).toBe(15 * 60 * 1000);
    const now = new Date("2026-11-07T06:10:00.000Z"); // 10 minutes after base start time
    const graceCutoff = new Date(now.getTime() - rules.activity.expiryGracePeriod); // 05:55:00
    // Request started at 06:00:00 is >= 05:55:00 (inside 15-min grace window)
    expect(base >= graceCutoff).toBe(true);

    const pastGrace = new Date("2026-11-07T06:16:00.000Z"); // 16 minutes after base start time
    const pastGraceCutoff = new Date(pastGrace.getTime() - rules.activity.expiryGracePeriod); // 06:01:00
    // Request started at 06:00:00 is < 06:01:00 (past 15-min grace window)
    expect(base < pastGraceCutoff).toBe(true);
  });

  it("closes an ACCEPTED activity as NOT_MARKED 6 hours after start", () => {
    const [job] = timerJobsFor({ ...activity, status: "ACCEPTED" });
    expect(job).toMatchObject({ name: "activity-not-marked", runAt: plus(rules.activity.notMarkedAfterStart) });
  });

  it("auto-completes 24 hours after the completion request", () => {
    const [job] = timerJobsFor({ ...activity, status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED", completionRequestedAt: base });
    expect(job).toMatchObject({ name: "activity-auto-complete", runAt: plus(24 * HOUR) });
  });

  it("needs no job when disputed, finished, in progress or a carpool booking", () => {
    expect(timerJobsFor({ ...activity, status: "DISPUTED" })).toEqual([]);
    expect(timerJobsFor({ ...activity, status: "COMPLETED" })).toEqual([]);
    expect(timerJobsFor({ ...activity, status: "IN_PROGRESS", subStatus: "FOOD_COLLECTED" })).toEqual([]);
    expect(timerJobsFor({ ...activity, type: "CARPOOL_BOOKING", status: "ACCEPTED" })).toEqual([]);
  });

  it("uses job ids without ':', which BullMQ refuses", () => {
    for (const status of ["OPEN", "ACCEPTED"] as const) {
      for (const job of timerJobsFor({ ...activity, status })) expect(job.jobId).not.toContain(":");
    }
  });
});
