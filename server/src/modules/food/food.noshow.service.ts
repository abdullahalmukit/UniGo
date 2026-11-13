import { rules } from "../../config/rules.js";
import type { Prisma, ReportStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../admin/audit-log.js";
import { applyAccountAction, type AccountAction } from "../admin/moderation.service.js";
import { postSystemMessage } from "../chat/chat.service.js";
import { queueNotification } from "../notifications/notifications.service.js";
import { miniProfile, personSelect } from "../ride/ride.views.js";

const notFound = () => new AppError(404, "NO_SHOW_NOT_FOUND", "No-Show report not found");

export async function reportFoodNoShow(
  userId: string,
  activityId: string,
  description: string,
  evidenceKeys: string[] = [],
) {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId, type: "FOOD", deletedAt: null },
    include: {
      foodRequest: true,
      chat: { select: { id: true } },
    },
  });

  if (!activity || !activity.foodRequest) {
    throw new AppError(404, "FOOD_NOT_FOUND", "Food request not found");
  }

  if (activity.accepterId !== userId) {
    throw new AppError(403, "NOT_ACCEPTER", "Only the person bringing the food can report a requester No-Show");
  }

  if (activity.status !== "IN_PROGRESS") {
    throw new AppError(409, "INVALID_STATUS", "No-Show can only be reported while delivery is in progress");
  }

  const existing = await prisma.noShowReport.findFirst({
    where: { foodRequestId: activity.foodRequest.id, status: { in: ["OPEN", "UNDER_REVIEW"] } },
  });
  if (existing) {
    throw new AppError(409, "ALREADY_REPORTED", "A No-Show report is already open for this request");
  }

  const report = await prisma.noShowReport.create({
    data: {
      foodRequestId: activity.foodRequest.id,
      reporterId: userId,
      reportedUserId: activity.creatorId,
      description: description.trim(),
      evidenceKeys: evidenceKeys as any,
      status: "OPEN",
    },
  });

  if (activity.chat?.id) {
    await postSystemMessage(activity.chat.id, {
      code: "NO_SHOW_REPORTED",
      text: "A requester No-Show report was submitted to admins.",
      metadata: { noShowReportId: report.id },
    }).catch(() => undefined);
  }

  await queueNotification({
    type: "NO_SHOW_REPORTED",
    recipientId: activity.creatorId,
    actorUserId: userId,
    activityId: activity.id,
    text: "A No-Show report was filed regarding your food order.",
    path: `/food/requests/${activity.id}`,
  }).catch(() => undefined);

  return report;
}

export async function listAdminNoShows(page = 1, status?: ReportStatus) {
  const pageSize = rules.noShow.pageSize;
  const where: Prisma.NoShowReportWhereInput = {
    ...(status && { status }),
  };

  const [total, rows] = await Promise.all([
    prisma.noShowReport.count({ where }),
    prisma.noShowReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        reporter: { select: personSelect },
        reportedUser: { select: personSelect },
        foodRequest: {
          select: {
            restaurantName: true,
            deliveryAddress: true,
            activityId: true,
          },
        },
      },
    }),
  ]);

  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      foodRequestId: r.foodRequestId,
      activityId: r.foodRequest.activityId,
      restaurantName: r.foodRequest.restaurantName,
      deliveryAddress: r.foodRequest.deliveryAddress,
      description: r.description,
      status: r.status,
      reporter: await miniProfile(r.reporter),
      reportedUser: await miniProfile(r.reportedUser),
      createdAt: r.createdAt.toISOString(),
    })),
  );

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: total > page * pageSize,
  };
}

export async function getAdminNoShow(id: string) {
  const report = await prisma.noShowReport.findUnique({
    where: { id },
    include: {
      reporter: { select: personSelect },
      reportedUser: { select: personSelect },
      foodRequest: {
        include: {
          activity: {
            select: {
              id: true,
              status: true,
              subStatus: true,
              startTime: true,
            },
          },
        },
      },
    },
  });

  if (!report) throw notFound();

  const rawKeys = Array.isArray(report.evidenceKeys) ? (report.evidenceKeys as string[]) : [];
  const evidence = await Promise.all(
    rawKeys.map(async (key) => ({
      key,
      url: await signPrivateFileUrl(key),
    })),
  );

  return {
    id: report.id,
    foodRequestId: report.foodRequestId,
    activityId: report.foodRequest.activityId,
    activityStatus: report.foodRequest.activity.status,
    restaurantName: report.foodRequest.restaurantName,
    deliveryAddress: report.foodRequest.deliveryAddress,
    description: report.description,
    status: report.status,
    resolutionNote: report.resolutionNote,
    reviewedAt: report.reviewedAt?.toISOString() ?? null,
    reporter: await miniProfile(report.reporter),
    reportedUser: await miniProfile(report.reportedUser),
    evidence,
    createdAt: report.createdAt.toISOString(),
  };
}

export async function adminResolveNoShow(
  adminId: string,
  id: string,
  input: {
    status: "RESOLVED" | "DISMISSED";
    resolutionNote: string;
    action?: AccountAction;
    actionReason?: string;
    suspensionDays?: number;
  },
  ipAddress?: string,
  now = new Date(),
) {
  const report = await prisma.noShowReport.findUnique({ where: { id } });
  if (!report) throw notFound();

  const updated = await prisma.noShowReport.update({
    where: { id },
    data: {
      status: input.status,
      reviewedById: adminId,
      reviewedAt: now,
      resolutionNote: input.resolutionNote,
    },
  });

  await recordAudit(prisma, {
    adminId,
    action: "NO_SHOW_RESOLVED",
    targetType: "no_show_report",
    targetId: id,
    targetUserId: report.reportedUserId,
    oldValue: { status: report.status },
    newValue: { status: input.status, note: input.resolutionNote },
    ipAddress,
  });

  if (input.action) {
    const suspendUntil =
      input.suspensionDays != null
        ? new Date(now.getTime() + input.suspensionDays * 24 * 60 * 60 * 1000)
        : null;
    await applyAccountAction(
      adminId,
      report.reportedUserId,
      input.action,
      {
        reason: input.actionReason ?? input.resolutionNote,
        endsAt: suspendUntil,
      },
      ipAddress,
      now,
    ).catch((err) => {
      console.error("Failed to apply no-show moderation action:", err);
    });
  }

  return getAdminNoShow(id);
}

