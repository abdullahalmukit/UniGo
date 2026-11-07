import { describe, expect, it } from "vitest";
import { reminderTimeFor, timerJobsFor } from "../../src/modules/activities/timers.js";
import { dhakaWallTime } from "../../src/utils/time.js";

const MINUTE = 60 * 1000;
const now = new Date("2026-11-07T06:00:00.000Z");
const at = (ms: number) => new Date(now.getTime() + ms);
const accepted = (type: "FOOD" | "SERVICE" | "RIDE_REQUEST" | "CARPOOL_SESSION", startTime: Date, blocksTime = true) => ({
  id: "a1",
  type,
  status: "ACCEPTED" as const,
  subStatus: null,
  startTime,
  completionRequestedAt: null,
  blocksTime,
});

describe("30-minute reminder (proposal section 14)", () => {
  it("is queued 30 minutes before the start of an accepted ride, food or service request", () => {
    const start = at(120 * MINUTE);
    const reminder = timerJobsFor(accepted("FOOD", start), now).find((job) => job.name === "activity-reminder");
    expect(reminder).toMatchObject({ runAt: at(90 * MINUTE), jobId: `activity-reminder-a1-${at(90 * MINUTE).getTime()}` });
    expect(timerJobsFor(accepted("RIDE_REQUEST", start), now).some((job) => job.name === "activity-reminder")).toBe(true);
  });

  it("is not queued when the activity is accepted less than 30 minutes before its start", () => {
    expect(timerJobsFor(accepted("FOOD", at(20 * MINUTE)), now).some((job) => job.name === "activity-reminder")).toBe(false);
  });

  it("is not queued for a service request without a time, or for an item that is not ACCEPTED", () => {
    expect(reminderTimeFor({ type: "SERVICE", startTime: at(120 * MINUTE), blocksTime: false })).toBeNull();
    const open = { ...accepted("FOOD", at(120 * MINUTE)), status: "OPEN" as const };
    expect(timerJobsFor(open, now).some((job) => job.name === "activity-reminder")).toBe(false);
  });
});

describe("carpool ride-day reminder (B2c decision)", () => {
  it("is at 07:00 Asia/Dhaka on the ride day", () => {
    const start = dhakaWallTime("2026-11-08", 9, 30);
    expect(reminderTimeFor({ type: "CARPOOL_SESSION", startTime: start })).toEqual(dhakaWallTime("2026-11-08", 7, 0));
  });

  it("is 60 minutes before the start when the ride starts before 08:00", () => {
    const start = dhakaWallTime("2026-11-08", 7, 30);
    expect(reminderTimeFor({ type: "CARPOOL_SESSION", startTime: start })).toEqual(dhakaWallTime("2026-11-08", 6, 30));
  });

  it("replaces the 30-minute reminder for carpool sessions", () => {
    const jobs = timerJobsFor(accepted("CARPOOL_SESSION", dhakaWallTime("2026-11-08", 9, 0)), now);
    expect(jobs.map((job) => job.name)).toContain("carpool-session-reminder");
    expect(jobs.map((job) => job.name)).not.toContain("activity-reminder");
  });
});
