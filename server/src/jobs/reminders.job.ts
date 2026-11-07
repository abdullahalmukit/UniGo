import { rules } from "../config/rules.js";
import { prisma } from "../lib/prisma.js";
import { REMINDER_TYPES, reminderTimeFor } from "../modules/activities/timers.js";
import { activityContext } from "../modules/notifications/activity-notifications.js";
import { notify } from "../modules/notifications/notify.service.js";

// Reminders (proposal section 14, CLAUDE.md section 8, B2c decisions):
// - ACTIVITY_REMINDER 30 minutes before the start of an accepted ride, food or
//   service request with a time;
// - CARPOOL_SESSION_REMINDER on the ride day: 07:00 Asia/Dhaka, or 60 minutes
//   before the start when that is earlier.
// Both participants, in-app and push. Sent only if the activity is still
// ACCEPTED, was accepted before the reminder time and has not started. The
// dedupe key holds the start time, so a job that runs twice (or the sweeper
// after the job) sends nothing twice.

// A job may fire a little early (clock differences); never more than this.
const EARLY_TOLERANCE = 60 * 1000;

export async function runReminderJob(activityId: string, now = new Date()) {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, deletedAt: null },
    select: { id: true, type: true, status: true, startTime: true, acceptedAt: true, createdAt: true, blocksTime: true, creatorId: true, accepterId: true },
  });
  if (!activity || activity.status !== "ACCEPTED" || !activity.accepterId) return false;
  const due = reminderTimeFor(activity);
  if (!due) return false;
  if (now.getTime() < due.getTime() - EARLY_TOLERANCE || now >= activity.startTime) return false;
  // Accepted after the reminder time: no reminder (carpool sessions are
  // created accepted, so their creation time counts).
  const acceptedAt = activity.acceptedAt ?? activity.createdAt;
  if (acceptedAt > due) return false;

  const type = activity.type === "CARPOOL_SESSION" ? "CARPOOL_SESSION_REMINDER" : "ACTIVITY_REMINDER";
  const participants = [activity.creatorId, activity.accepterId];
  const context = await activityContext(activity.id, activity.type, participants);
  const created = await notify({
    type,
    userIds: participants,
    dedupeKey: `${type}:${activity.id}:${activity.startTime.getTime()}`,
    activityId: activity.id,
    data: { activityType: activity.type, startTime: activity.startTime.toISOString(), chatId: context.chatId ?? undefined },
    dataFor: (userId) => ({ name: context.otherName(userId) }),
  });
  return created.length > 0;
}

// For the sweeper: reminders that are due but were never sent (lost job,
// server down at the time). The same handler decides; already sent ones are
// left out by the query and by the dedupe key.
export async function sendMissedReminders(now = new Date()) {
  const take = rules.jobs.sweepBatch;
  const soon = new Date(now.getTime() + rules.notifications.reminderBeforeStart);
  const ride = await prisma.activity.findMany({
    where: {
      type: { in: [...REMINDER_TYPES] },
      status: "ACCEPTED",
      blocksTime: true,
      deletedAt: null,
      startTime: { gt: now, lte: soon },
      notifications: { none: { type: "ACTIVITY_REMINDER" } },
    },
    select: { id: true },
    take,
  });
  const carpool = await prisma.activity.findMany({
    where: {
      type: "CARPOOL_SESSION",
      status: "ACCEPTED",
      deletedAt: null,
      startTime: { gt: now, lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      notifications: { none: { type: "CARPOOL_SESSION_REMINDER" } },
    },
    select: { id: true, type: true, startTime: true },
    take,
  });
  let sent = 0;
  for (const { id } of ride) if (await runReminderJob(id, now)) sent += 1;
  for (const session of carpool) {
    const due = reminderTimeFor(session);
    if (due && due <= now && (await runReminderJob(session.id, now))) sent += 1;
  }
  return sent;
}
