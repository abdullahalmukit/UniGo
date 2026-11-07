import type { AccountStatus, Prisma } from "../../generated/prisma/client.js";
import { disconnectUserSockets } from "../../sockets/registry.js";
import { runInBackground } from "../../utils/background.js";
import { notifyParticipantsOfLockedUser } from "../notifications/activity-notifications.js";
import { afterActivityCommit, applyTransition, engineActivitySelect, type TransitionOutcome } from "../activities/engine.js";
import type { ActorRef } from "../activities/transitions.js";

export type AccountLockResult = {
  // Status changes to pass to afterActivityCommit() once the transaction commits
  outcomes: TransitionOutcome[];
  // The user's accepted and ongoing activities, which stay as they are; the
  // other participant of each one is notified (B2c).
  acceptedActivityIds: string[];
};

// Runs when a user is restricted, suspended or banned (proposal section 17.1),
// inside the transaction that changed the account status:
// - the rider is set Inactive (B1 decision 8), so they leave matching at once;
// - the user's OPEN requests are cancelled (closure ACCOUNT_MODERATED), and so
//   are OPEN carpool booking requests they sent or received;
// - their OPEN and FULL ride offers and carpool posts are CLOSED. Bookings
//   already accepted on them carry on.
export async function onAccountLocked(
  db: Prisma.TransactionClient,
  userId: string,
  actor: Extract<ActorRef, { type: "ADMIN" | "SYSTEM" }>,
  now = new Date(),
): Promise<AccountLockResult> {
  await db.user.updateMany({ where: { id: userId, riderActive: true }, data: { riderActive: false } });

  const open = await db.activity.findMany({
    where: {
      status: "OPEN",
      deletedAt: null,
      OR: [
        { creatorId: userId, type: { in: ["RIDE_REQUEST", "FOOD", "SERVICE", "CARPOOL_BOOKING"] } },
        { accepterId: userId, type: "CARPOOL_BOOKING" },
      ],
    },
    select: engineActivitySelect,
  });
  const outcomes: TransitionOutcome[] = [];
  for (const activity of open) {
    const outcome = await applyTransition(db, activity, "MODERATION_CLOSE", actor, { now, quiet: true });
    if (outcome) outcomes.push(outcome);
  }

  await db.rideOffer.updateMany({ where: { riderId: userId, status: { in: ["OPEN", "FULL"] } }, data: { status: "CLOSED", closedAt: now } });
  await db.carpoolPost.updateMany({ where: { riderId: userId, status: { in: ["OPEN", "FULL"] } }, data: { status: "CLOSED", closedAt: now } });

  const accepted = await db.activity.findMany({
    where: {
      status: { in: ["ACCEPTED", "IN_PROGRESS"] },
      deletedAt: null,
      OR: [{ creatorId: userId }, { accepterId: userId }],
    },
    select: { id: true },
  });

  return { outcomes, acceptedActivityIds: accepted.map((a) => a.id) };
}

// After the transaction has committed: queue the jobs and push the system
// messages of the closed items, and disconnect every socket of a suspended or
// banned account at once (B2b decision 5). A restricted user keeps chatting.
// The other participants of the accepted activities are notified (B2c).
export async function afterAccountLocked(userId: string, result: AccountLockResult, status: AccountStatus) {
  await afterActivityCommit(result.outcomes);
  if (status === "SUSPENDED" || status === "BANNED") disconnectUserSockets(userId);
  runInBackground("locked account notifications", () => notifyParticipantsOfLockedUser(userId, result.acceptedActivityIds, status));
}
