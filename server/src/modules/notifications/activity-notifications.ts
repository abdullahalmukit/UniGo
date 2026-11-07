import type { ActivityType, NotificationType } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { effectiveAccountStatus, accountStatusSelect } from "../auth/account-status.js";
import type { ActivityTransitionEvent } from "../activities/events.js";
import type { NotificationData } from "./catalogue.js";
import { notify } from "./notify.service.js";

// Activity status changes -> section 14 rows. Called after the change has
// committed (onActivityTransition). Each event has a fixed dedupe key, so a
// repeated event (a job that ran twice) notifies nobody twice.
//
// Not in the section 14 table, so only the chat system message tells about
// them: START, CONFIRM_ORDER, COLLECT_FOOD, CONFIRM_COMPLETION,
// COMPLETE_SESSION, END_CONTRACT and DELETE.

type Plan = { type: NotificationType; to: string[]; kind?: string };

export async function notifyTransition(event: ActivityTransitionEvent) {
  const { creatorId, accepterId } = event;
  const participants = [creatorId, accepterId].filter((id): id is string => !!id);
  const actorId = event.actor.type === "USER" ? event.actor.id : null;
  const others = (userId: string | null) => participants.filter((id) => id !== userId);

  const plans: Plan[] = [];
  switch (event.action) {
    case "ACCEPT":
      plans.push({ type: event.type === "RIDE_BOOKING" ? "SEAT_BOOKED" : "REQUEST_ACCEPTED", to: [creatorId] });
      break;
    case "ACCEPT_BOOKING":
      if (accepterId) plans.push({ type: "CARPOOL_BOOKING_ACCEPTED", to: [accepterId] });
      break;
    case "REJECT_BOOKING":
      if (accepterId) plans.push({ type: "CARPOOL_BOOKING_REJECTED", to: [accepterId] });
      break;
    case "AGREE_CONTRACT":
      if (event.to.subStatus === "CONTRACT_ACTIVE") plans.push({ type: "CARPOOL_CONTRACT_CREATED", to: participants });
      break;
    case "REQUEST_COMPLETION":
    case "DELIVER_SERVICE":
      plans.push({ type: "COMPLETION_REQUESTED", to: others(actorId) });
      break;
    case "AUTO_COMPLETE":
      plans.push({ type: "AUTO_COMPLETED", to: participants });
      break;
    case "MARK_NOT_MARKED":
      plans.push({ type: "AUTO_CLOSED_NOT_MARKED", to: participants });
      break;
    case "CANCEL":
    case "TERMINATE_CONTRACT":
    case "WITHDRAW_BOOKING":
      plans.push({ type: "ACTIVITY_CANCELLED", to: actorId ? others(actorId) : participants, kind: actorId ? "USER" : "UNIGO" });
      break;
    case "RELEASE_HOLD":
      plans.push({ type: "ACTIVITY_CANCELLED", to: participants, kind: "HOLD_EXPIRED" });
      break;
    case "ADMIN_CANCEL":
      plans.push({ type: "ACTIVITY_CANCELLED", to: participants, kind: "UNIGO" });
      break;
    case "MODERATION_CLOSE":
      // An OPEN item of a locked account. Only a carpool booking request has
      // another participant: the one whose account is still active is told.
      if (accepterId) plans.push({ type: "ACTIVITY_CANCELLED", to: await activeUsers(participants, event.at), kind: "UNIGO" });
      break;
    case "DISPUTE":
      plans.push({ type: "DISPUTE_OPENED", to: participants });
      break;
    case "RESOLVE_COMPLETED":
    case "RESOLVE_CANCELLED":
      plans.push({ type: "DISPUTE_RESOLVED", to: participants, kind: event.action === "RESOLVE_CANCELLED" ? "CANCELLED" : "COMPLETED" });
      break;
    case "EXPIRE":
      // B6a: a carpool booking request is the passenger's (the accepter);
      // the rider never answered it.
      plans.push({ type: "REQUEST_EXPIRED", to: event.type === "CARPOOL_BOOKING" && accepterId ? [accepterId] : [creatorId] });
      break;
    default:
      break;
  }
  if (plans.length === 0) return;

  const context = await activityContext(event.activityId, event.type, participants);
  for (const plan of plans) {
    await notify({
      type: plan.type,
      userIds: plan.to,
      dedupeKey: `${plan.type}:${event.activityId}`,
      activityId: event.activityId,
      data: { activityType: event.type, chatId: context.chatId ?? undefined, ...(plan.kind && { kind: plan.kind }) },
      dataFor: (userId) => ({ name: context.otherName(userId) }),
    });
  }
}

// Names of both participants (to show the *other* one) and the chat to open.
export async function activityContext(activityId: string, type: ActivityType, participants: readonly string[]) {
  const [profiles, chatId] = await Promise.all([
    prisma.profile.findMany({ where: { userId: { in: [...participants] } }, select: { userId: true, fullName: true } }),
    chatIdForActivity(activityId, type),
  ]);
  const names = new Map(profiles.map((p) => [p.userId, p.fullName]));
  return {
    chatId,
    otherName: (userId: string): string | undefined => {
      const other = participants.find((id) => id !== userId);
      return other ? names.get(other) : undefined;
    },
  };
}

// One chat per activity; a carpool session uses its booking's chat (B2b decision 3).
export async function chatIdForActivity(activityId: string, type: ActivityType) {
  if (type === "CARPOOL_SESSION") {
    const session = await prisma.carpoolSession.findUnique({
      where: { activityId },
      select: { contract: { select: { booking: { select: { activity: { select: { chat: { select: { id: true } } } } } } } } },
    });
    return session?.contract.booking.activity.chat?.id ?? null;
  }
  const chat = await prisma.chat.findUnique({ where: { activityId }, select: { id: true } });
  return chat?.id ?? null;
}

async function activeUsers(userIds: readonly string[], now: Date) {
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, ...accountStatusSelect } });
  return users.filter((user) => effectiveAccountStatus(user, now) === "ACTIVE").map((user) => user.id);
}

// After restrict, suspend or ban (proposal 17.1): the other participant of
// each of the user's accepted activities is told, without saying which action
// it was. One notification per activity and account status.
export async function notifyParticipantsOfLockedUser(userId: string, activityIds: readonly string[], status: string) {
  if (activityIds.length === 0) return;
  const activities = await prisma.activity.findMany({
    where: { id: { in: [...activityIds] } },
    select: { id: true, type: true, creatorId: true, accepterId: true },
  });
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { fullName: true } });
  for (const activity of activities) {
    const other = activity.creatorId === userId ? activity.accepterId : activity.creatorId;
    if (!other) continue;
    const chatId = await chatIdForActivity(activity.id, activity.type);
    const data: NotificationData = { activityType: activity.type, name: profile?.fullName, chatId: chatId ?? undefined };
    await notify({
      type: "PARTICIPANT_ACCOUNT_LOCKED",
      userIds: [other],
      dedupeKey: `PARTICIPANT_ACCOUNT_LOCKED:${activity.id}:${userId}:${status}`,
      activityId: activity.id,
      data,
    });
  }
}
