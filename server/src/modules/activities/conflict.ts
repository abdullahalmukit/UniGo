import { AppError } from "../../utils/app-error.js";
import { conflictRange } from "./time-rules.js";
import type { Tx } from "./transaction.js";

export type ConflictCheck = {
  // Both participants. Their rows must already be locked (lockUsers).
  userIds: readonly string[];
  // Start times of the new commitment: one for a ride, food or service
  // accept; every session of a carpool contract for B6.
  slots: readonly Date[];
  // The activities being accepted or booked themselves
  excludeActivityIds?: readonly string[];
  // Activities of the same parent post never conflict with each other
  conflictGroupId?: string | null;
};

// The global 90-minute check (CLAUDE.md 5.5), run inside the accept
// transaction. Only ACCEPTED and IN_PROGRESS activities that block time count,
// across every feature, where either user is a participant.
export async function assertNoTimeConflict(tx: Tx, check: ConflictCheck) {
  if (check.slots.length === 0 || check.userIds.length === 0) return;
  const userIds = [...check.userIds];
  const exclude = [...(check.excludeActivityIds ?? [])];

  const conflict = await tx.activity.findFirst({
    where: {
      status: { in: ["ACCEPTED", "IN_PROGRESS"] },
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
        ...(check.conflictGroupId
          ? [{ OR: [{ conflictGroupId: null }, { conflictGroupId: { not: check.conflictGroupId } }] }]
          : []),
      ],
    },
    select: { id: true },
  });

  if (conflict) {
    throw new AppError(409, "TIME_CONFLICT", "You or the other person already has an activity within 90 minutes of this time");
  }
}
