import { describe, expect, it } from "vitest";
import { runAccountStatusJob } from "../../src/jobs/account-status.job.js";
import {
  runActivitySweep,
  runAutoCompleteJob,
  runCloseRideOfferJob,
  runExpireJob,
  runNotMarkedJob,
} from "../../src/jobs/activity-timers.job.js";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { prisma } from "../../src/lib/prisma.js";
import { rescheduleAfterStartChange, scheduleActivityTimers } from "../../src/modules/activities/timers.js";
import { HOUR, MINUTE, createActivity, createRideOffer, fromNow, historyOf, storedActivity, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";

// Every job runs twice; the second run must change nothing.
async function twice(run: () => Promise<boolean>) {
  return [await run(), await run()];
}

describe("expiry job", () => {
  it("expires an OPEN item at its start time, once", async () => {
    const user = await verifiedUser();
    const item = await createActivity({ creatorId: user.id, startTime: fromNow(-MINUTE) });

    expect(await twice(() => runExpireJob(item.id))).toEqual([true, false]);
    expect(await storedActivity(item.id)).toMatchObject({ status: "EXPIRED", closureReason: "EXPIRED_UNACCEPTED" });
    expect((await storedActivity(item.id)).autoClosedAt).toBeInstanceOf(Date);
    expect(await historyOf(item.id)).toMatchObject([{ fromStatus: "OPEN", toStatus: "EXPIRED", actorType: "SYSTEM", actorId: null }]);
  });

  it("leaves an item before its start, and an accepted one", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const future = await createActivity({ creatorId: user.id, startTime: fromNow(MINUTE) });
    const accepted = await createActivity({ creatorId: user.id, accepterId: other.id, status: "ACCEPTED", startTime: fromNow(-MINUTE) });

    expect(await runExpireJob(future.id)).toBe(false);
    expect(await runExpireJob(accepted.id)).toBe(false);
    expect(await runExpireJob("0190a000-0000-7000-8000-000000000000")).toBe(false);
  });

  it("does nothing for the old time after the start time was edited", async () => {
    const user = await verifiedUser();
    const oldStart = fromNow(-MINUTE);
    const newStart = fromNow(2 * HOUR);
    const item = await createActivity({ creatorId: user.id, startTime: oldStart });
    await scheduleActivityTimers([item]);
    expect([...scheduledJobs.keys()]).toEqual([`activity-expire-${item.id}-${oldStart.getTime()}`]);

    const edited = await prisma.activity.update({ where: { id: item.id }, data: { startTime: newStart } });
    await rescheduleAfterStartChange(edited, oldStart);

    expect([...scheduledJobs.keys()]).toEqual([`activity-expire-${item.id}-${newStart.getTime()}`]);
    // The old job still fires (it could not be removed in time): nothing happens.
    expect(await runExpireJob(item.id, oldStart)).toBe(false);
    expect((await storedActivity(item.id)).status).toBe("OPEN");
  });
});

describe("NOT_MARKED job", () => {
  it("closes an activity still ACCEPTED 6 hours after start, once", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const item = await createActivity({ creatorId: user.id, accepterId: other.id, status: "ACCEPTED", startTime: fromNow(-6 * HOUR) });
    const early = await createActivity({ creatorId: user.id, accepterId: other.id, status: "ACCEPTED", startTime: fromNow(-6 * HOUR + MINUTE) });

    expect(await twice(() => runNotMarkedJob(item.id))).toEqual([true, false]);
    expect(await runNotMarkedJob(early.id)).toBe(false);
    expect(await storedActivity(item.id)).toMatchObject({ status: "NOT_MARKED", closureReason: "NOT_MARKED_TIMEOUT" });
  });

  it("never closes IN_PROGRESS, COMPLETION_REQUESTED, DISPUTED, finished items or carpool bookings", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const long = fromNow(-10 * HOUR);
    const items = await Promise.all([
      createActivity({ creatorId: user.id, accepterId: other.id, status: "IN_PROGRESS", startTime: long }),
      createActivity({ creatorId: user.id, accepterId: other.id, status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED", startTime: long }),
      createActivity({ creatorId: user.id, accepterId: other.id, status: "ACCEPTED", subStatus: "COMPLETION_REQUESTED", startTime: long }),
      createActivity({ creatorId: user.id, accepterId: other.id, status: "DISPUTED", startTime: long }),
      createActivity({ creatorId: user.id, accepterId: other.id, status: "COMPLETED", startTime: long }),
      createActivity({ creatorId: user.id, accepterId: other.id, status: "CANCELLED", startTime: long }),
      createActivity({ type: "CARPOOL_BOOKING", creatorId: user.id, accepterId: other.id, status: "ACCEPTED", subStatus: "CONTRACT_ACTIVE", startTime: long, blocksTime: false }),
    ]);
    for (const item of items) expect(await runNotMarkedJob(item.id)).toBe(false);
    expect((await runActivitySweep()).notMarked).toBe(0);
  });
});

describe("auto-complete job", () => {
  it("completes 24 hours after the completion request, once", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const item = await createActivity({
      creatorId: user.id,
      accepterId: other.id,
      status: "IN_PROGRESS",
      subStatus: "COMPLETION_REQUESTED",
      completionRequestedById: user.id,
      completionRequestedAt: fromNow(-24 * HOUR),
      startTime: fromNow(-30 * HOUR),
    });

    expect(await twice(() => runAutoCompleteJob(item.id))).toEqual([true, false]);
    expect(await storedActivity(item.id)).toMatchObject({ status: "COMPLETED", closureReason: "AUTO_COMPLETED" });
  });

  it("does not complete a disputed activity or one asked less than 24 hours ago", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const disputed = await createActivity({ creatorId: user.id, accepterId: other.id, status: "DISPUTED", subStatus: "COMPLETION_REQUESTED", completionRequestedAt: fromNow(-30 * HOUR) });
    const recent = await createActivity({ creatorId: user.id, accepterId: other.id, status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED", completionRequestedAt: fromNow(-23 * HOUR) });

    expect(await runAutoCompleteJob(disputed.id)).toBe(false);
    expect(await runAutoCompleteJob(recent.id)).toBe(false);
  });
});

describe("ride offer closing and the sweeper", () => {
  it("closes OPEN and FULL ride offers at departure, once, and leaves later ones", async () => {
    const rider = await verifiedUser();
    const open = await createRideOffer(rider.id, { departureTime: fromNow(-MINUTE) });
    const full = await createRideOffer(rider.id, { departureTime: fromNow(-MINUTE), status: "FULL", seatsAvailable: 0 });
    const later = await createRideOffer(rider.id, { departureTime: fromNow(HOUR) });

    expect(await twice(() => runCloseRideOfferJob(open.id))).toEqual([true, false]);
    expect(await runCloseRideOfferJob(later.id)).toBe(false);
    expect((await runActivitySweep()).rideOffersClosed).toBe(1);
    expect((await prisma.rideOffer.findUniqueOrThrow({ where: { id: full.id } })).status).toBe("CLOSED");
    expect((await prisma.rideOffer.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("OPEN");
  });

  it("catches every overdue item a lost job left, and changes nothing on a second run", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const expired = await createActivity({ creatorId: user.id, startTime: fromNow(-HOUR) });
    const notMarked = await createActivity({ type: "CARPOOL_SESSION", creatorId: user.id, accepterId: other.id, status: "ACCEPTED", startTime: fromNow(-7 * HOUR) });
    const done = await createActivity({ type: "SERVICE", creatorId: user.id, accepterId: other.id, status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED", completionRequestedAt: fromNow(-25 * HOUR) });
    const untouched = await createActivity({ creatorId: user.id, startTime: fromNow(HOUR) });
    await createRideOffer(user.id, { departureTime: fromNow(-MINUTE) });

    expect(await runActivitySweep()).toEqual({ expired: 1, notMarked: 1, autoCompleted: 1, rideOffersClosed: 1, remindersSent: 0, notificationsDelivered: 0, reviewsPublished: 0, holdsReleased: 0, contractsEnded: 0, postsClosed: 0 });
    expect(await runActivitySweep()).toEqual({ expired: 0, notMarked: 0, autoCompleted: 0, rideOffersClosed: 0, remindersSent: 0, notificationsDelivered: 0, reviewsPublished: 0, holdsReleased: 0, contractsEnded: 0, postsClosed: 0 });

    expect((await storedActivity(expired.id)).status).toBe("EXPIRED");
    expect((await storedActivity(notMarked.id)).status).toBe("NOT_MARKED");
    expect((await storedActivity(done.id)).status).toBe("COMPLETED");
    expect((await storedActivity(untouched.id)).status).toBe("OPEN");
    expect(await historyOf(expired.id)).toHaveLength(1);
  });
});

describe("account lock hook (onAccountLocked)", () => {
  it("closes the user's OPEN items and posts when an admin restricts them, and keeps accepted ones", async () => {
    const admin = await registerUser({ role: "SUPER_ADMIN" });
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const open = await createActivity({ creatorId: user.id });
    const sentRequest = await createActivity({ type: "CARPOOL_BOOKING", creatorId: other.id, accepterId: user.id, blocksTime: false });
    const accepted = await createActivity({ creatorId: user.id, accepterId: other.id, status: "ACCEPTED" });
    const othersOpen = await createActivity({ creatorId: other.id });
    const offer = await createRideOffer(user.id);
    const fullOffer = await createRideOffer(user.id, { status: "FULL", seatsAvailable: 0 });

    const response = await api().post(`/api/admin/users/${user.id}/restrict`).set(bearer(admin.accessToken)).send({ reason: "Spam posts" });
    expect(response.status).toBe(200);

    expect(await storedActivity(open.id)).toMatchObject({ status: "CANCELLED", closureReason: "ACCOUNT_MODERATED", cancelledById: admin.id });
    expect((await storedActivity(sentRequest.id)).status).toBe("CANCELLED");
    expect((await storedActivity(accepted.id)).status).toBe("ACCEPTED");
    expect((await storedActivity(othersOpen.id)).status).toBe("OPEN");
    expect((await prisma.rideOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("CLOSED");
    expect((await prisma.rideOffer.findUniqueOrThrow({ where: { id: fullOffer.id } })).status).toBe("CLOSED");
    expect(await historyOf(open.id)).toMatchObject([{ toStatus: "CANCELLED", actorType: "ADMIN", actorId: admin.id }]);
  });

  it("does the same, as the system, when a booked suspension starts", async () => {
    const user = await verifiedUser();
    const open = await createActivity({ creatorId: user.id });
    await prisma.user.update({ where: { id: user.id }, data: { suspendedFrom: fromNow(-MINUTE), suspendedUntil: fromNow(HOUR) } });

    expect((await runAccountStatusJob()).started).toBe(1);
    expect(await storedActivity(open.id)).toMatchObject({ status: "CANCELLED", closureReason: "ACCOUNT_MODERATED", cancelledById: null });
    expect(await historyOf(open.id)).toMatchObject([{ actorType: "SYSTEM" }]);
  });
});
