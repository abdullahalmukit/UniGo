import { prisma } from "../lib/prisma.js";
import { afterAccountLocked, onAccountLocked } from "../modules/admin/account-hooks.js";
import { notify } from "../modules/notifications/notify.service.js";
import { validLicenceFilter } from "../modules/riders/rider-status.js";
import { dhakaDateString } from "../utils/time.js";

// Ends temporary statuses (CLAUDE.md section 8, A8 decision 5):
// - starts a suspension booked for later once its start date arrives;
// - returns a suspension to ACTIVE at its end date and notifies the user;
// - returns a restriction with an end date to ACTIVE and notifies the user;
// - sets riders with an expired licence Inactive and notifies them (B1, B2c);
// - lifts rider suspensions at their end date and notifies the rider (B1).
// Notifications are in-app and email, always sent (B2c), each with a fixed
// dedupe key, so a second run never sends one twice.
// Idempotent: every change is conditional on the state it was found in, so a
// second run (or two servers) changes nothing twice. Not an admin action, so
// no Audit Log row; the original suspend or restrict entry holds the end date.
//
// Since B2a it runs as a repeating BullMQ job every
// rules.jobs.accountStatusInterval (jobs/worker.ts), which also covers the
// licence-expiry auto-Inactive check below.

const BATCH = 100;

export async function runAccountStatusJob(now = new Date()) {
  const started = await startBookedSuspensions(now);
  const suspensionsEnded = await endSuspensions(now);
  const restrictionsEnded = await endRestrictions(now);
  const ridersDeactivated = await deactivateExpiredLicences(now);
  const riderSuspensionsEnded = await endRiderSuspensions(now);
  return { started, suspensionsEnded, restrictionsEnded, ridersDeactivated, riderSuspensionsEnded };
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
    const { changed, locked } = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { ...where, id },
        data: { accountStatus: "SUSPENDED", restrictedUntil: null },
      });
      return { changed: result.count, locked: result.count === 1 ? await onAccountLocked(tx, id, { type: "SYSTEM" }, now) : null };
    });
    if (locked) await afterAccountLocked(id, locked, "SUSPENDED");
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
    select: { id: true, suspendedUntil: true, restrictedUntil: true },
    take: BATCH,
  });
  let count = 0;
  for (const user of users) {
    const result = await prisma.user.updateMany({ where: { ...where, id: user.id }, data });
    if (result.count === 0) continue;
    count += 1;
    const ended = (kind === "SUSPENSION_ENDED" ? user.suspendedUntil : user.restrictedUntil)?.getTime() ?? 0;
    await notify({
      type: "ACCOUNT_STATUS_CHANGED",
      userIds: [user.id],
      dedupeKey: `ACCOUNT_STATUS_CHANGED:${kind}:${user.id}:${ended}`,
      data: { kind },
    });
  }
  return count;
}

// B1 decision 6: an Active rider whose licence expiry day has ended (Asia/Dhaka)
// is set Inactive. They can switch Active again once a re-verification with a
// later expiry date is approved. B2c: the rider is told (RIDER_ACCESS_CHANGED,
// in-app and email, always sent).
async function deactivateExpiredLicences(now: Date) {
  const where = { riderActive: true, riderApplications: { none: validLicenceFilter(now) } };
  const users = await prisma.user.findMany({ where, select: { id: true }, take: BATCH });
  let count = 0;
  for (const { id } of users) {
    const result = await prisma.user.updateMany({ where: { ...where, id }, data: { riderActive: false } });
    if (result.count === 0) continue;
    count += 1;
    await notify({
      type: "RIDER_ACCESS_CHANGED",
      userIds: [id],
      dedupeKey: `RIDER_ACCESS_CHANGED:LICENCE_EXPIRED:${id}:${dhakaDateString(now)}`,
      data: { kind: "LICENCE_EXPIRED" },
    });
  }
  return count;
}

// B1 decision 8: a rider suspension with an end date is lifted then. The rider
// stays Inactive until they switch Active themselves.
function endRiderSuspensions(now: Date) {
  return endEachRider({ riderSuspended: true, riderSuspendedUntil: { lte: now } });
}

async function endEachRider(where: Record<string, unknown>) {
  const users = await prisma.user.findMany({
    where,
    select: { id: true, riderSuspendedUntil: true },
    take: BATCH,
  });
  let count = 0;
  for (const user of users) {
    const result = await prisma.user.updateMany({
      where: { ...where, id: user.id },
      data: { riderSuspended: false, riderSuspendedUntil: null },
    });
    if (result.count === 0) continue;
    count += 1;
    await notify({
      type: "RIDER_ACCESS_CHANGED",
      userIds: [user.id],
      dedupeKey: `RIDER_ACCESS_CHANGED:SUSPENSION_ENDED:${user.id}:${user.riderSuspendedUntil?.getTime() ?? 0}`,
      data: { kind: "SUSPENSION_ENDED" },
    });
  }
  return count;
}
