import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { rules } from "../config/rules.js";

// Delayed one-off jobs (B2a decision 10). BullMQ in development and
// production; tests record the jobs in memory (`scheduledJobs`) and call the
// handlers directly, so they never need Redis.

export const QUEUE_NAME = "unigo";

export type TimerJobName = "activity-expire" | "activity-not-marked" | "activity-auto-complete" | "ride-offer-close";

export type TimerJob = {
  name: TimerJobName;
  // Deterministic: <name>-<activity or offer id>-<due time in ms>. Adding the
  // same job twice is a no-op, and an edit that moves the time gives a new id.
  // BullMQ does not allow ":" in custom ids, so the parts are joined by "-".
  jobId: string;
  runAt: Date;
  data: { id: string };
};

// Finished and failed jobs are removed at once (B2a decision 10), so Redis
// keeps nothing and the same id can be queued again later. A job that failed
// every attempt is caught by the sweeper.
export const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: true,
  attempts: rules.jobs.attempts,
  backoff: { type: "exponential", delay: 5000 },
} as const;

// For tests: every timer job queued, by id.
export const scheduledJobs = new Map<string, TimerJob>();

export function createRedisConnection(options: { failFast?: boolean } = {}) {
  return new Redis(env.REDIS_URL, {
    // Required by BullMQ for blocking connections
    maxRetriesPerRequest: null,
    // Fail at once while Redis is down instead of holding up a request
    enableOfflineQueue: !options.failFast,
  });
}

let timerQueue: Queue | undefined;

function getTimerQueue() {
  timerQueue ??= new Queue(QUEUE_NAME, { connection: createRedisConnection({ failFast: true }), defaultJobOptions });
  return timerQueue;
}

// Queues the jobs. Called only after the database transaction has committed,
// so a rolled-back change never leaves a job behind. A job that cannot be
// queued (Redis down) is logged; the sweeper does its work later.
export async function scheduleTimerJobs(jobs: readonly TimerJob[]) {
  for (const job of jobs) {
    if (env.jobsDriver === "memory") {
      scheduledJobs.set(job.jobId, job);
      continue;
    }
    try {
      await getTimerQueue().add(job.name, job.data, { jobId: job.jobId, delay: Math.max(0, job.runAt.getTime() - Date.now()) });
    } catch (error) {
      console.error(`Could not queue job ${job.name}; the sweeper will handle it: ${message(error)}`);
    }
  }
}

// Removes jobs that are no longer needed. Best effort: a job that still runs
// re-reads the database and changes nothing.
export async function removeTimerJobs(jobIds: readonly string[]) {
  for (const jobId of jobIds) {
    if (env.jobsDriver === "memory") {
      scheduledJobs.delete(jobId);
      continue;
    }
    try {
      await getTimerQueue().remove(jobId);
    } catch (error) {
      console.error(`Could not remove job ${jobId}: ${message(error)}`);
    }
  }
}

export async function closeTimerQueue() {
  const queue = timerQueue;
  timerQueue = undefined;
  await queue?.close();
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
