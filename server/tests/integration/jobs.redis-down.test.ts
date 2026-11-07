import { afterEach, describe, expect, it, vi } from "vitest";
import { rules } from "../../src/config/rules.js";
import { runActivitySweep } from "../../src/jobs/activity-timers.job.js";
import { resetSchedulerForTests, useBullmqSchedulerForTests } from "../../src/jobs/scheduler.js";
import { createActivity, fromNow, HOUR, MINUTE, storedActivity, verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";

// Nothing listens on this port, so every Redis call fails.
const UNREACHABLE_REDIS = "redis://127.0.0.1:6390";

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSchedulerForTests();
});

describe("Redis down while jobs are queued after a commit (B2b decision 1)", () => {
  it("still answers the request, logs the problem, and the sweeper catches up later", async () => {
    await useBullmqSchedulerForTests(UNREACHABLE_REDIS);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [passenger, rider] = await Promise.all([verifiedUser(), verifiedUser()]);
    const ride = await createActivity({
      type: "RIDE_REQUEST",
      creatorId: passenger.id,
      accepterId: rider.id,
      status: "ACCEPTED",
      subStatus: "RIDE_CONFIRMED",
      // Start Ride is allowed from 30 minutes before the start (B3a Q4)
      startTime: fromNow(20 * MINUTE),
    });

    // The first call may wait for the connection to fail, but never longer than the timeout.
    let started = Date.now();
    const start = await api().post(`/api/activities/${ride.id}/start`).set(bearer(passenger.accessToken));
    expect(start.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(rules.jobs.queueTimeout + 1500);

    // Once Redis is known to be down, queue calls are skipped at once.
    started = Date.now();
    const completion = await api().post(`/api/activities/${ride.id}/request-completion`).set(bearer(passenger.accessToken));
    expect(completion.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);

    expect((await storedActivity(ride.id)).subStatus).toBe("COMPLETION_REQUESTED");
    const logged = errors.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes("sweeper"))).toBe(true);

    // The work a lost job would have done is done by the sweeper (no Redis needed).
    const overdue = await createActivity({ creatorId: passenger.id, startTime: fromNow(-MINUTE) });
    expect((await runActivitySweep()).expired).toBe(1);
    expect((await storedActivity(overdue.id)).status).toBe("EXPIRED");
    expect((await storedActivity(ride.id)).status).toBe("IN_PROGRESS");
  });

  it("does not fail an accept either", async () => {
    await useBullmqSchedulerForTests(UNREACHABLE_REDIS);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const item = await createActivity({ creatorId: creator.id, startTime: fromNow(2 * HOUR) });

    const { acceptActivity } = await import("../../src/modules/activities/engine.js");
    await expect(acceptActivity(item.id, accepter.id)).resolves.toMatchObject({ status: "ACCEPTED" });
  });
});
