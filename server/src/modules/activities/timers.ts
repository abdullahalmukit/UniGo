import { rules } from "../../config/rules.js";
import type { ActivityStatus, ActivitySubStatus, ActivityType } from "../../generated/prisma/client.js";
import { removeTimerJobs, scheduleTimerJobs, type TimerJob, type TimerJobName } from "../../jobs/scheduler.js";
import { dhakaDateString, dhakaWallTime } from "../../utils/time.js";
import { NOT_MARKED_TYPES, OPEN_REQUEST_TYPES } from "./transitions.js";

// Which delayed jobs an activity needs in its current state (CLAUDE.md
// section 8). The jobs carry only the id; each handler re-reads the database.

export type TimerSubject = {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  subStatus: ActivitySubStatus | null;
  startTime: Date;
  completionRequestedAt: Date | null;
  // B2c reminders: a service request without a time (false) gets none
  blocksTime?: boolean;
};

// B2c: the 30-minute reminder (proposal section 14) for these types; carpool
// sessions get the ride-day reminder instead (developer decision Q4).
export const REMINDER_TYPES = ["RIDE_REQUEST", "RIDE_BOOKING", "FOOD", "SERVICE"] as const satisfies readonly ActivityType[];

// When an accepted activity's reminder is due, or null when it gets none.
// The caller also needs the activity to have been accepted before this time:
// an activity accepted later gets no reminder (B2c decision).
export function reminderTimeFor(activity: { type: ActivityType; startTime: Date; blocksTime?: boolean }): Date | null {
  if (activity.type === "CARPOOL_SESSION") {
    const { hour, minute } = rules.notifications.carpoolReminderAt;
    const morning = dhakaWallTime(dhakaDateString(activity.startTime), hour, minute);
    const lead = new Date(activity.startTime.getTime() - rules.notifications.carpoolReminderLeadTime);
    return morning < lead ? morning : lead;
  }
  if (!includes(REMINDER_TYPES, activity.type) || activity.blocksTime === false) return null;
  return new Date(activity.startTime.getTime() - rules.notifications.reminderBeforeStart);
}

const includes = (types: readonly ActivityType[], type: ActivityType) => types.includes(type);

const job = (name: TimerJobName, id: string, runAt: Date): TimerJob => ({
  name,
  jobId: `${name}-${id}-${runAt.getTime()}`,
  runAt,
  data: { id },
});

export function timerJobsFor(activity: TimerSubject, now = new Date()): TimerJob[] {
  const jobs: TimerJob[] = [];
  if (activity.status === "OPEN" && includes(OPEN_REQUEST_TYPES, activity.type)) {
    jobs.push(job("activity-expire", activity.id, activity.startTime));
  }
  if (activity.status === "ACCEPTED" && includes(NOT_MARKED_TYPES, activity.type) && activity.subStatus !== "COMPLETION_REQUESTED") {
    jobs.push(job("activity-not-marked", activity.id, new Date(activity.startTime.getTime() + rules.activity.notMarkedAfterStart)));
  }
  if (activity.status === "IN_PROGRESS" && activity.subStatus === "COMPLETION_REQUESTED" && activity.completionRequestedAt) {
    jobs.push(
      job("activity-auto-complete", activity.id, new Date(activity.completionRequestedAt.getTime() + rules.activity.autoCompleteAfter)),
    );
  }
  // B2c: reminders, only while ACCEPTED and only if still ahead (an activity
  // accepted after its reminder time gets none).
  if (activity.status === "ACCEPTED") {
    const remindAt = reminderTimeFor(activity);
    if (remindAt && remindAt > now) {
      jobs.push(job(activity.type === "CARPOOL_SESSION" ? "carpool-session-reminder" : "activity-reminder", activity.id, remindAt));
    }
  }
  return jobs;
}

// A ride offer closes at its departure time (B2a decision 7).
export function rideOfferCloseJob(offer: { id: string; departureTime: Date }) {
  return job("ride-offer-close", offer.id, offer.departureTime);
}

export function scheduleActivityTimers(activities: readonly TimerSubject[]) {
  return scheduleTimerJobs(activities.flatMap((activity) => timerJobsFor(activity)));
}

// After a change, removes the jobs the old state needed and the new one does not.
export async function replaceActivityTimers(before: TimerSubject, after: TimerSubject) {
  const next = new Set(timerJobsFor(after).map((j) => j.jobId));
  await removeTimerJobs(timerJobsFor(before).map((j) => j.jobId).filter((id) => !next.has(id)));
  await scheduleActivityTimers([after]);
}

// Edits of an OPEN item (B2a decision 5): when the start time changes, the jobs
// for the old time are removed and new ones queued. An old job that runs
// anyway finds the new start time and changes nothing.
export function rescheduleAfterStartChange(activity: TimerSubject, previousStartTime: Date) {
  return replaceActivityTimers({ ...activity, startTime: previousStartTime }, activity);
}

export async function rescheduleRideOfferClose(offer: { id: string; departureTime: Date }, previousDepartureTime: Date) {
  await removeTimerJobs([rideOfferCloseJob({ id: offer.id, departureTime: previousDepartureTime }).jobId]);
  await scheduleTimerJobs([rideOfferCloseJob(offer)]);
}
