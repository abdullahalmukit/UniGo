import { rules } from "../../config/rules.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { afterActivityCommit, applyTransition, engineActivitySelect, type TransitionOutcome } from "../activities/engine.js";
import { lockUsers, runActivityTransaction } from "../activities/transaction.js";
import { publishChatEvents } from "../chat/chat-events.js";
import { photoLink } from "./photo.js";

// Blocking (proposal sections 13 and 15.5, B2b decision 8). Blocked users
// cannot send each other messages (their chats stay visible, read-only for
// both), never see each other in matching or sub-area notifications
// (blockedUserIds, used from B2c/B3 on) and cannot accept each other's items
// (B2a). The Blocked Users page lists only name, photo and university, never
// email or phone (A7 decision 11).

type Db = Prisma.TransactionClient | typeof prisma;

// True when either user has blocked the other.
export async function isBlockedBetween(db: Db, a: string, b: string) {
  const block = await db.block.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { blockerId: true },
  });
  return block !== null;
}

// Everyone the user blocked or was blocked by: leave them out of matching and
// sub-area notifications.
export async function blockedUserIds(db: Db, userId: string) {
  const rows = await db.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return [...new Set(rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)))];
}

// Activities the two share that a block affects, either way round.
function between(a: string, b: string) {
  return {
    deletedAt: null,
    OR: [
      { creatorId: a, accepterId: b },
      { creatorId: b, accepterId: a },
    ],
  } satisfies Prisma.ActivityWhereInput;
}

// A carpool contract cannot be cancelled by a block: it ends by early
// termination or a complaint (proposal 9.6, B2b decision 8).
const activeContract = {
  type: "CARPOOL_BOOKING",
  status: { in: ["ACCEPTED", "DISPUTED"] },
  subStatus: "CONTRACT_ACTIVE",
} satisfies Prisma.ActivityWhereInput;

// ACCEPTED, or IN_PROGRESS without a completion request: cancelled by the block.
// COMPLETION_REQUESTED and DISPUTED stay as they are (auto-complete or admin).
const cancelledByBlock = {
  type: { not: "CARPOOL_BOOKING" },
  OR: [{ status: "ACCEPTED" }, { status: "IN_PROGRESS", OR: [{ subStatus: null }, { subStatus: { not: "COMPLETION_REQUESTED" } }] }],
} satisfies Prisma.ActivityWhereInput;

const heldSeat = { type: "CARPOOL_BOOKING", status: "ACCEPTED", subStatus: null } satisfies Prisma.ActivityWhereInput;

// What blocking this user would do, for the confirmation sheet.
export async function blockImpact(blockerId: string, blockedId: string) {
  assertNotSelf(blockerId, blockedId);
  const base = between(blockerId, blockedId);
  const [contract, activities] = await Promise.all([
    prisma.activity.findFirst({ where: { ...base, ...activeContract }, select: { id: true } }),
    prisma.activity.findMany({
      where: { ...base, OR: [cancelledByBlock, heldSeat] },
      select: { id: true, type: true, status: true, startTime: true },
      orderBy: { startTime: "asc" },
    }),
  ]);
  return { refusedForCarpoolContract: contract !== null, cancels: activities };
}

export async function blockUser(blockerId: string, blockedId: string, now = new Date()) {
  assertNotSelf(blockerId, blockedId);
  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) throw new AppError(404, "USER_NOT_FOUND", "User not found");

  // Both users locked first, like an accept, so nothing new can be accepted
  // between them while the block is written.
  const result = await runActivityTransaction(async (tx) => {
    await lockUsers(tx, [blockerId, blockedId]);
    const existing = await tx.block.findUnique({ where: { blockerId_blockedId: { blockerId, blockedId } }, select: { blockerId: true } });
    if (existing) return { outcomes: [] as TransitionOutcome[], alreadyBlocked: true };

    const base = between(blockerId, blockedId);
    if (await tx.activity.findFirst({ where: { ...base, ...activeContract }, select: { id: true } })) {
      throw new AppError(409, "BLOCK_CARPOOL_CONTRACT", "You share a carpool contract with this user. End it early or file a complaint first.");
    }

    // Each shared activity is cancelled by the blocker through the normal
    // CANCEL step: who cancelled and the late-cancellation flag are recorded
    // as usual; the reason "Blocked" stays in the history (hideReason).
    const active = await tx.activity.findMany({ where: { ...base, OR: [cancelledByBlock, heldSeat] }, select: engineActivitySelect });
    const outcomes: TransitionOutcome[] = [];
    for (const activity of active) {
      const outcome = await applyTransition(tx, activity, "CANCEL", { type: "USER", id: blockerId }, {
        now,
        reason: rules.chat.blockCancellationReason,
        hideReason: true,
        quiet: true,
      });
      if (outcome) outcomes.push(outcome);
    }

    await tx.block.create({ data: { blockerId, blockedId } });
    return { outcomes, alreadyBlocked: false };
  });

  await afterActivityCommit(result.outcomes);
  if (!result.alreadyBlocked) {
    // Both users' open chats turn read-only and hide the phone at once.
    const chats = await prisma.chat.findMany({ where: { activity: between(blockerId, blockedId) }, select: { id: true } });
    publishChatEvents(chats.map((chat) => ({ kind: "changed", chatId: chat.id, participantIds: [blockerId, blockedId] })));
  }
  return { cancelledActivityIds: result.outcomes.map((outcome) => outcome.activity.id) };
}

function assertNotSelf(blockerId: string, blockedId: string) {
  if (blockerId === blockedId) throw new AppError(400, "CANNOT_BLOCK_SELF", "You cannot block yourself");
}

export async function listBlockedUsers(blockerId: string) {
  const rows = await prisma.block.findMany({
    where: { blockerId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      blocked: {
        select: {
          id: true,
          university: { select: { name: true, shortName: true } },
          profile: { select: { fullName: true, photoKey: true } },
        },
      },
    },
  });

  return Promise.all(
    rows.map(async ({ createdAt, blocked }) => ({
      id: blocked.id,
      name: blocked.profile?.fullName ?? "",
      university: blocked.university,
      photo: await photoLink(blocked.profile?.photoKey),
      blockedAt: createdAt,
    })),
  );
}

// Unblocking lets them message each other again in chats that are still active.
export async function unblockUser(blockerId: string, blockedId: string) {
  const { count } = await prisma.block.deleteMany({ where: { blockerId, blockedId } });
  if (count === 0) throw new AppError(404, "BLOCK_NOT_FOUND", "This user is not blocked");
  const chats = await prisma.chat.findMany({ where: { activity: between(blockerId, blockedId) }, select: { id: true } });
  publishChatEvents(chats.map((chat) => ({ kind: "changed", chatId: chat.id, participantIds: [blockerId, blockedId] })));
}
