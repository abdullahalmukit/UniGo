import { describe, expect, it } from "vitest";
import type { ActivityStatus, ActivitySubStatus, ActivityType, NotificationType } from "../../src/generated/prisma/client.js";
import { runAccountStatusJob } from "../../src/jobs/account-status.job.js";
import { runExpireJob } from "../../src/jobs/activity-timers.job.js";
import { runLicenceReminderJob } from "../../src/jobs/licence-reminder.job.js";
import { prisma } from "../../src/lib/prisma.js";
import { applyAccountAction } from "../../src/modules/admin/moderation.service.js";
import { approveIdCard, rejectIdCard } from "../../src/modules/admin/student-verifications.service.js";
import { acceptActivity, transitionActivity } from "../../src/modules/activities/engine.js";
import type { ActivityTransitionEvent } from "../../src/modules/activities/events.js";
import type { ActivityAction, ActorRef } from "../../src/modules/activities/transitions.js";
import { requestPasswordReset } from "../../src/modules/auth/password-reset.service.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { notifyTransition } from "../../src/modules/notifications/activity-notifications.js";
import { CATALOGUE } from "../../src/modules/notifications/catalogue.js";
import { notify } from "../../src/modules/notifications/notify.service.js";
import { sentPushes } from "../../src/modules/notifications/push.transport.js";
import { rejectApplication, suspendRider } from "../../src/modules/riders/riders.admin.service.js";
import { dateOnly, dhakaDateString } from "../../src/utils/time.js";
import { createActivity, fromNow, HOUR, verifiedUser } from "./activity-helpers.js";
import { api, bearer, PASSWORD, registerUser } from "./helpers.js";
import { channelsOf, rowsOf, settle, sorted, subscribeDevice } from "./notification-helpers.js";

const DAY = 24 * HOUR;
const expected = (type: NotificationType) => sorted(CATALOGUE[type].channels);

async function pair(type: ActivityType = "FOOD", status: ActivityStatus = "ACCEPTED", subStatus: ActivitySubStatus | null = null) {
  const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
  await Promise.all([subscribeDevice(creator.id), subscribeDevice(accepter.id)]);
  const activity = await createActivity({ type, creatorId: creator.id, accepterId: status === "OPEN" ? null : accepter.id, status, subStatus });
  return { creator, accepter, activity };
}

const admin = () => registerUser({ role: "SUPER_ADMIN", studentVerificationStatus: "VERIFIED" });

describe("activity status changes (proposal section 14)", () => {
  type Case = {
    action: ActivityAction;
    type: ActivityType;
    actor: "creator" | "accepter" | "system" | "admin";
    to?: { status: ActivityStatus; subStatus: ActivitySubStatus | null };
    expect: { type: NotificationType; to: ("creator" | "accepter")[] } | null;
  };
  const cases: Case[] = [
    { action: "ACCEPT", type: "FOOD", actor: "accepter", expect: { type: "REQUEST_ACCEPTED", to: ["creator"] } },
    { action: "ACCEPT", type: "RIDE_BOOKING", actor: "accepter", expect: { type: "SEAT_BOOKED", to: ["creator"] } },
    { action: "ACCEPT_BOOKING", type: "CARPOOL_BOOKING", actor: "creator", expect: { type: "CARPOOL_BOOKING_ACCEPTED", to: ["accepter"] } },
    { action: "REJECT_BOOKING", type: "CARPOOL_BOOKING", actor: "creator", expect: { type: "CARPOOL_BOOKING_REJECTED", to: ["accepter"] } },
    {
      action: "AGREE_CONTRACT",
      type: "CARPOOL_BOOKING",
      actor: "accepter",
      to: { status: "ACCEPTED", subStatus: "CONTRACT_ACTIVE" },
      expect: { type: "CARPOOL_CONTRACT_CREATED", to: ["creator", "accepter"] },
    },
    { action: "REQUEST_COMPLETION", type: "RIDE_REQUEST", actor: "creator", expect: { type: "COMPLETION_REQUESTED", to: ["accepter"] } },
    { action: "DELIVER_SERVICE", type: "SERVICE", actor: "accepter", expect: { type: "COMPLETION_REQUESTED", to: ["creator"] } },
    { action: "AUTO_COMPLETE", type: "FOOD", actor: "system", expect: { type: "AUTO_COMPLETED", to: ["creator", "accepter"] } },
    { action: "MARK_NOT_MARKED", type: "FOOD", actor: "system", expect: { type: "AUTO_CLOSED_NOT_MARKED", to: ["creator", "accepter"] } },
    { action: "CANCEL", type: "FOOD", actor: "accepter", expect: { type: "ACTIVITY_CANCELLED", to: ["creator"] } },
    { action: "TERMINATE_CONTRACT", type: "CARPOOL_BOOKING", actor: "creator", expect: { type: "ACTIVITY_CANCELLED", to: ["accepter"] } },
    { action: "RELEASE_HOLD", type: "CARPOOL_BOOKING", actor: "system", expect: { type: "ACTIVITY_CANCELLED", to: ["creator", "accepter"] } },
    { action: "ADMIN_CANCEL", type: "SERVICE", actor: "admin", expect: { type: "ACTIVITY_CANCELLED", to: ["creator", "accepter"] } },
    { action: "DISPUTE", type: "FOOD", actor: "creator", expect: { type: "DISPUTE_OPENED", to: ["creator", "accepter"] } },
    { action: "RESOLVE_CANCELLED", type: "FOOD", actor: "admin", expect: { type: "DISPUTE_RESOLVED", to: ["creator", "accepter"] } },
    // Not in the section 14 table: only the chat's system message
    { action: "START", type: "RIDE_REQUEST", actor: "creator", expect: null },
    { action: "CONFIRM_COMPLETION", type: "FOOD", actor: "accepter", expect: null },
  ];

  it.each(cases)("$action on $type notifies the right users on the table's channels", async (c) => {
    const { creator, accepter, activity } = await pair(c.type);
    const users = { creator: creator.id, accepter: accepter.id };
    const actor: ActorRef =
      c.actor === "system" ? { type: "SYSTEM" } : c.actor === "admin" ? { type: "ADMIN", id: "admin" } : { type: "USER", id: users[c.actor] };
    const event: ActivityTransitionEvent = {
      activityId: activity.id,
      type: c.type,
      action: c.action,
      from: { status: "ACCEPTED", subStatus: null },
      to: c.to ?? { status: "ACCEPTED", subStatus: null },
      actor,
      creatorId: creator.id,
      accepterId: accepter.id,
      at: new Date(),
    };
    await notifyTransition(event);
    await notifyTransition(event); // a repeated event notifies nobody twice
    await settle();

    const all = await prisma.notification.findMany({ where: { activityId: activity.id } });
    if (!c.expect) {
      expect(all).toEqual([]);
      return;
    }
    for (const who of ["creator", "accepter"] as const) {
      const channels = await channelsOf(users[who], c.expect.type);
      expect(channels, who).toEqual(c.expect.to.includes(who) ? expected(c.expect.type) : []);
    }
    expect(all.every((row) => row.type === c.expect!.type)).toBe(true);
    // Push and email rows were sent (both users have a device)
    expect(all.filter((row) => row.channel !== "IN_APP").every((row) => row.status === "SENT")).toBe(true);
  });

  it("is wired to the engine: an accept notifies the creator in-app, by push and by email", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    await subscribeDevice(creator.id);
    const food = await createActivity({ creatorId: creator.id });
    await acceptActivity(food.id, accepter.id);
    await settle();

    expect(await channelsOf(creator.id, "REQUEST_ACCEPTED")).toEqual(["IN_APP", "PUSH", "EMAIL"].sort());
    expect(await rowsOf(accepter.id)).toEqual([]);
    expect(sentEmails.map((email) => email.to)).toEqual([creator.email]);
    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0].payload).toMatchObject({ title: "Your request was accepted", url: expect.stringMatching(/^\/inbox\//) });
    const [inApp] = await rowsOf(creator.id, "REQUEST_ACCEPTED");
    expect(inApp.data).toMatchObject({ activityType: "FOOD", name: "Test Student" });
  });

  it("tells the other participant when an accepted activity is cancelled, never the canceller", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    const food = await createActivity({ creatorId: creator.id });
    await acceptActivity(food.id, accepter.id);
    const cancel = await api().post(`/api/activities/${food.id}/cancel`).set(bearer(accepter.accessToken)).send({ reason: "Running late" });
    expect(cancel.status).toBe(200);
    await settle();

    // PUSH is SKIPPED: no device subscribed
    expect(await channelsOf(creator.id, "ACTIVITY_CANCELLED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
    expect((await rowsOf(creator.id, "ACTIVITY_CANCELLED")).find((r) => r.channel === "PUSH")?.status).toBe("SKIPPED");
    expect(await channelsOf(accepter.id, "ACTIVITY_CANCELLED")).toEqual([]);
  });

  it("tells the creator in-app when an open request expires", async () => {
    const creator = await verifiedUser();
    const food = await createActivity({ creatorId: creator.id, startTime: fromNow(-HOUR) });
    await runExpireJob(food.id);
    await runExpireJob(food.id);
    await settle();
    expect(await channelsOf(creator.id, "REQUEST_EXPIRED")).toEqual(["IN_APP"]);
    expect(sentEmails).toEqual([]);
  });

  it("tells both in-app only when an activity is completed automatically", async () => {
    const { creator, accepter, activity } = await pair("FOOD", "IN_PROGRESS", "COMPLETION_REQUESTED");
    await prisma.activity.update({ where: { id: activity.id }, data: { completionRequestedAt: fromNow(-25 * HOUR), completionRequestedById: creator.id } });
    await transitionActivity(activity.id, "AUTO_COMPLETE", { type: "SYSTEM" });
    await settle();
    expect(await channelsOf(creator.id, "AUTO_COMPLETED")).toEqual(["IN_APP"]);
    expect(await channelsOf(accepter.id, "AUTO_COMPLETED")).toEqual(["IN_APP"]);
    expect(sentPushes).toEqual([]);
  });
});

describe("rows sent by later features (wired in B6-B8)", () => {
  it.each([
    ["CARPOOL_BOOKING_REQUESTED"],
    ["CARPOOL_PAYMENT_DUE"],
    ["DISPUTE_UPDATED"],
    ["REPORT_UPDATE"],
    ["SUPPORT_UPDATE"],
    ["ANNOUNCEMENT"],
  ] as [NotificationType][])("%s goes out on exactly its channels", async (type) => {
    const user = await verifiedUser();
    await subscribeDevice(user.id);
    await notify({ type, userIds: [user.id], dedupeKey: `${type}:test`, data: { name: "Rina", title: "Hello", body: "News" } });
    await settle();
    expect(await channelsOf(user.id, type)).toEqual(expected(type));
    expect((await rowsOf(user.id, type)).every((row) => row.status === "SENT")).toBe(true);
  });
});

describe("account, verification and rider notifications", () => {
  it("student verification result: in-app and email, always sent", async () => {
    const reviewer = await admin();
    const [approved, rejected] = await Promise.all([
      registerUser({ studentVerificationStatus: "PENDING" }),
      registerUser({ studentVerificationStatus: "PENDING" }),
    ]);
    await prisma.user.updateMany({ where: { id: { in: [approved.id, rejected.id] } }, data: { emailNotificationsEnabled: false } });
    const [a, r] = await Promise.all(
      [approved, rejected].map((user) => prisma.studentVerification.create({ data: { userId: user.id, method: "ID_CARD", idCardFileKey: "id-cards/x.png" } })),
    );
    await approveIdCard(reviewer.id, a.id);
    await rejectIdCard(reviewer.id, r.id, "Photo is blurry");
    await settle();

    expect(await channelsOf(approved.id, "STUDENT_VERIFICATION_RESULT")).toEqual(["EMAIL", "IN_APP"]);
    expect((await rowsOf(rejected.id, "STUDENT_VERIFICATION_RESULT"))[0].data).toMatchObject({ kind: "REJECTED", reason: "Photo is blurry" });
    expect(sentEmails.map((e) => e.to).sort()).toEqual([approved.email, rejected.email].sort());
    expect(sentEmails.find((e) => e.to === rejected.email)?.text).toContain("Photo is blurry");
  });

  it("rider verification result and rider suspension: in-app and email", async () => {
    const reviewer = await admin();
    const rider = await verifiedUser();
    const application = await prisma.riderApplication.create({ data: { userId: rider.id, licenceExpiresOn: dateOnly("2030-01-01") } });
    await rejectApplication(reviewer.id, application.id, "Licence photo unreadable");
    await prisma.user.update({ where: { id: rider.id }, data: { isVerifiedRider: true } });
    await suspendRider(reviewer.id, rider.id, { reason: "Too many cancellations" });
    await settle();

    expect(await channelsOf(rider.id, "RIDER_VERIFICATION_RESULT")).toEqual(["EMAIL", "IN_APP"]);
    expect(await channelsOf(rider.id, "RIDER_ACCESS_CHANGED")).toEqual(["EMAIL", "IN_APP"]);
    expect(sentEmails.map((e) => e.subject)).toEqual(
      expect.arrayContaining(["Your UniGo rider application was not approved", "Your UniGo rider access is suspended"]),
    );
  });

  it("account status changed: in-app and email even with activity emails off", async () => {
    const moderator = await admin();
    const user = await verifiedUser();
    await prisma.user.update({ where: { id: user.id }, data: { emailNotificationsEnabled: false } });
    await applyAccountAction(moderator.id, user.id, "warn", { reason: "Rude messages" });
    await settle();

    expect(await channelsOf(user.id, "ACCOUNT_STATUS_CHANGED")).toEqual(["EMAIL", "IN_APP"]);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({ to: user.email, subject: "A warning on your UniGo account" });
  });

  it("tells the other participant of an accepted activity when an account is restricted, without saying how", async () => {
    const moderator = await admin();
    const { creator, accepter, activity } = await pair("FOOD");
    await applyAccountAction(moderator.id, accepter.id, "restrict", { reason: "No-shows" });
    await settle();

    expect(await channelsOf(creator.id, "PARTICIPANT_ACCOUNT_LOCKED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
    const [row] = await rowsOf(creator.id, "PARTICIPANT_ACCOUNT_LOCKED");
    expect(row.activityId).toBe(activity.id);
    const email = sentEmails.find((e) => e.to === creator.email)!;
    expect(email.text).not.toMatch(/restrict|suspend|ban/i);
    expect(await channelsOf(accepter.id, "PARTICIPANT_ACCOUNT_LOCKED")).toEqual([]);
    expect(await channelsOf(accepter.id, "ACCOUNT_STATUS_CHANGED")).toEqual(["EMAIL", "IN_APP"]);
  });

  it("password reset requested and password changed: email only, and the reset link is never stored", async () => {
    const user = await verifiedUser();
    await requestPasswordReset(user.email);
    const change = await api()
      .post("/api/auth/change-password")
      .set(bearer(user.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: "newsecret123" });
    expect(change.status).toBe(200);
    await settle();

    expect(await channelsOf(user.id, "PASSWORD_RESET_REQUESTED")).toEqual(["EMAIL"]);
    expect(await channelsOf(user.id, "PASSWORD_CHANGED")).toEqual(["EMAIL"]);
    const rows = await rowsOf(user.id);
    expect(rows.every((row) => row.status === "SENT")).toBe(true);
    expect(JSON.stringify(rows.map((row) => row.data))).not.toContain("token");
    expect(sentEmails.map((e) => e.subject)).toEqual(["Reset your UniGo password", "Your UniGo password was changed"]);
  });

  it("licence expiry: reminders 30 and 7 days before (in-app and email), then Inactive with a notice", async () => {
    const rider = await verifiedUser();
    await prisma.user.update({ where: { id: rider.id }, data: { isVerifiedRider: true, riderActive: true } });
    const now = new Date();
    const expires = dhakaDateString(new Date(now.getTime() + 20 * DAY));
    await prisma.riderApplication.create({ data: { userId: rider.id, status: "APPROVED", licenceExpiresOn: dateOnly(expires) } });

    expect(await runLicenceReminderJob(now)).toBe(1);
    expect(await runLicenceReminderJob(now)).toBe(0);
    expect(await runLicenceReminderJob(new Date(now.getTime() + 14 * DAY))).toBe(1);
    await settle();
    const reminders = await rowsOf(rider.id, "LICENCE_EXPIRY_REMINDER");
    expect(reminders.map((r) => r.channel).sort()).toEqual(["EMAIL", "EMAIL", "IN_APP", "IN_APP"]);
    expect(reminders.map((r) => r.dedupeKey).sort()).toEqual(
      [`LICENCE_EXPIRY_REMINDER:${rider.id}:${expires}:30`, `LICENCE_EXPIRY_REMINDER:${rider.id}:${expires}:30`, `LICENCE_EXPIRY_REMINDER:${rider.id}:${expires}:7`, `LICENCE_EXPIRY_REMINDER:${rider.id}:${expires}:7`].sort(),
    );

    // The day after expiry the account-status job sets the rider Inactive and says so.
    await runAccountStatusJob(new Date(now.getTime() + 21 * DAY + HOUR));
    await runAccountStatusJob(new Date(now.getTime() + 21 * DAY + 2 * HOUR));
    await settle();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rider.id } })).riderActive).toBe(false);
    expect(await channelsOf(rider.id, "RIDER_ACCESS_CHANGED")).toEqual(["EMAIL", "IN_APP"]);
    expect(sentEmails.at(-1)?.subject).toBe("Your UniGo rider status is Inactive: licence expired");
  });
});

describe("de-duplication and the email switch", () => {
  it("writes one notification per event per user per channel", async () => {
    const user = await verifiedUser();
    await subscribeDevice(user.id);
    const input = { type: "DISPUTE_UPDATED" as const, userIds: [user.id, user.id], dedupeKey: "DISPUTE_UPDATED:d1" };
    const first = await notify(input);
    const again = await Promise.all([notify(input), notify(input)]);
    await settle();
    expect(first).toHaveLength(3);
    expect(again.flat()).toEqual([]);
    expect(await channelsOf(user.id, "DISPUTE_UPDATED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
    expect(sentEmails).toHaveLength(1);
    expect(sentPushes).toHaveLength(1);
  });

  it("skips activity emails when the switch is off, but still writes in-app and push", async () => {
    const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
    await prisma.user.update({ where: { id: creator.id }, data: { emailNotificationsEnabled: false } });
    await subscribeDevice(creator.id);
    const food = await createActivity({ creatorId: creator.id });
    await acceptActivity(food.id, accepter.id);
    await settle();

    const rows = await rowsOf(creator.id, "REQUEST_ACCEPTED");
    expect(Object.fromEntries(rows.map((r) => [r.channel, r.status]))).toEqual({ IN_APP: "SENT", PUSH: "SENT", EMAIL: "SKIPPED" });
    expect(rows.find((r) => r.channel === "EMAIL")?.failureReason).toBe("EMAIL_OFF");
    expect(sentEmails).toEqual([]);
  });

  it("sends no push to a suspended account", async () => {
    const user = await verifiedUser();
    await subscribeDevice(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { accountStatus: "SUSPENDED", suspendedUntil: fromNow(DAY) } });
    await notify({ type: "ANNOUNCEMENT", userIds: [user.id], dedupeKey: "ANNOUNCEMENT:a1", data: { title: "Hi", body: "There" } });
    await settle();
    const push = (await rowsOf(user.id, "ANNOUNCEMENT")).find((r) => r.channel === "PUSH");
    expect(push).toMatchObject({ status: "SKIPPED", failureReason: "ACCOUNT_LOCKED" });
    expect(sentPushes).toEqual([]);
  });

  it("writes the text in the recipient's saved language", async () => {
    const user = await registerUser({ studentVerificationStatus: "VERIFIED", language: "BN" });
    await subscribeDevice(user.id);
    await notify({ type: "REQUEST_EXPIRED", userIds: [user.id], dedupeKey: "REQUEST_EXPIRED:x", data: { activityType: "FOOD" } });
    await notify({ type: "DISPUTE_UPDATED", userIds: [user.id], dedupeKey: "DISPUTE_UPDATED:x", data: { activityType: "FOOD" } });
    await settle();
    const list = await api().get("/api/notifications").set(bearer(user.accessToken));
    expect(list.body.notifications.map((n: { title: string }) => n.title)).toEqual(["বিরোধের আপডেট", "অনুরোধের মেয়াদ শেষ"]);
    expect(sentPushes[0].payload.title).toBe("বিরোধের আপডেট");
    expect(sentEmails[0].subject).toBe("বিরোধের আপডেট");
  });
});
