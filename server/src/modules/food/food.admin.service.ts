import { rules } from "../../config/rules.js";
import type { ActivityStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";
import { afterActivityCommit, applyTransition, engineActivitySelect } from "../activities/engine.js";
import { runActivityTransaction } from "../activities/transaction.js";
import { recordAudit } from "../admin/audit-log.js";
import { activityExtras, adminPerson, adminPersonSelect, adminUserMatch, dayRange } from "../ride/ride.admin.service.js";

// Admin › Food (proposal 17, B4): every food request with filters, details
// (both people with email and phone, the order, approvals, receipts through
// signed links, payment, reviews and the full status history) and admin cancel
// with a reason (audited; both participants notified by the engine).
// Moderators and Super Admins, as Ride Sharing (B3b-2 Q3). No-Show reports
// come in B7. Chats stay private to admins (B7 opens disputed chats only).

const notFound = () => new AppError(404, "FOOD_NOT_FOUND", "This food request was not found");

export type AdminFoodFilters = { status?: string; q?: string; date?: string; subAreaId?: string; page: number };

export async function listAdminFood(filters: AdminFoodFilters) {
  const pageSize = rules.admin.pageSize;
  const q = filters.q?.trim();
  const when = dayRange(filters.date);
  const where: Prisma.ActivityWhereInput = {
    type: "FOOD",
    ...(filters.status && { status: filters.status as ActivityStatus }),
    ...(when && { startTime: when }),
    ...(filters.subAreaId && { foodRequest: { subAreaId: filters.subAreaId } }),
    ...(q && { OR: [{ creator: adminUserMatch(q) }, { accepter: adminUserMatch(q) }, { foodRequest: { restaurantName: { contains: q } } }] }),
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
        deletedAt: true,
        creator: { select: adminPersonSelect },
        accepter: { select: adminPersonSelect },
        foodRequest: { select: { restaurantName: true, deliveryAddress: true, estimatedBudget: true, deliveryServiceAmount: true, orderFoodPrice: true } },
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
      time: row.startTime,
      restaurantName: row.foodRequest?.restaurantName ?? "",
      delivery: row.foodRequest?.deliveryAddress ?? "",
      foodPrice: Number(row.foodRequest?.orderFoodPrice ?? row.foodRequest?.estimatedBudget ?? 0),
      deliveryCharge: Number(row.foodRequest?.deliveryServiceAmount ?? 0),
      requester: adminPerson(row.creator),
      accepter: adminPerson(row.accepter),
    })),
  };
}

const money = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

export async function getAdminFood(activityId: string) {
  const row = await prisma.activity.findFirst({
    where: { id: activityId, type: "FOOD" },
    select: {
      id: true,
      status: true,
      subStatus: true,
      startTime: true,
      acceptedAt: true,
      completedAt: true,
      cancelledAt: true,
      cancellationReason: true,
      isLateCancellation: true,
      closureReason: true,
      deletedAt: true,
      createdAt: true,
      creator: { select: adminPersonSelect },
      accepter: { select: adminPersonSelect },
      cancelledBy: { select: { id: true, profile: { select: { fullName: true } } } },
      foodRequest: {
        select: {
          restaurantName: true,
          restaurantAddress: true,
          items: true,
          details: true,
          quantity: true,
          estimatedBudget: true,
          pickupAddress: true,
          deliveryAddress: true,
          deliveryServiceAmount: true,
          orderItems: true,
          orderFoodPrice: true,
          orderDeliveryCharge: true,
          orderPaymentMethod: true,
          orderVersion: true,
          requesterConfirmedAt: true,
          accepterConfirmedAt: true,
          subArea: { select: { id: true, name: true } },
          approvals: { orderBy: { createdAt: "asc" }, select: { id: true, amount: true, previousAmount: true, status: true, decidedAt: true, createdAt: true } },
          receipts: { orderBy: { createdAt: "asc" }, select: { id: true, fileKey: true, amount: true, createdAt: true } },
        },
      },
    },
  });
  if (!row?.foodRequest) throw notFound();
  const f = row.foodRequest;
  return {
    id: row.id,
    status: row.status,
    subStatus: row.subStatus,
    startTime: row.startTime,
    acceptedAt: row.acceptedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    isLateCancellation: row.isLateCancellation,
    closureReason: row.closureReason,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    requester: adminPerson(row.creator),
    accepter: adminPerson(row.accepter),
    cancelledBy: row.cancelledBy ? { id: row.cancelledBy.id, name: row.cancelledBy.profile?.fullName ?? "" } : null,
    food: {
      restaurantName: f.restaurantName,
      restaurantAddress: f.restaurantAddress,
      items: f.items,
      details: f.details,
      quantity: f.quantity,
      estimatedBudget: Number(f.estimatedBudget),
      pickupAddress: f.pickupAddress,
      deliveryAddress: f.deliveryAddress,
      deliveryCharge: money(f.deliveryServiceAmount) ?? 0,
      subArea: f.subArea,
    },
    order:
      f.orderVersion > 0
        ? {
            version: f.orderVersion,
            items: f.orderItems,
            foodPrice: money(f.orderFoodPrice),
            deliveryCharge: money(f.orderDeliveryCharge),
            paymentMethod: f.orderPaymentMethod,
            requesterConfirmedAt: f.requesterConfirmedAt,
            accepterConfirmedAt: f.accepterConfirmedAt,
          }
        : null,
    approvals: f.approvals.map((a) => ({ ...a, amount: Number(a.amount), previousAmount: Number(a.previousAmount) })),
    // Admins open receipts through 5-minute signed links (A6 decision 5)
    receipts: await Promise.all(
      f.receipts.map(async (r) => ({ id: r.id, actualCost: money(r.amount), image: await signPrivateFileUrl(r.fileKey), createdAt: r.createdAt })),
    ),
    ...(await activityExtras(activityId)),
  };
}

// Admin cancel (engine ADMIN_CANCEL; the reason stays in the status history and
// the Audit Log, users see "cancelled by UniGo").
export async function adminCancelFood(adminId: string, activityId: string, reason: string, ipAddress?: string, now = new Date()) {
  const outcome = await runActivityTransaction(async (tx) => {
    const activity = await tx.activity.findFirst({ where: { id: activityId, type: "FOOD" }, select: engineActivitySelect });
    if (!activity) throw notFound();
    const done = await applyTransition(tx, activity, "ADMIN_CANCEL", { type: "ADMIN", id: adminId }, { reason, now, hideReason: true });
    await recordAudit(tx, {
      adminId,
      action: "FOOD_CANCELLED_BY_ADMIN",
      targetType: "food_request",
      targetId: activityId,
      targetUserId: activity.creatorId,
      oldValue: { status: activity.status, subStatus: activity.subStatus },
      newValue: { status: "CANCELLED", reason },
      ipAddress,
    });
    return done;
  });
  await afterActivityCommit([outcome]);
  return getAdminFood(activityId);
}
