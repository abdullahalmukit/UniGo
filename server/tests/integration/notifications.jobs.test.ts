import { afterEach, describe, expect, it, vi } from "vitest";
import { runActivitySweep } from "../../src/jobs/activity-timers.job.js";
import { runReminderJob } from "../../src/jobs/reminders.job.js";
import { resetSchedulerForTests, scheduledJobs, useBullmqSchedulerForTests } from "../../src/jobs/scheduler.js";
import { processJob } from "../../src/jobs/worker.js";
import { prisma } from "../../src/lib/prisma.js";
import { acceptActivity } from "../../src/modules/activities/engine.js";
import { rescheduleAfterStartChange } from "../../src/modules/activities/timers.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { deliveryJobId, notify, useDeliveryQueueForTests } from "../../src/modules/notifications/notify.service.js";
import { failingPushEndpoints, sentPushes } from "../../src/modules/notifications/push.transport.js";
import { queueSubAreaNotification, runSubAreaNotifyJob } from "../../src/modules/notifications/sub-area.service.js";
import { blockUser } from "../../src/modules/users/blocks.service.js";
import { dhakaWallTime, dhakaDateString } from "../../src/utils/time.js";
import { createActivity, fromNow, HOUR, MINUTE, verifiedUser } from "./activity-helpers.js";
import { registerUser } from "./helpers.js";
import { channelsOf, rowsOf, settle, subscribeDevice } from "./notification-helpers.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSchedulerForTests();
});

// --- Sub-area notifications

async function foodRequestIn(subAreaId: string, creatorId: string) {
  const activity = await createActivity({ creatorId });
  const point = { restaurantLat: 23.75, restaurantLng: 90.38, pickupLat: 23.75, pickupLng: 90.38, deliveryLat: 23.74, deliveryLng: 90.37 };
  await prisma.foodRequest.create({
    data: {
      activityId: activity.id,
      restaurantName: "Star Kabab",
      restaurantAddress: "Dhanmondi 2",
      items: "Kabab",
      details: "Extra sauce",
      quantity: 1,
      estimatedBudget: 300,
      pickupAddress: "Dhanmondi 2",
      deliveryAddress: "Hall 3",
      subAreaId,
      ...point,
    },
  });
  return activity;
}

describe("sub-area notification engine", () => {
  it("tells verified, active users who saved the sub-area, and nobody blocked, unverified or locked", async () => {
    const area = await prisma.subArea.create({ data: { name: "Dhanmondi" } });
    const other = await prisma.subArea.create({ data: { name: "Mirpur" } });
    const creator = await verifiedUser();
    const fan = await verifiedUser();
    const blockedByCreator = await verifiedUser();
    const blockingCreator = await verifiedUser();
    const unverified = await registerUser({ studentVerificationStatus: "PENDING" });
    const restricted = await verifiedUser();
    const suspended = await verifiedUser();
    const elsewhere = await verifiedUser();
    await prisma.user.update({ where: { id: restricted.id }, data: { accountStatus: "RESTRICTED" } });
    await prisma.user.update({ where: { id: suspended.id }, data: { accountStatus: "SUSPENDED", suspendedUntil: fromNow(24 * HOUR) } });
    const savers = [creator, fan, blockedByCreator, blockingCreator, unverified, restricted, suspended];
    await prisma.userSubArea.createMany({ data: savers.map((u) => ({ userId: u.id, subAreaId: area.id })) });
    await prisma.userSubArea.create({ data: { userId: elsewhere.id, subAreaId: other.id } });
    await blockUser(creator.id, blockedByCreator.id);
    await blockUser(blockingCreator.id, creator.id);
    await subscribeDevice(fan.id);

    const food = await foodRequestIn(area.id, creator.id);
    await queueSubAreaNotification(food.id);
    expect(scheduledJobs.get(`sub-area-notify-${food.id}`)).toMatchObject({ name: "sub-area-notify" });

    expect(await runSubAreaNotifyJob(food.id)).toBe(1);
    expect(await runSubAreaNotifyJob(food.id)).toBe(0);
    await settle();

    expect(await channelsOf(fan.id, "SUB_AREA_NEW_REQUEST")).toEqual(["IN_APP", "PUSH"]);
    for (const user of [creator, blockedByCreator, blockingCreator, unverified, restricted, suspended, elsewhere]) {
      expect(await rowsOf(user.id, "SUB_AREA_NEW_REQUEST")).toEqual([]);
    }
    expect(sentPushes[0].payload.title).toBe("New request in Dhanmondi");
  });

  it("notifies nobody once the request is no longer open, or when the sub-area is inactive", async () => {
    const area = await prisma.subArea.create({ data: { name: "Gulshan", isActive: false } });
    const [creator, fan] = await Promise.all([verifiedUser(), verifiedUser()]);
    await prisma.userSubArea.create({ data: { userId: fan.id, subAreaId: area.id } });
    const food = await foodRequestIn(area.id, creator.id);
    expect(await runSubAreaNotifyJob(food.id)).toBe(0);

    await prisma.subArea.update({ where: { id: area.id }, data: { isActive: true } });
    await prisma.activity.update({ where: { id: food.id }, data: { status: "CANCELLED" } });
    expect(await runSubAreaNotifyJob(food.id)).toBe(0);
  });
});

// --- Reminders

describe("30-minute and carpool reminders", () => {
  it("reminds both participants once, in-app and by push", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    await subscribeDevice(accepter.id);
    const start = fromNow(2 * HOUR);
    const food = await createActivity({ creatorId: creator.id, startTime: start });
    await acceptActivity(food.id, accepter.id);
    const due = new Date(start.getTime() - 30 * MINUTE);
    expect(scheduledJobs.get(`activity-reminder-${food.id}-${due.getTime()}`)).toBeDefined();

    expect(await runReminderJob(food.id, due)).toBe(true);
    expect(await runReminderJob(food.id, due)).toBe(false);
    await settle();
    expect(await channelsOf(creator.id, "ACTIVITY_REMINDER")).toEqual(["IN_APP", "PUSH"]);
    expect(await channelsOf(accepter.id, "ACTIVITY_REMINDER")).toEqual(["IN_APP", "PUSH"]);
    expect(sentPushes.filter((p) => p.payload.title === "Starting in 30 minutes")).toHaveLength(1);
    expect(sentEmails.filter((e) => e.subject === "Starting in 30 minutes")).toEqual([]);
  });

  it("is skipped when the activity is no longer ACCEPTED, or was accepted after the reminder time", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const start = fromNow(2 * HOUR);
    const due = new Date(start.getTime() - 30 * MINUTE);
    const started = await createActivity({ creatorId: creator.id, accepterId: accepter.id, status: "IN_PROGRESS", subStatus: "FOOD_COLLECTED", startTime: start });
    const late = await createActivity({ creatorId: creator.id, accepterId: accepter.id, status: "ACCEPTED", startTime: start });
    await prisma.activity.update({ where: { id: late.id }, data: { acceptedAt: new Date(due.getTime() + MINUTE) } });

    expect(await runReminderJob(started.id, due)).toBe(false);
    expect(await runReminderJob(late.id, due)).toBe(false);
    // The sweeper does not send it either
    const sweep = await runActivitySweep(new Date(due.getTime() + 5 * MINUTE));
    expect(sweep.remindersSent).toBe(0);
    expect(await rowsOf(creator.id, "ACTIVITY_REMINDER")).toEqual([]);
  });

  it("is sent by the sweeper when the job was lost, and only once", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const start = fromNow(2 * HOUR);
    const food = await createActivity({ creatorId: creator.id, accepterId: accepter.id, status: "ACCEPTED", startTime: start });
    await prisma.activity.update({ where: { id: food.id }, data: { acceptedAt: fromNow(-HOUR) } });
    const due = new Date(start.getTime() - 30 * MINUTE);

    expect((await runActivitySweep(new Date(due.getTime() - 5 * MINUTE))).remindersSent).toBe(0);
    expect((await runActivitySweep(new Date(due.getTime() + MINUTE))).remindersSent).toBe(1);
    expect((await runActivitySweep(new Date(due.getTime() + 2 * MINUTE))).remindersSent).toBe(0);
    expect(await runReminderJob(food.id, due)).toBe(false);
  });

  it("moves with the start time when an OPEN item is edited before it is accepted", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const oldStart = fromNow(3 * HOUR);
    const newStart = fromNow(5 * HOUR);
    const food = await createActivity({ creatorId: creator.id, startTime: oldStart });
    await prisma.activity.update({ where: { id: food.id }, data: { startTime: newStart } });
    const edited = await prisma.activity.findUniqueOrThrow({ where: { id: food.id } });
    await rescheduleAfterStartChange(edited, oldStart);
    await acceptActivity(food.id, accepter.id);

    const reminders = [...scheduledJobs.values()].filter((job) => job.name === "activity-reminder");
    expect(reminders.map((job) => job.runAt)).toEqual([new Date(newStart.getTime() - 30 * MINUTE)]);
  });

  it("reminds carpool riders on the ride day", async () => {
    const [rider, passenger] = await Promise.all([verifiedUser(), verifiedUser()]);
    const tomorrow = dhakaDateString(fromNow(24 * HOUR));
    const start = dhakaWallTime(tomorrow, 9, 0);
    const session = await createActivity({ type: "CARPOOL_SESSION", creatorId: rider.id, accepterId: passenger.id, status: "ACCEPTED", startTime: start });
    await prisma.activity.update({ where: { id: session.id }, data: { acceptedAt: new Date() } });
    const due = dhakaWallTime(tomorrow, 7, 0);

    expect(await runReminderJob(session.id, new Date(due.getTime() - 10 * MINUTE))).toBe(false);
    expect(await runReminderJob(session.id, due)).toBe(true);
    await settle();
    expect(await channelsOf(rider.id, "CARPOOL_SESSION_REMINDER")).toEqual(["IN_APP", "PUSH"]);
    expect(await channelsOf(passenger.id, "CARPOOL_SESSION_REMINDER")).toEqual(["IN_APP", "PUSH"]);
    expect(await rowsOf(rider.id, "ACTIVITY_REMINDER")).toEqual([]);
  });
});

// --- Delivery

describe("push and email delivery", () => {
  it("goes through the delivery job with retries, and records SENT", async () => {
    useDeliveryQueueForTests(true);
    const user = await verifiedUser();
    await subscribeDevice(user.id);
    const rows = await notify({ type: "DISPUTE_UPDATED", userIds: [user.id], dedupeKey: "DISPUTE_UPDATED:q1" });
    const email = rows.find((row) => row.channel === "EMAIL")!;
    const push = rows.find((row) => row.channel === "PUSH")!;
    expect(scheduledJobs.get(deliveryJobId(email.id))).toMatchObject({ name: "notification-deliver", attempts: 3, backoffMs: 10_000 });
    await settle();
    expect(sentEmails).toEqual([]);

    for (const row of [email, push]) {
      const result = await processJob({ name: "notification-deliver", data: { id: row.id }, opts: { attempts: 3 }, attemptsMade: 0 } as never);
      expect(result).toBe(true);
    }
    expect(sentEmails).toHaveLength(1);
    expect(sentPushes).toHaveLength(1);
    expect((await rowsOf(user.id)).every((row) => row.status === "SENT")).toBe(true);
  });

  it("keeps a failed send PENDING while attempts remain, then records FAILED", async () => {
    useDeliveryQueueForTests(true);
    const user = await verifiedUser();
    const device = await subscribeDevice(user.id);
    failingPushEndpoints.set(device.endpoint, 500);
    const [push] = await notify({ type: "ANNOUNCEMENT", userIds: [user.id], dedupeKey: "ANNOUNCEMENT:f1", only: ["PUSH"], data: { title: "x", body: "y" } });
    const job = (attemptsMade: number) => ({ name: "notification-deliver", data: { id: push.id }, opts: { attempts: 3 }, attemptsMade }) as never;

    await expect(processJob(job(0))).rejects.toThrow("Push service answered 500");
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: push.id } })).status).toBe("PENDING");
    await expect(processJob(job(2))).resolves.toBe(true);
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: push.id } })).toMatchObject({ status: "FAILED" });
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
  });

  it("sends directly when Redis is down", async () => {
    await useBullmqSchedulerForTests("redis://127.0.0.1:6390");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = await verifiedUser();
    await notify({ type: "DISPUTE_UPDATED", userIds: [user.id], dedupeKey: "DISPUTE_UPDATED:r1" });
    await settle();
    expect(sentEmails.map((e) => e.to)).toEqual([user.email]);
    expect((await rowsOf(user.id)).find((row) => row.channel === "EMAIL")?.status).toBe("SENT");
  });

  it("deletes subscriptions the push service no longer knows (404 or 410) and keeps the others", async () => {
    const user = await verifiedUser();
    const gone = await subscribeDevice(user.id);
    const missing = await subscribeDevice(user.id);
    const working = await subscribeDevice(user.id);
    failingPushEndpoints.set(gone.endpoint, 410);
    failingPushEndpoints.set(missing.endpoint, 404);
    await prisma.user.update({ where: { id: user.id }, data: { pushEnabled: true } });

    await notify({ type: "ANNOUNCEMENT", userIds: [user.id], dedupeKey: "ANNOUNCEMENT:d1", data: { title: "x", body: "y" } });
    await settle();
    expect((await prisma.pushSubscription.findMany({ where: { userId: user.id } })).map((s) => s.id)).toEqual([working.id]);
    expect(sentPushes.map((p) => p.endpoint)).toEqual([working.endpoint]);
    expect((await rowsOf(user.id)).find((row) => row.channel === "PUSH")?.status).toBe("SENT");

    // The last one gone too: nothing to send to, and push is off for the account.
    failingPushEndpoints.set(working.endpoint, 410);
    await notify({ type: "ANNOUNCEMENT", userIds: [user.id], dedupeKey: "ANNOUNCEMENT:d2", data: { title: "x", body: "y" } });
    await settle();
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pushEnabled).toBe(false);
    expect((await rowsOf(user.id)).filter((row) => row.channel === "PUSH").map((row) => row.status).sort()).toEqual(["SENT", "SKIPPED"]);
  });

  it("sends rows a lost delivery job left PENDING from the sweeper", async () => {
    useDeliveryQueueForTests(true);
    const user = await verifiedUser();
    const [email] = await notify({ type: "DISPUTE_UPDATED", userIds: [user.id], dedupeKey: "DISPUTE_UPDATED:s1", only: ["EMAIL"] });
    expect(await runActivitySweep()).toMatchObject({ notificationsDelivered: 0 });
    await prisma.notification.update({ where: { id: email.id }, data: { createdAt: fromNow(-5 * MINUTE) } });
    expect(await runActivitySweep()).toMatchObject({ notificationsDelivered: 1 });
    expect(sentEmails).toHaveLength(1);
    expect(await runActivitySweep()).toMatchObject({ notificationsDelivered: 0 });
  });
});
