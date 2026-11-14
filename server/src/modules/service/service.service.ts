import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { dhakaWallTime } from "../../utils/time.js";
import { acceptActivity, afterActivityCommit, applyTransition, engineActivitySelect, recordCreation } from "../activities/engine.js";
import { assertCreationLimits } from "../activities/limits.js";
import { assertCreationWindow, dateOnlyServiceStart } from "../activities/time-rules.js";
import { rescheduleAfterStartChange, scheduleActivityTimers } from "../activities/timers.js";
import { runActivityTransaction } from "../activities/transaction.js";
import { queueSubAreaNotification } from "../notifications/sub-area.service.js";
import { createPaymentRecord } from "../payments/payments.service.js";
import { blockedUserIds, isBlockedBetween } from "../users/blocks.service.js";
import { participantPhone } from "../users/contact.js";
import { fillPersonStats } from "../users/stats.service.js";
import type { CreateServiceInput, EditServiceInput, ListServicesQuery } from "./service.validation.js";
import { serviceSelect, serviceView, type ServiceRow } from "./service.views.js";
import { readCustomCategories } from "./custom-categories.js";

const DAY = 24 * 60 * 60 * 1000;
const notFound = () => new AppError(404, "SERVICE_NOT_FOUND", "This service request was not found");

const decimal = (value: number) => new Prisma.Decimal(value.toFixed(2));
const coord = (value: number) => new Prisma.Decimal(value.toFixed(6));

export async function listServiceCategories() {
  const standard = await prisma.serviceCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const custom = readCustomCategories().filter((c) => c.isActive);

  return [
    ...standard.map((cat) => ({
      id: cat.id,
      code: cat.code as string,
      name: undefined as string | undefined,
      sortOrder: cat.sortOrder,
      isActive: cat.isActive,
      isCustom: false,
    })),
    ...custom.map((cat) => ({
      id: cat.id,
      code: cat.code,
      name: cat.name,
      sortOrder: cat.sortOrder,
      isActive: cat.isActive,
      isCustom: true,
    })),
  ].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function loadService(id: string, options: { includeDeleted?: boolean } = {}): Promise<ServiceRow> {
  const row = await prisma.activity.findFirst({
    where: { id, type: "SERVICE", ...(!options.includeDeleted && { deletedAt: null }) },
    select: serviceSelect,
  });
  if (!row?.serviceRequest) throw notFound();
  return row;
}

function resolveServiceStartTime(preferredDate: string, preferredTime?: string) {
  if (preferredTime) {
    const hour = Number(preferredTime.slice(0, 2));
    const minute = Number(preferredTime.slice(3, 5));
    return {
      startTime: dhakaWallTime(preferredDate, hour, minute),
      hasPreferredTime: true,
      blocksTime: true,
    };
  }
  return {
    startTime: dateOnlyServiceStart(preferredDate),
    hasPreferredTime: false,
    blocksTime: false,
  };
}

export async function createServiceRequest(userId: string, input: CreateServiceInput, now = new Date()) {
  const { startTime, hasPreferredTime, blocksTime } = resolveServiceStartTime(input.preferredDate, input.preferredTime);
  assertCreationWindow("SERVICE", startTime, now);

  if (input.subAreaId) {
    const area = await prisma.subArea.findFirst({ where: { id: input.subAreaId, isActive: true }, select: { id: true } });
    if (!area) throw new AppError(400, "SUB_AREA_NOT_FOUND", "Choose a sub-area from the list");
  }

  const customList = readCustomCategories();
  const customMatch = customList.find((c) => c.id === input.categoryId && c.isActive);

  let categoryId = input.categoryId;
  if (customMatch) {
    const customOther = await prisma.serviceCategory.findUnique({ where: { code: "CUSTOM_OTHER" } });
    if (!customOther) {
      throw new AppError(400, "CATEGORY_NOT_FOUND", "Default service category not configured");
    }
    categoryId = customOther.id;
  } else {
    const category = await prisma.serviceCategory.findUnique({ where: { id: input.categoryId } });
    if (!category || !category.isActive) throw new AppError(400, "CATEGORY_NOT_FOUND", "Invalid service category");
  }

  let taskTitle = input.taskTitle;
  if (customMatch && !taskTitle.startsWith(`[${customMatch.name}]`)) {
    taskTitle = `[${customMatch.name}] ${taskTitle}`.slice(0, 150);
  }

  const activity = await runActivityTransaction(async (tx) => {
    await assertCreationLimits(tx, userId, now);
    const created = await tx.activity.create({
      data: {
        type: "SERVICE",
        status: "OPEN",
        startTime,
        blocksTime,
        creatorId: userId,
        serviceRequest: {
          create: {
            categoryId,
            serviceTitle: input.serviceTitle,
            taskTitle,
            description: input.description,
            destinationAddress: input.destination.address,
            destinationLat: coord(input.destination.lat),
            destinationLng: coord(input.destination.lng),
            preferredDate: new Date(`${input.preferredDate}T00:00:00.000Z`),
            hasPreferredTime,
            offeredAmount: decimal(input.offeredAmount),
            itemDetails: input.itemDetails ?? null,
            quantity: input.quantity ?? null,
            pickupAddress: input.pickup?.address ?? null,
            pickupLat: input.pickup?.lat !== undefined ? coord(input.pickup.lat) : null,
            pickupLng: input.pickup?.lng !== undefined ? coord(input.pickup.lng) : null,
            subAreaId: input.subAreaId ?? null,
            estimatedBudget: input.estimatedBudget !== undefined ? decimal(input.estimatedBudget) : null,
            instructions: input.instructions ?? null,
          },
        },
      },
      select: engineActivitySelect,
    });

    await recordCreation(tx, created, { type: "USER", id: userId });
    return created;
  });

  await scheduleActivityTimers([activity]);

  if (input.subAreaId) {
    await queueSubAreaNotification(activity.id);
  }

  const row = await loadService(activity.id);
  return serviceView(row, userId);
}

export async function getServiceRequest(viewerId: string, activityId: string, now = new Date()) {
  const row = await loadService(activityId, { includeDeleted: true });
  if (row.deletedAt && viewerId !== row.creatorId) throw notFound();
  if (await isBlockedBetween(prisma, viewerId, row.creatorId)) throw notFound();

  const view = await serviceView(row, viewerId);
  const active = row.status === "ACCEPTED" || row.status === "IN_PROGRESS";
  const otherId = viewerId === row.creatorId ? row.accepterId : row.creatorId;

  return {
    ...view,
    phone: active && otherId ? await participantPhone(viewerId, otherId, row.status) : null,
  };
}

export async function updateServiceRequest(userId: string, activityId: string, input: EditServiceInput, now = new Date()) {
  const current = await loadService(activityId);
  if (current.creatorId !== userId) throw notFound();
  if (current.status !== "OPEN") throw new AppError(409, "NOT_EDITABLE", "This request can no longer be edited");

  const preferredDateStr = input.preferredDate ?? current.serviceRequest!.preferredDate.toISOString().slice(0, 10);
  const preferredTimeStr = input.preferredTime;
  const { startTime, hasPreferredTime, blocksTime } = resolveServiceStartTime(preferredDateStr, preferredTimeStr);

  if (input.preferredDate || input.preferredTime) {
    assertCreationWindow("SERVICE", startTime, now);
  }

  const previousStartTime = current.startTime;

  await runActivityTransaction(async (tx) => {
    const claimed = await tx.activity.updateMany({
      where: { id: activityId, status: "OPEN", deletedAt: null },
      data: { startTime, blocksTime },
    });
    if (claimed.count === 0) throw new AppError(409, "NOT_EDITABLE", "This request can no longer be edited");

    await tx.serviceRequest.update({
      where: { activityId },
      data: {
        ...(input.categoryId && { categoryId: input.categoryId }),
        ...(input.serviceTitle && { serviceTitle: input.serviceTitle }),
        ...(input.taskTitle && { taskTitle: input.taskTitle }),
        ...(input.description && { description: input.description }),
        ...(input.destination && {
          destinationAddress: input.destination.address,
          destinationLat: coord(input.destination.lat),
          destinationLng: coord(input.destination.lng),
        }),
        preferredDate: new Date(`${preferredDateStr}T00:00:00.000Z`),
        hasPreferredTime,
        ...(input.offeredAmount !== undefined && { offeredAmount: decimal(input.offeredAmount) }),
        ...(input.itemDetails !== undefined && { itemDetails: input.itemDetails }),
        ...(input.quantity !== undefined && { quantity: input.quantity }),
        ...(input.pickup && {
          pickupAddress: input.pickup.address,
          pickupLat: coord(input.pickup.lat),
          pickupLng: coord(input.pickup.lng),
        }),
        ...(input.subAreaId !== undefined && { subAreaId: input.subAreaId }),
        ...(input.estimatedBudget !== undefined && { estimatedBudget: decimal(input.estimatedBudget) }),
        ...(input.instructions !== undefined && { instructions: input.instructions }),
      },
    });
  });

  if (startTime.getTime() !== previousStartTime.getTime()) {
    const updated = await prisma.activity.findUniqueOrThrow({ where: { id: activityId }, select: engineActivitySelect });
    await rescheduleAfterStartChange(updated, previousStartTime);
  }

  return serviceView(await loadService(activityId), userId);
}

export async function acceptServiceRequest(userId: string, activityId: string, now = new Date()) {
  await loadService(activityId);

  await acceptActivity(activityId, userId, {
    now,
    afterTake: async (tx, activity) => {
      const s = await tx.serviceRequest.findUniqueOrThrow({ where: { activityId } });
      const budget = s.estimatedBudget ?? new Prisma.Decimal(0);
      await createPaymentRecord(tx, {
        activityId,
        amount: s.offeredAmount.add(budget),
        payeeId: userId,
      });
    },
  });

  return serviceView(await loadService(activityId), userId);
}

export async function startService(userId: string, activityId: string, now = new Date()) {
  const current = await loadService(activityId);
  if (current.accepterId !== userId) throw notFound();

  const outcome = await runActivityTransaction(async (tx) => {
    const activity = await tx.activity.findFirst({ where: { id: activityId, type: "SERVICE" }, select: engineActivitySelect });
    if (!activity) throw notFound();
    return applyTransition(tx, activity, "START", { type: "USER", id: userId }, { now });
  });
  await afterActivityCommit([outcome]);
  return serviceView(await loadService(activityId), userId);
}

export async function deliverService(userId: string, activityId: string, now = new Date()) {
  const current = await loadService(activityId);
  if (current.accepterId !== userId) throw notFound();

  const outcome = await runActivityTransaction(async (tx) => {
    const activity = await tx.activity.findFirst({ where: { id: activityId, type: "SERVICE" }, select: engineActivitySelect });
    if (!activity) throw notFound();
    return applyTransition(tx, activity, "DELIVER_SERVICE", { type: "USER", id: userId }, { now });
  });
  await afterActivityCommit([outcome]);
  return serviceView(await loadService(activityId), userId);
}

export async function listServiceRequests(viewerId: string | null, query: ListServicesQuery, now = new Date()) {
  const blocked = viewerId ? await blockedUserIds(prisma, viewerId) : [];
  const graceCutoff = new Date(now.getTime() - rules.activity.expiryGracePeriod);
  const day = query.date ? { gte: dhakaWallTime(query.date, 0, 0), lt: new Date(dhakaWallTime(query.date, 0, 0).getTime() + DAY) } : {};

  const rows = await prisma.activity.findMany({
    where: {
      type: "SERVICE",
      status: "OPEN",
      deletedAt: null,
      startTime: { gte: graceCutoff, ...day },
      ...(blocked.length > 0 && { creatorId: { notIn: blocked } }),
      serviceRequest: {
        ...(query.categoryId && { categoryId: query.categoryId }),
        ...(query.subAreaId && { subAreaId: query.subAreaId }),
        ...(query.search && {
          OR: [
            { serviceTitle: { contains: query.search } },
            { taskTitle: { contains: query.search } },
            { description: { contains: query.search } },
            { destinationAddress: { contains: query.search } },
            { pickupAddress: { contains: query.search } },
          ],
        }),
      },
    },
    orderBy: { startTime: "asc" },
    take: 50,
    select: serviceSelect,
  });

  const cards = await Promise.all(rows.map((row) => serviceView(row, viewerId ?? "")));
  const page = query.page;
  const size = rules.service.pageSize;
  const start = (page - 1) * size;
  const items = cards.slice(start, start + size);

  return fillPersonStats({
    items,
    page,
    hasMore: cards.length > start + size,
    total: cards.length,
  });
}
