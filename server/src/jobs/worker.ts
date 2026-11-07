import { Queue, Worker, type Job } from "bullmq";
import { rules } from "../config/rules.js";
import { runAccountStatusJob } from "./account-status.job.js";
import { runActivitySweep, runAutoCompleteJob, runCloseRideOfferJob, runExpireJob, runNotMarkedJob } from "./activity-timers.job.js";
import { deliverNotification } from "../modules/notifications/notify.service.js";
import { runSubAreaNotifyJob } from "../modules/notifications/sub-area.service.js";
import { publishReviews } from "../modules/reviews/reviews.service.js";
import { runLicenceReminderJob } from "./licence-reminder.job.js";
import {
  runCarpoolContractEndJob,
  runCarpoolHoldReleaseJob,
  runCarpoolPostCloseJob,
  runCarpoolSessionTimersJob,
} from "../modules/carpool/carpool.jobs.js";
import { runReminderJob } from "./reminders.job.js";
import { closeTimerQueue, createRedisConnection, defaultJobOptions, QUEUE_NAME } from "./scheduler.js";

// BullMQ background jobs (CLAUDE.md section 8, B2a decision 10). Started by the
// API process; never in tests, which call the handlers directly.

type JobResult = boolean | number | Record<string, number>;

export async function processJob(job: Job<{ id?: string }>): Promise<JobResult> {
  const id = job.data?.id ?? "";
  switch (job.name) {
    case "activity-expire":
      return runExpireJob(id);
    case "activity-not-marked":
      return runNotMarkedJob(id);
    case "activity-auto-complete":
      return runAutoCompleteJob(id);
    case "ride-offer-close":
      return runCloseRideOfferJob(id);
    case "activity-sweep":
      return runActivitySweep();
    case "account-status":
      return runAccountStatusJob();
    // B2c
    case "activity-reminder":
    case "carpool-session-reminder":
      return runReminderJob(id);
    case "sub-area-notify":
      return runSubAreaNotifyJob(id);
    case "licence-reminder":
      return runLicenceReminderJob();
    // B3b-2
    case "review-publish":
      return publishReviews(id);
    // B6a
    case "carpool-hold-release":
      return runCarpoolHoldReleaseJob(id);
    case "carpool-contract-end":
      return runCarpoolContractEndJob(id);
    case "carpool-post-close":
      return runCarpoolPostCloseJob(id);
    case "carpool-session-timers":
      return runCarpoolSessionTimersJob();
    case "notification-deliver": {
      // Retried with backoff; the last attempt records FAILED on the row.
      const attempts = job.opts.attempts ?? 1;
      return deliverNotification(id, { lastAttempt: job.attemptsMade + 1 >= attempts });
    }
    default:
      throw new Error(`Unknown job ${job.name}`);
  }
}

// Repeating jobs, each with a fixed scheduler id so restarts never add a second copy.
const REPEATING = [
  { id: "account-status", every: rules.jobs.accountStatusInterval },
  { id: "activity-sweep", every: rules.jobs.sweepInterval },
  { id: "licence-reminder", every: rules.notifications.licenceReminderInterval },
  // B6a: timers of carpool sessions that have come within 7 days
  { id: "carpool-session-timers", every: rules.carpool.sessionTimerInterval },
] as const;

export function startJobs() {
  // This connection waits for Redis, so the schedulers are set as soon as it is up.
  const queue = new Queue(QUEUE_NAME, { connection: createRedisConnection(), defaultJobOptions });
  queue.on("error", (error) => console.error(`Job queue error: ${error.message}`));
  void Promise.all(
    REPEATING.map(({ id, every }) => queue.upsertJobScheduler(id, { every }, { name: id, opts: defaultJobOptions })),
  ).catch((error: unknown) => {
    console.error(`Could not set the repeating jobs: ${error instanceof Error ? error.message : String(error)}`);
  });

  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: createRedisConnection(),
    concurrency: rules.jobs.workerConcurrency,
  });
  // Job data holds ids only, but only the name is logged.
  worker.on("failed", (job, error) => console.error(`Job ${job?.name ?? "?"} failed: ${error.message}`));
  worker.on("error", (error) => console.error(`Job worker error: ${error.message}`));

  return async () => {
    await worker.close();
    await queue.close();
    await closeTimerQueue();
  };
}
