import { rules } from "../../config/rules.js";
import { AppError } from "../../utils/app-error.js";
import { dhakaDateString } from "../../utils/time.js";
import { conflictRange, windowsOverlap } from "./time-rules.js";
import type { Tx } from "./transaction.js";

export type ConflictCheck = {
  // Both participants. Their rows must already be locked (lockUsers).
  userIds: readonly string[];
  // Start times of the new commitment: one for a ride, food or service
  // accept; every session of a carpool contract (B6a).
  slots: readonly Date[];
  // The activities being accepted or booked themselves
  excludeActivityIds?: readonly string[];
  // Activities of the same parent post never conflict with each other
  conflictGroupId?: string | null;
  // B6a: name the clashing days (Asia/Dhaka dates) in the error's data
  listDates?: boolean;
};

// The global 90-minute check (CLAUDE.md 5.5), run inside the accept
// transaction. Only ACCEPTED and IN_PROGRESS activities that block time count,
// across every feature, where either user is a participant.
export async function assertNoTimeConflict(tx: Tx, check: ConflictCheck) {
  if (check.slots.length === 0 || check.userIds.length === 0) return;
  const userIds = [...check.userIds];
  const exclude = [...(check.excludeActivityIds ?? [])];

  const where = {
    status: { in: ["ACCEPTED" as const, "IN_PROGRESS" as const] },
    blocksTime: true,
    deletedAt: null,
    ...(exclude.length > 0 && { id: { notIn: exclude } }),
    AND: [
      { OR: [{ creatorId: { in: userIds } }, { accepterId: { in: userIds } }] },
      {
        OR: check.slots.map((slot) => {
          const { after, before } = conflictRange(slot);
          return { startTime: { gt: after, lt: before } };
        }),
      },
      ...(check.conflictGroupId ? [{ OR: [{ conflictGroupId: null }, { conflictGroupId: { not: check.conflictGroupId } }] }] : []),
    ],
  };

  if (!check.listDates) {
    const conflict = await tx.activity.findFirst({ where, select: { id: true } });
    if (conflict) throw timeConflict();
    return;
  }

  // B6a: every slot that clashes, as Asia/Dhaka dates, so a carpool contract
  // can say which ride days are the problem.
  const clashes = await tx.activity.findMany({ where, select: { startTime: true } });
  if (clashes.length === 0) return;
  const dates = [
    ...new Set(check.slots.filter((slot) => clashes.some((c) => windowsOverlap(slot, c.startTime))).map((slot) => dhakaDateString(slot))),
  ].sort();
  throw timeConflict(dates.slice(0, rules.carpool.conflictDatesMax), dates.length);
}

function timeConflict(dates?: string[], total?: number) {
  return new AppError(
    409,
    "TIME_CONFLICT",
    "You or the other person already has an activity within 90 minutes of this time",
    dates ? { data: { dates, total } } : undefined,
  );
}
