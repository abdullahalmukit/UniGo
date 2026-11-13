import { rules } from "../../config/rules.js";
import type { ActivityStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";
import { afterActivityCommit, applyTransition, engineActivitySelect } from "../activities/engine.js";
import { runActivityTransaction } from "../activities/transaction.js";
import { recordAudit } from "../admin/audit-log.js";
import { activityExtras, adminPerson, adminPersonSelect, adminUserMatch, dayRange } from "../ride/ride.admin.service.js";

const notFound = () => new AppError(404, "SERVICE_NOT_FOUND", "This service request was not found");

export type AdminServiceFilters = { status?: string; q?: string; date?: string; subAreaId?: string; categoryId?: string; page: number };

export async function listAdminServices(filters: AdminServiceFilters) {
  const pageSize = rules.admin.pageSize;
  const q = filters.q?.trim();
  const when = dayRange(filters.date);
  const where: Prisma.ActivityWhereInput = {
    type: "SERVICE",
    AND: [
      { serviceRequest: { isNot: null } },
      ...(filters.subAreaId ? [{ serviceRequest: { subAreaId: filters.subAreaId } }] : []),
      ...(filters.categoryId ? [{ serviceRequest: { categoryId: filters.categoryId } }] : []),
    ],
    ...(filters.status && { status: filters.status as ActivityStatus }),
    ...(when && { startTime: when }),
    ...(q && {
      OR: [
        { creator: adminUserMatch(q) },
        { accepter: adminUserMatch(q) },
        { serviceRequest: { serviceTitle: { contains: q } } },
        { serviceRequest: { taskTitle: { contains: q } } },
      ],
    }),
  };

  const [total, rows] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: { startTime: "desc" },
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        subStatus: true,
        startTime: true,
        createdAt: true,
        deletedAt: true,
        isLateCancellation: true,
        creator: { select: adminPersonSelect },
        accepter: { select: adminPersonSelect },
        serviceRequest: {
          select: {
            serviceTitle: true,
            taskTitle: true,
            destinationAddress: true,
            offeredAmount: true,
            estimatedBudget: true,
            category: { select: { code: true } },
          },
        },
      },
    }),
  ]);

  return {
    total,
    page: filters.page,
    pageSize,
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      subStatus: row.subStatus,
      deleted: row.deletedAt !== null,
      isLateCancellation: row.isLateCancellation,
      startTime: row.startTime.toISOString(),
      createdAt: row.createdAt.toISOString(),
      creator: adminPerson(row.creator),
      accepter: row.accepter ? adminPerson(row.accepter) : null,
      serviceTitle: row.serviceRequest?.serviceTitle ?? "Uni Service",
      taskTitle: row.serviceRequest?.taskTitle ?? "",
      destination: row.serviceRequest?.destinationAddress ?? "",
      offeredAmount: Number(row.serviceRequest?.offeredAmount ?? 0),
      estimatedBudget: row.serviceRequest?.estimatedBudget ? Number(row.serviceRequest.estimatedBudget) : null,
      categoryCode: row.serviceRequest?.category.code ?? null,
      category: row.serviceRequest?.category.code
        ? { code: row.serviceRequest.category.code }
        : null,
    })),
  };
}

export async function getAdminService(activityId: string) {
  const row = await prisma.activity.findFirst({
    where: { id: activityId, type: "SERVICE" },
    select: {
      id: true,
      status: true,
      subStatus: true,
      startTime: true,
      startedAt: true,
      completedAt: true,
      deletedAt: true,
      isLateCancellation: true,
      createdAt: true,
      creator: { select: adminPersonSelect },
      accepter: { select: adminPersonSelect },
      serviceRequest: {
        include: {
          category: true,
          subArea: true,
        },
      },
    },
  });

  if (!row || !row.serviceRequest) throw notFound();

  const req = row.serviceRequest;
  return {
    id: row.id,
    status: row.status,
    subStatus: row.subStatus,
    deleted: row.deletedAt !== null,
    isLateCancellation: row.isLateCancellation,
    startTime: row.startTime.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    creator: adminPerson(row.creator),
    accepter: row.accepter ? adminPerson(row.accepter) : null,
    category: { code: req.category.code },
    serviceTitle: req.serviceTitle,
    taskTitle: req.taskTitle,
    description: req.description,
    destinationAddress: req.destinationAddress,
    pickupAddress: req.pickupAddress,
    subArea: req.subArea?.name ?? null,
    preferredDate: req.preferredDate.toISOString().slice(0, 10),
    hasPreferredTime: req.hasPreferredTime,
    offeredAmount: Number(req.offeredAmount),
    estimatedBudget: req.estimatedBudget ? Number(req.estimatedBudget) : null,
    itemDetails: req.itemDetails,
    quantity: req.quantity,
    instructions: req.instructions,
    referenceImage: req.referenceImageKey ? await signPrivateFileUrl(req.referenceImageKey) : null,
    ...(await activityExtras(activityId)),
  };
}

export async function adminCancelService(adminId: string, activityId: string, reason: string, ipAddress?: string, now = new Date()) {
  const outcome = await runActivityTransaction(async (tx) => {
    const activity = await tx.activity.findFirst({ where: { id: activityId, type: "SERVICE" }, select: engineActivitySelect });
    if (!activity) throw notFound();
    const done = await applyTransition(tx, activity, "ADMIN_CANCEL", { type: "ADMIN", id: adminId }, { reason, now, hideReason: true });
    await recordAudit(tx, {
      adminId,
      action: "SERVICE_CANCELLED_BY_ADMIN",
      targetType: "service_request",
      targetId: activityId,
      targetUserId: activity.creatorId,
      oldValue: { status: activity.status, subStatus: activity.subStatus },
      newValue: { status: "CANCELLED", reason },
      ipAddress,
    });
    return done;
  });
  await afterActivityCommit([outcome]);
  return getAdminService(activityId);
}

