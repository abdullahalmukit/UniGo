import { rules } from "../../config/rules.js";
import type { ActivityStatus, DisputeKind, DisputeStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";
import { afterActivityCommit, applyTransition, engineActivitySelect } from "../activities/engine.js";
import { runActivityTransaction } from "../activities/transaction.js";
import { recordAudit } from "../admin/audit-log.js";
import { applyAccountAction, type AccountAction } from "../admin/moderation.service.js";
import { postSystemMessage } from "../chat/chat.service.js";
import { queueNotification } from "../notifications/notifications.service.js";
import { miniProfile, personSelect } from "../ride/ride.views.js";
import type { CreateDisputeInput, ListDisputesQuery, ResolveDisputeInput } from "./disputes.validation.js";

const notFound = () => new AppError(404, "DISPUTE_NOT_FOUND", "This dispute was not found");

export async function createDispute(userId: string, input: CreateDisputeInput, now = new Date()) {
  const activity = await prisma.activity.findUnique({
    where: { id: input.activityId, deletedAt: null },
    include: {
      creator: { select: personSelect },
      accepter: { select: personSelect },
      chat: { select: { id: true } },
    },
  });

  if (!activity) throw new AppError(404, "ACTIVITY_NOT_FOUND", "Activity not found");

  const isCreator = activity.creatorId === userId;
  const isAccepter = activity.accepterId === userId;
  if (!isCreator && !isAccepter) {
    throw new AppError(403, "NOT_PARTICIPANT", "You are not a participant in this activity");
  }

  const againstUserId = isCreator ? activity.accepterId : activity.creatorId;
  if (!againstUserId) {
    throw new AppError(400, "CANNOT_DISPUTE_OPEN", "You cannot dispute an unaccepted request");
  }

  // Check if there is already an open dispute for this activity
  const existingDispute = await prisma.dispute.findFirst({
    where: { activityId: activity.id, status: { in: ["OPEN", "UNDER_REVIEW"] } },
  });
  if (existingDispute) {
    throw new AppError(409, "DISPUTE_ALREADY_OPEN", "A dispute is already open for this activity");
  }

  const statusBefore = activity.status;
  const subStatusBefore = activity.subStatus;
  const needsStatusTransition = statusBefore === "ACCEPTED" || statusBefore === "IN_PROGRESS";

  let createdDisputeId = "";

  if (needsStatusTransition) {
    const outcome = await runActivityTransaction(async (tx) => {
      const current = await tx.activity.findUniqueOrThrow({
        where: { id: activity.id },
        select: engineActivitySelect,
      });

      const transition = await applyTransition(
        tx,
        current,
        "DISPUTE",
        { type: "USER", id: userId },
        { reason: input.reason, now },
      );

      const dispute = await tx.dispute.create({
        data: {
          activityId: activity.id,
          kind: input.kind as DisputeKind,
          status: "OPEN",
          raisedById: userId,
          againstUserId,
          reason: input.reason,
          description: input.description,
          statusBefore,
          subStatusBefore,
          ...(input.evidenceKeys && input.evidenceKeys.length > 0 && {
            evidence: {
              createMany: {
                data: input.evidenceKeys.map((fileKey) => ({
                  uploadedById: userId,
                  fileKey,
                  mimeType: "image/jpeg",
                  sizeBytes: 1024,
                })),
              },
            },
          }),
        },
      });

      createdDisputeId = dispute.id;
      return transition;
    });

    await afterActivityCommit([outcome]);
  } else {
    // Finished activity complaint
    const dispute = await prisma.dispute.create({
      data: {
        activityId: activity.id,
        kind: input.kind as DisputeKind,
        status: "OPEN",
        raisedById: userId,
        againstUserId,
        reason: input.reason,
        description: input.description,
        statusBefore,
        subStatusBefore,
        ...(input.evidenceKeys && input.evidenceKeys.length > 0 && {
          evidence: {
            createMany: {
              data: input.evidenceKeys.map((fileKey) => ({
                uploadedById: userId,
                fileKey,
                mimeType: "image/jpeg",
                sizeBytes: 1024,
              })),
            },
          },
        }),
      },
    });
    createdDisputeId = dispute.id;
  }

  // Post system message in chat
  if (activity.chat?.id) {
    await postSystemMessage(activity.chat.id, {
      code: "DISPUTED",
      text: `Dispute raised: ${input.reason}`,
      metadata: { disputeId: createdDisputeId },
    }).catch(() => undefined);
  }

  // Notify againstUser
  await queueNotification({
    type: "DISPUTE_RAISED",
    recipientId: againstUserId,
    actorUserId: userId,
    activityId: activity.id,
    text: `A dispute has been raised: ${input.reason}`,
    path: `/activity`,
  }).catch(() => undefined);

  return getDispute(userId, createdDisputeId);
}

export async function getDispute(viewerId: string, disputeId: string) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      raisedBy: { select: personSelect },
      againstUser: { select: personSelect },
      evidence: true,
      activity: {
        select: {
          id: true,
          type: true,
          status: true,
          subStatus: true,
          startTime: true,
        },
      },
    },
  });

  if (!dispute) throw notFound();

  const isParticipant = dispute.raisedById === viewerId || dispute.againstUserId === viewerId;
  const user = await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true } });
  const isAdmin = user?.role === "MODERATOR" || user?.role === "SUPER_ADMIN";

  if (!isParticipant && !isAdmin) {
    throw new AppError(403, "FORBIDDEN", "You do not have access to this dispute");
  }

  const evidence = await Promise.all(
    dispute.evidence.map(async (e) => ({
      id: e.id,
      uploadedById: e.uploadedById,
      url: await signPrivateFileUrl(e.fileKey),
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  );

  return {
    id: dispute.id,
    activityId: dispute.activityId,
    activityType: dispute.activity.type,
    activityStatus: dispute.activity.status,
    kind: dispute.kind,
    status: dispute.status,
    reason: dispute.reason,
    description: dispute.description,
    statusBefore: dispute.statusBefore,
    subStatusBefore: dispute.subStatusBefore,
    finalStatus: dispute.finalStatus,
    decisionNote: dispute.decisionNote,
    decidedAt: dispute.decidedAt?.toISOString() ?? null,
    raisedBy: await miniProfile(dispute.raisedBy),
    againstUser: await miniProfile(dispute.againstUser),
    mine: dispute.raisedById === viewerId,
    evidence,
    createdAt: dispute.createdAt.toISOString(),
  };
}

export async function listUserDisputes(userId: string) {
  const disputes = await prisma.dispute.findMany({
    where: {
      OR: [{ raisedById: userId }, { againstUserId: userId }],
    },
    orderBy: { createdAt: "desc" },
    include: {
      raisedBy: { select: personSelect },
      againstUser: { select: personSelect },
      activity: {
        select: {
          id: true,
          type: true,
          status: true,
        },
      },
    },
  });

  return Promise.all(
    disputes.map(async (d) => ({
      id: d.id,
      activityId: d.activityId,
      activityType: d.activity.type,
      kind: d.kind,
      status: d.status,
      reason: d.reason,
      raisedBy: await miniProfile(d.raisedBy),
      againstUser: await miniProfile(d.againstUser),
      mine: d.raisedById === userId,
      createdAt: d.createdAt.toISOString(),
    })),
  );
}

export async function listAdminDisputes(query: ListDisputesQuery) {
  const pageSize = rules.disputes.pageSize;
  const where: Prisma.DisputeWhereInput = {
    ...(query.status && { status: query.status as DisputeStatus }),
    ...(query.kind && { kind: query.kind as DisputeKind }),
  };

  const [total, rows] = await Promise.all([
    prisma.dispute.count({ where }),
    prisma.dispute.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      include: {
        raisedBy: { select: personSelect },
        againstUser: { select: personSelect },
        activity: {
          select: {
            id: true,
            type: true,
            status: true,
          },
        },
      },
    }),
  ]);

  const items = await Promise.all(
    rows.map(async (d) => ({
      id: d.id,
      activityId: d.activityId,
      activityType: d.activity.type,
      kind: d.kind,
      status: d.status,
      reason: d.reason,
      description: d.description,
      raisedBy: await miniProfile(d.raisedBy),
      againstUser: await miniProfile(d.againstUser),
      createdAt: d.createdAt.toISOString(),
    })),
  );

  return {
    items,
    page: query.page,
    pageSize,
    total,
    hasMore: total > query.page * pageSize,
  };
}

export async function adminResolveDispute(adminId: string, disputeId: string, input: ResolveDisputeInput, ipAddress?: string, now = new Date()) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      activity: { select: engineActivitySelect },
    },
  });

  if (!dispute) throw notFound();
  if (dispute.status === "RESOLVED") {
    throw new AppError(409, "ALREADY_RESOLVED", "This dispute has already been resolved");
  }

  const finalStatus: ActivityStatus = input.decision === "RESOLVE_COMPLETED" ? "COMPLETED" : "CANCELLED";

  let transitionOutcome: unknown = null;

  await runActivityTransaction(async (tx) => {
    // If the activity is currently DISPUTED, transition it to the final status
    const currentActivity = await tx.activity.findUnique({
      where: { id: dispute.activityId },
      select: engineActivitySelect,
    });

    if (currentActivity && currentActivity.status === "DISPUTED") {
      transitionOutcome = await applyTransition(
        tx,
        currentActivity,
        input.decision,
        { type: "ADMIN", id: adminId },
        { reason: input.decisionNote, now },
      );
    }

    await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status: "RESOLVED",
        decidedById: adminId,
        decidedAt: now,
        finalStatus,
        decisionNote: input.decisionNote,
      },
    });

    await recordAudit(tx, {
      adminId,
      action: "DISPUTE_RESOLVED",
      targetType: "dispute",
      targetId: disputeId,
      targetUserId: dispute.againstUserId,
      oldValue: { status: dispute.status, activityStatus: currentActivity?.status },
      newValue: { status: "RESOLVED", finalStatus, decisionNote: input.decisionNote },
      ipAddress,
    });
  });

  if (transitionOutcome) {
    await afterActivityCommit([transitionOutcome as any]);
  }

  // Apply moderation action if chosen (WARN, RESTRICT, SUSPEND, BAN)
  if (input.action) {
    const suspendUntil =
      input.suspensionDays != null
        ? new Date(now.getTime() + input.suspensionDays * 24 * 60 * 60 * 1000)
        : null;
    await applyAccountAction(
      adminId,
      dispute.againstUserId,
      input.action as AccountAction,      {
        reason: input.actionReason ?? input.decisionNote,
        endsAt: suspendUntil,
      },
      ipAddress,
      now,
    ).catch((err) => {
      console.error("Failed to apply dispute moderation action:", err);
    });
  }

  // Notify both participants of the admin resolution
  const notifyUsers = [dispute.raisedById, dispute.againstUserId];
  for (const uid of notifyUsers) {
    await queueNotification({
      type: "DISPUTE_RESOLVED",
      recipientId: uid,
      actorUserId: adminId,
      activityId: dispute.activityId,
      text: `Dispute resolved: ${input.decisionNote}`,
      path: `/activity`,
    }).catch(() => undefined);
  }

  return getDispute(adminId, disputeId);
}

