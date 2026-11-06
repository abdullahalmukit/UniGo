import { rules } from "../../config/rules.js";
import type { ActivityStatus, ActivitySubStatus, ActivityType } from "../../generated/prisma/client.js";
import { removeTimerJobs, scheduleTimerJobs, type TimerJob, type TimerJobName } from "../../jobs/scheduler.js";
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
};

const job = (name: TimerJobName, id: string, runAt: Date): TimerJob => ({
  name,
  jobId: `${name}-${id}-${runAt.getTime()}`,
  runAt,
  data: { id },
});

const includes = (types: readonly ActivityType[], type: ActivityType) => types.includes(type);

export function timerJobsFor(activity: TimerSubject): TimerJob[] {
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
  return jobs;
}

// A ride offer closes at its departure time (B2a decision 7).
export function rideOfferCloseJob(offer: { id: string; departureTime: Date }) {
  return job("ride-offer-close", offer.id, offer.departureTime);
}

export function scheduleActivityTimers(activities: readonly TimerSubject[]) {
  return scheduleTimerJobs(activities.flatMap(timerJobsFor));
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
