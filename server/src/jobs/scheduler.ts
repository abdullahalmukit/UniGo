import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { rules } from "../config/rules.js";

// Delayed one-off jobs (B2a decision 10). BullMQ in development and
// production; tests record the jobs in memory (`scheduledJobs`) and call the
// handlers directly, so they never need Redis.

export const QUEUE_NAME = "unigo";

export type TimerJobName =
  | "activity-expire"
  | "activity-not-marked"
  | "activity-auto-complete"
  | "ride-offer-close"
  // B2c
  | "activity-reminder"
  | "carpool-session-reminder"
  | "sub-area-notify"
  | "notification-deliver"
  // B3b-2
  | "review-publish";

export type TimerJob = {
  name: TimerJobName;
  // Deterministic: <name>-<activity or offer id>-<due time in ms>. Adding the
  // same job twice is a no-op, and an edit that moves the time gives a new id.
  // BullMQ does not allow ":" in custom ids, so the parts are joined by "-".
  jobId: string;
  runAt: Date;
  data: { id: string };
  // Overrides of defaultJobOptions (B2c: delivery retries)
  attempts?: number;
  backoffMs?: number;
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

export function createRedisConnection(options: { failFast?: boolean; url?: string } = {}) {
  return new Redis(options.url ?? env.REDIS_URL, {
    // Required by BullMQ for blocking connections
    maxRetriesPerRequest: null,
    // Fail at once while Redis is down instead of holding up a request
    enableOfflineQueue: !options.failFast,
  });
}

// The queue used inside requests (after a commit). While Redis is down a
// request must never wait for it (B2b decision 1): once the connection has
// reported an error, every queue call is skipped at once until it is back,
// and any single call gives up after rules.jobs.queueTimeout. The change in
// the database is already committed; the sweeper does the job's work later.
let driver: "memory" | "bullmq" = env.jobsDriver;
let redisUrl = env.REDIS_URL;
let timerQueue: { queue: Queue; connection: Redis } | undefined;
let redisDown = false;

function getTimerQueue() {
  if (!timerQueue) {
    const connection = createRedisConnection({ failFast: true, url: redisUrl });
    connection.on("ready", () => {
      redisDown = false;
    });
    // Logged once per outage, not on every reconnect attempt.
    connection.on("error", (error: Error) => {
      if (!redisDown) console.error(`Redis for background jobs is unreachable; jobs are skipped and the sweeper catches up: ${message(error)}`);
      redisDown = true;
    });
    const queue = new Queue(QUEUE_NAME, { connection, defaultJobOptions });
    // Connection errors are reported by the handler above.
    queue.on("error", () => undefined);
    timerQueue = { queue, connection };
  }
  return timerQueue.queue;
}

async function onTimerQueue(label: string, operation: (queue: Queue) => Promise<unknown>) {
  const queue = getTimerQueue();
  if (redisDown) return false;
  const pending = operation(queue);
  // The call may still finish (or fail) after the timeout; nobody waits for it.
  pending.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${rules.jobs.queueTimeout} ms`)), rules.jobs.queueTimeout);
      }),
    ]);
    return true;
  } catch (error) {
    console.error(`Could not ${label}; the sweeper will handle it: ${message(error)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Queues the jobs. Called only after the database transaction has committed,
// so a rolled-back change never leaves a job behind. Never throws.
export async function scheduleTimerJobs(jobs: readonly TimerJob[]) {
  for (const job of jobs) await queueJob(job);
}

// Queues one job. True when it was queued (or recorded in memory); false when
// Redis is unavailable, so the caller can do the work another way. Never throws.
export async function queueJob(job: TimerJob) {
  if (driver === "memory") {
    scheduledJobs.set(job.jobId, job);
    return true;
  }
  return onTimerQueue(`queue job ${job.name}`, (queue) =>
    queue.add(job.name, job.data, {
      jobId: job.jobId,
      delay: Math.max(0, job.runAt.getTime() - Date.now()),
      ...(job.attempts !== undefined && { attempts: job.attempts }),
      ...(job.backoffMs !== undefined && { backoff: { type: "exponential", delay: job.backoffMs } }),
    }),
  );
}

// Which driver queues jobs now: "memory" in tests (unless a test switched to
// BullMQ), "bullmq" everywhere else.
export function jobsDriver() {
  return driver;
}

// Removes jobs that are no longer needed. Best effort: a job that still runs
// re-reads the database and changes nothing. Never throws.
export async function removeTimerJobs(jobIds: readonly string[]) {
  for (const jobId of jobIds) {
    if (driver === "memory") {
      scheduledJobs.delete(jobId);
      continue;
    }
    await onTimerQueue(`remove job ${jobId}`, (queue) => queue.remove(jobId));
  }
}

export async function closeTimerQueue() {
  const current = timerQueue;
  timerQueue = undefined;
  redisDown = false;
  if (!current) return;
  // close() can wait for a connection that never comes; give it a moment, then drop it.
  await Promise.race([current.queue.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 500))]);
  current.connection.disconnect();
}

// For tests: send jobs to a real BullMQ queue at this URL (e.g. one nobody
// listens on, to test a Redis outage), then switch back.
export async function useBullmqSchedulerForTests(url: string) {
  await closeTimerQueue();
  driver = "bullmq";
  redisUrl = url;
}

export async function resetSchedulerForTests() {
  await closeTimerQueue();
  driver = env.jobsDriver;
  redisUrl = env.REDIS_URL;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
