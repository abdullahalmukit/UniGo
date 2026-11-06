import { describe, expect, it } from "vitest";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { prisma } from "../../src/lib/prisma.js";
import { assertNoTimeConflict } from "../../src/modules/activities/conflict.js";
import { acceptActivity } from "../../src/modules/activities/engine.js";
import { lockUsers, runActivityTransaction } from "../../src/modules/activities/transaction.js";
import { HOUR, MINUTE, createActivity, fromNow, historyOf, outcomeCode, storedActivity, verifiedUser } from "./activity-helpers.js";

const ROUNDS = 5;

describe("atomic accept (CLAUDE.md 5.7)", () => {
  it("lets only one of two users who accept the same item at the same moment succeed", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const [creator, first, second] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
      const item = await createActivity({ creatorId: creator.id });

      const results = await Promise.all([outcomeCode(acceptActivity(item.id, first.id)), outcomeCode(acceptActivity(item.id, second.id))]);

      expect(results.sort()).toEqual(["ALREADY_TAKEN", "OK"]);
      const stored = await storedActivity(item.id);
      expect(stored.status).toBe("ACCEPTED");
      expect([first.id, second.id]).toContain(stored.accepterId);
      expect(await historyOf(item.id)).toHaveLength(1);
    }
  });

  it("accepts, records the history and replaces the expiry job with the NOT_MARKED job", async () => {
    const [passenger, rider] = await Promise.all([verifiedUser(), verifiedUser()]);
    const start = fromNow(2 * HOUR);
    const ride = await createActivity({ type: "RIDE_REQUEST", creatorId: passenger.id, startTime: start });
    scheduledJobs.set(`activity-expire-${ride.id}-${start.getTime()}`, {
      name: "activity-expire",
      jobId: `activity-expire-${ride.id}-${start.getTime()}`,
      runAt: start,
      data: { id: ride.id },
    });

    await acceptActivity(ride.id, rider.id);

    expect(await storedActivity(ride.id)).toMatchObject({ status: "ACCEPTED", subStatus: "RIDE_CONFIRMED", accepterId: rider.id });
    expect(await historyOf(ride.id)).toMatchObject([
      { fromStatus: "OPEN", toStatus: "ACCEPTED", toSubStatus: "RIDE_CONFIRMED", actorType: "USER", actorId: rider.id },
    ]);
    expect([...scheduledJobs.values()].map((job) => job.name)).toEqual(["activity-not-marked"]);
    expect([...scheduledJobs.values()][0].runAt).toEqual(new Date(start.getTime() + 6 * HOUR));
  });

  it("refuses an item whose start time has passed, without waiting for the expiry job", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const started = await createActivity({ creatorId: creator.id, startTime: fromNow(-MINUTE) });
    const now = await createActivity({ creatorId: creator.id, startTime: fromNow(HOUR) });

    expect(await outcomeCode(acceptActivity(started.id, accepter.id))).toBe("START_TIME_PASSED");
    expect(await outcomeCode(acceptActivity(now.id, accepter.id, { now: now.startTime }))).toBe("START_TIME_PASSED");
    expect((await storedActivity(started.id)).status).toBe("OPEN");
  });

  it("refuses your own item, a blocked user and a restricted account", async () => {
    const [creator, blocked, restricted] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    const item = await createActivity({ creatorId: creator.id });
    await prisma.block.create({ data: { blockerId: creator.id, blockedId: blocked.id } });
    await prisma.user.update({ where: { id: restricted.id }, data: { accountStatus: "RESTRICTED" } });

    expect(await outcomeCode(acceptActivity(item.id, creator.id))).toBe("OWN_ITEM");
    expect(await outcomeCode(acceptActivity(item.id, blocked.id))).toBe("NOT_AVAILABLE");
    expect(await outcomeCode(acceptActivity(item.id, restricted.id))).toBe("ACCOUNT_RESTRICTED");
    expect((await storedActivity(item.id)).status).toBe("OPEN");
  });

  it("refuses a carpool booking, which is not accepted this way", async () => {
    const [rider, passenger, other] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    const booking = await createActivity({ type: "CARPOOL_BOOKING", creatorId: rider.id, accepterId: passenger.id, blocksTime: false });
    expect(await outcomeCode(acceptActivity(booking.id, other.id))).toBe("INVALID_TRANSITION");
  });
});

describe("global 90-minute conflict check (CLAUDE.md 5.5)", () => {
  it("lets only one of two overlapping accepts by the same user at the same moment succeed", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const [creatorA, creatorB, rider] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
      const start = fromNow(3 * HOUR);
      const a = await createActivity({ type: "RIDE_REQUEST", creatorId: creatorA.id, startTime: start });
      const b = await createActivity({ type: "RIDE_REQUEST", creatorId: creatorB.id, startTime: fromNow(30 * MINUTE, start) });

      const results = await Promise.all([outcomeCode(acceptActivity(a.id, rider.id)), outcomeCode(acceptActivity(b.id, rider.id))]);

      expect(results.sort()).toEqual(["OK", "TIME_CONFLICT"]);
      const statuses = [(await storedActivity(a.id)).status, (await storedActivity(b.id)).status].sort();
      expect(statuses).toEqual(["ACCEPTED", "OPEN"]);
    }
  });

  it("also protects the creator: two overlapping requests of one user accepted by two riders at once", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const [passenger, riderA, riderB] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
      const start = fromNow(3 * HOUR);
      const a = await createActivity({ type: "RIDE_REQUEST", creatorId: passenger.id, startTime: start });
      const b = await createActivity({ type: "RIDE_REQUEST", creatorId: passenger.id, startTime: fromNow(MINUTE, start) });

      const results = await Promise.all([outcomeCode(acceptActivity(a.id, riderA.id)), outcomeCode(acceptActivity(b.id, riderB.id))]);

      expect(results.sort()).toEqual(["OK", "TIME_CONFLICT"]);
    }
  });

  it("conflicts at 89 minutes apart and not at 90", async () => {
    const [creator, accepter, other] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    const start = fromNow(4 * HOUR);
    await createActivity({ creatorId: other.id, accepterId: accepter.id, status: "ACCEPTED", startTime: start });
    const at89 = await createActivity({ creatorId: creator.id, startTime: fromNow(89 * MINUTE, start) });
    const at90 = await createActivity({ creatorId: creator.id, startTime: fromNow(90 * MINUTE, start) });
    const before89 = await createActivity({ creatorId: creator.id, startTime: fromNow(-89 * MINUTE, start) });

    expect(await outcomeCode(acceptActivity(at89.id, accepter.id))).toBe("TIME_CONFLICT");
    expect(await outcomeCode(acceptActivity(before89.id, accepter.id))).toBe("TIME_CONFLICT");
    expect(await outcomeCode(acceptActivity(at90.id, accepter.id))).toBe("OK");
    expect((await storedActivity(at89.id)).status).toBe("OPEN");
  });

  it("counts only ACCEPTED and IN_PROGRESS activities that block time, across features", async () => {
    const [creator, accepter, other] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    const start = fromNow(4 * HOUR);
    for (const status of ["OPEN", "DISPUTED", "COMPLETED", "CANCELLED", "NOT_MARKED", "EXPIRED"] as const) {
      await createActivity({ creatorId: other.id, accepterId: accepter.id, status, startTime: start });
    }
    await createActivity({ type: "SERVICE", creatorId: other.id, accepterId: accepter.id, status: "ACCEPTED", startTime: start, blocksTime: false });
    const item = await createActivity({ type: "RIDE_REQUEST", creatorId: creator.id, startTime: start });
    expect(await outcomeCode(acceptActivity(item.id, accepter.id))).toBe("OK");

    // A carpool session (another feature) in progress for the accepter does conflict.
    await createActivity({ type: "CARPOOL_SESSION", creatorId: other.id, accepterId: accepter.id, status: "IN_PROGRESS", startTime: fromNow(10 * HOUR) });
    const later = await createActivity({ type: "SERVICE", creatorId: creator.id, startTime: fromNow(10 * HOUR + 30 * MINUTE) });
    expect(await outcomeCode(acceptActivity(later.id, accepter.id))).toBe("TIME_CONFLICT");
  });

  it("never sets activities of the same parent post against each other", async () => {
    const [rider, passenger] = await Promise.all([verifiedUser(), verifiedUser()]);
    const start = fromNow(4 * HOUR);
    await createActivity({ type: "RIDE_BOOKING", creatorId: rider.id, accepterId: passenger.id, status: "ACCEPTED", startTime: start, conflictGroupId: "offer-1" });

    await runActivityTransaction(async (tx) => {
      await lockUsers(tx, [rider.id]);
      // Same offer: no conflict for the rider
      await assertNoTimeConflict(tx, { userIds: [rider.id], slots: [start], conflictGroupId: "offer-1" });
    });
    const otherOffer = runActivityTransaction((tx) => assertNoTimeConflict(tx, { userIds: [rider.id], slots: [start], conflictGroupId: "offer-2" }));
    expect(await outcomeCode(otherOffer)).toBe("TIME_CONFLICT");
  });

  it("checks a list of slots in one call (for carpool contracts in B6)", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const day = 24 * HOUR;
    await createActivity({ creatorId: other.id, accepterId: user.id, status: "ACCEPTED", startTime: fromNow(3 * day + 30 * MINUTE) });
    const clear = [fromNow(day), fromNow(2 * day), fromNow(4 * day)];
    const clash = [...clear, fromNow(3 * day)];

    await runActivityTransaction((tx) => assertNoTimeConflict(tx, { userIds: [user.id], slots: clear }));
    expect(await outcomeCode(runActivityTransaction((tx) => assertNoTimeConflict(tx, { userIds: [user.id], slots: clash })))).toBe("TIME_CONFLICT");
  });
});
