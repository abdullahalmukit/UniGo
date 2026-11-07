import type { ActivityStatus, ActivitySubStatus, ActivityType, Prisma } from "../../generated/prisma/client.js";
import type { ChatEvent } from "./chat-events.js";

// Chat writes that happen inside an activity transaction (B2b decisions 3
// and 4). Called by the activity engine, so a chat and its system messages
// commit together with the status change, or not at all.

type Tx = Prisma.TransactionClient;

type ChatSubject = { id: string; type: ActivityType; creatorId: string; accepterId: string | null };
type State = { status: ActivityStatus; subStatus: ActivitySubStatus | null };

// Translated on the client (chat.system.*). Carpool sessions use their own
// codes, because they are posted in the booking's chat.
export type SystemCode =
  | "ACCEPTED"
  | "STARTED"
  | "COMPLETION_REQUESTED"
  | "COMPLETED"
  | "CANCELLED"
  | "DISPUTED"
  | "NOT_MARKED"
  // B4: food order details confirmed by both (ACCEPTED -> ORDER_CONFIRMED)
  | "ORDER_CONFIRMED"
  // B6a: both pressed Agree on a held carpool seat (-> CONTRACT_ACTIVE)
  | "CONTRACT_ACTIVE";

// B4: food messages written by the food module, not by a status change
export type FoodSystemCode = "ORDER_UPDATED" | "BUDGET_APPROVED" | "BUDGET_REJECTED" | "RECEIPT_UPLOADED";
// B6a: one participant pressed Agree; the other still has to
export type CarpoolSystemCode = "CONTRACT_AGREED";

// The key events of proposal section 13, plus NOT_MARKED (B2b decision 4), so
// a chat never turns read-only without saying why.
export function systemCodeFor(before: State, after: State): SystemCode | null {
  if (after.status === "ACCEPTED" && before.status === "OPEN") return "ACCEPTED";
  if (after.status === "ACCEPTED" && after.subStatus === "ORDER_CONFIRMED" && before.subStatus !== "ORDER_CONFIRMED") return "ORDER_CONFIRMED";
  if (after.status === "ACCEPTED" && after.subStatus === "CONTRACT_ACTIVE" && before.subStatus !== "CONTRACT_ACTIVE") return "CONTRACT_ACTIVE";
  if (after.status === "IN_PROGRESS" && before.status === "ACCEPTED") return "STARTED";
  if (after.status === "IN_PROGRESS" && after.subStatus === "COMPLETION_REQUESTED" && before.subStatus !== "COMPLETION_REQUESTED") {
    return "COMPLETION_REQUESTED";
  }
  if (after.status === "COMPLETED") return "COMPLETED";
  if (after.status === "CANCELLED") return "CANCELLED";
  if (after.status === "DISPUTED") return "DISPUTED";
  if (after.status === "NOT_MARKED") return "NOT_MARKED";
  return null;
}

// One chat per activity (per booking for seat-based posts). Created when the
// activity is accepted or booked, or when the rider accepts a carpool booking
// request. Carpool sessions have no chat of their own.
export async function openChat(tx: Tx, activityId: string) {
  return tx.chat.upsert({ where: { activityId }, create: { activityId }, update: {}, select: { id: true } });
}

// The chat an activity's messages go to: its own, or for a carpool session
// the chat of the booking it belongs to.
async function chatIdFor(tx: Tx, activity: ChatSubject) {
  if (activity.type === "CARPOOL_SESSION") {
    const session = await tx.carpoolSession.findUnique({
      where: { activityId: activity.id },
      select: { contract: { select: { booking: { select: { activityId: true } } } } },
    });
    const bookingActivityId = session?.contract.booking.activityId;
    if (!bookingActivityId) return null;
    return (await tx.chat.findUnique({ where: { activityId: bookingActivityId }, select: { id: true } }))?.id ?? null;
  }
  return (await tx.chat.findUnique({ where: { activityId: activity.id }, select: { id: true } }))?.id ?? null;
}

// Writes the system message for a status change, if the change has one and
// the activity has a chat. `senderId` is the user who made the change (null
// for the system or an admin): the client shows "You …" or "The other user …",
// and the actor never gets their own change as unread. `body` carries a
// cancellation reason, or nothing when it must stay private (a block).
export async function postTransitionMessage(
  tx: Tx,
  activity: ChatSubject,
  before: State,
  after: State,
  options: { senderId: string | null; body: string | null },
): Promise<ChatEvent | null> {
  const code = systemCodeFor(before, after);
  if (!code) return null;
  if (code === "ACCEPTED" && activity.type !== "CARPOOL_SESSION") await openChat(tx, activity.id);
  const chatId = await chatIdFor(tx, activity);
  if (!chatId) return null;

  const systemCode = activity.type === "CARPOOL_SESSION" ? `SESSION_${code}` : code;
  const message = await tx.message.create({
    data: { chatId, kind: "SYSTEM", senderId: options.senderId, systemCode, body: options.body },
    select: { id: true, createdAt: true },
  });
  await tx.chat.update({ where: { id: chatId }, data: { lastMessageAt: message.createdAt } });

  const participantIds = [activity.creatorId, activity.accepterId].filter((id): id is string => !!id);
  return { kind: "message", chatId, messageId: message.id, participantIds };
}

// B4: a message in a food chat that is not a status change: a system line
// (order details saved, approval decided), an approval card (kind APPROVAL,
// refId = the approval) or the receipt photo (kind IMAGE). Inside the
// caller's transaction; the event is published after commit. B6a uses the
// system line for a carpool Agree (CONTRACT_AGREED).
export async function postFoodMessage(
  tx: Tx,
  activity: ChatSubject,
  message:
    | { kind: "SYSTEM"; code: FoodSystemCode | CarpoolSystemCode; senderId: string | null; body?: string | null }
    | { kind: "APPROVAL"; senderId: string; refId: string }
    | { kind: "IMAGE"; senderId: string; attachmentKey: string },
): Promise<ChatEvent | null> {
  const chatId = await chatIdFor(tx, activity);
  if (!chatId) return null;
  const data =
    message.kind === "SYSTEM"
      ? { kind: "SYSTEM" as const, senderId: message.senderId, systemCode: message.code, body: message.body ?? null }
      : message.kind === "APPROVAL"
        ? { kind: "APPROVAL" as const, senderId: message.senderId, refId: message.refId }
        : { kind: "IMAGE" as const, senderId: message.senderId, attachmentKey: message.attachmentKey, attachmentMimeType: "image/jpeg" };
  const created = await tx.message.create({ data: { chatId, ...data }, select: { id: true, createdAt: true } });
  await tx.chat.update({ where: { id: chatId }, data: { lastMessageAt: created.createdAt } });
  const participantIds = [activity.creatorId, activity.accepterId].filter((id): id is string => !!id);
  return { kind: "message", chatId, messageId: created.id, participantIds };
}
