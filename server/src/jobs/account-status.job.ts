import { rules } from "../config/rules.js";
import { prisma } from "../lib/prisma.js";
import { onAccountLocked } from "../modules/admin/account-hooks.js";
import { accountStatusEmail } from "../modules/email/account-status-templates.js";
import { sendEmailInBackground } from "../modules/email/email.service.js";

// Ends temporary statuses (CLAUDE.md section 8, A8 decision 5):
// - starts a suspension booked for later once its start date arrives;
// - returns a suspension to ACTIVE at its end date and emails the user;
// - returns a restriction with an end date to ACTIVE and emails the user.
// Idempotent: every change is conditional on the state it was found in, so a
// second run (or two servers) changes nothing twice. Runs in the API process
// every minute until BullMQ arrives in B2. Not an admin action, so no Audit Log
// row; the original suspend or restrict entry already holds the end date.

const BATCH = 100;

export async function runAccountStatusJob(now = new Date()) {
  const started = await startBookedSuspensions(now);
  const suspensionsEnded = await endSuspensions(now);
  const restrictionsEnded = await endRestrictions(now);
  return { started, suspensionsEnded, restrictionsEnded };
}

async function startBookedSuspensions(now: Date) {
  const where = {
    accountStatus: { in: ["ACTIVE" as const, "RESTRICTED" as const] },
    suspendedFrom: { lte: now },
    suspendedUntil: { gt: now },
  };
  const users = await prisma.user.findMany({ where, select: { id: true }, take: BATCH });
  let count = 0;
  for (const { id } of users) {
    const changed = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { ...where, id },
        data: { accountStatus: "SUSPENDED", restrictedUntil: null },
      });
      if (result.count === 1) await onAccountLocked(tx, id);
      return result.count;
    });
    count += changed;
  }
  return count;
}

async function endSuspensions(now: Date) {
  // A booked suspension whose whole period passed while the job was not running
  // is simply cleared; the user was told about it when it was booked.
  await prisma.user.updateMany({
    where: { accountStatus: { not: "SUSPENDED" }, suspendedUntil: { lte: now } },
    data: { suspendedFrom: null, suspendedUntil: null },
  });

  const where = { accountStatus: "SUSPENDED" as const, suspendedUntil: { lte: now } };
  return endEach(where, { accountStatus: "ACTIVE", suspendedFrom: null, suspendedUntil: null }, "SUSPENSION_ENDED");
}

function endRestrictions(now: Date) {
  const where = { accountStatus: "RESTRICTED" as const, restrictedUntil: { lte: now } };
  return endEach(where, { accountStatus: "ACTIVE", restrictedUntil: null }, "RESTRICTION_ENDED");
}

async function endEach(
  where: Record<string, unknown>,
  data: Record<string, unknown>,
  kind: "SUSPENSION_ENDED" | "RESTRICTION_ENDED",
) {
  const users = await prisma.user.findMany({
    where,
    select: { id: true, email: true, language: true, profile: { select: { fullName: true } } },
    take: BATCH,
  });
  let count = 0;
  for (const user of users) {
    const result = await prisma.user.updateMany({ where: { ...where, id: user.id }, data });
    if (result.count === 0) continue;
    count += 1;
    sendEmailInBackground(kind.toLowerCase(), {
      to: user.email,
      ...accountStatusEmail(user.language, kind, { name: user.profile?.fullName ?? "" }),
    });
  }
  return count;
}

// Starts the every-minute run. Never started in tests; they call the job directly.
export function startAccountStatusJob() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAccountStatusJob();
    } catch (error) {
      console.error(`Account status job failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), rules.jobs.accountStatusInterval);
  void tick();
  return () => clearInterval(timer);
}
