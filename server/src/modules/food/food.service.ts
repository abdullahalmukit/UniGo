import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { dhakaWallTime } from "../../utils/time.js";
import { acceptActivity, engineActivitySelect, recordCreation } from "../activities/engine.js";
import { assertCreationLimits } from "../activities/limits.js";
import { assertCreationWindow } from "../activities/time-rules.js";
import { rescheduleAfterStartChange, scheduleActivityTimers } from "../activities/timers.js";
import { runActivityTransaction } from "../activities/transaction.js";
import { boundingBox, distanceKm, type LatLng } from "../geo/distance.js";
import { queueSubAreaNotification } from "../notifications/sub-area.service.js";
import { createPaymentRecord } from "../payments/payments.service.js";
import { blockedUserIds, isBlockedBetween } from "../users/blocks.service.js";
import { participantPhone } from "../users/contact.js";
import type { CreateInput, EditInput, ListQuery } from "./food.validation.js";
import { foodCard, foodSelect, foodView, type FoodRow } from "./food.views.js";

// Food Delivery (proposal section 10, B4 decisions): creating, editing,
// upgrading, accepting, viewing and searching food requests. Status changes go
// through the common engine; the order details, over-budget approvals and the
// receipt are in food.order.service.ts.

const DAY = 24 * 60 * 60 * 1000;

export const foodNotFound = () => new AppError(404, "FOOD_NOT_FOUND", "This food request was not found");

export const decimal = (value: number) => new Prisma.Decimal(value.toFixed(2));
// Coordinates keep the column's 6 decimals (about 0.1 m)
const coord = (value: number) => new Prisma.Decimal(value.toFixed(6));
// The requester's delivery charge: 0 is stored as none
const chargeOrNull = (value: number | null | undefined) => (value ? decimal(value) : null);

async function assertActiveSubArea(subAreaId: string) {
  const subArea = await prisma.subArea.findFirst({ where: { id: subAreaId, isActive: true }, select: { id: true } });
  if (!subArea) throw new AppError(400, "SUB_AREA_NOT_FOUND", "Choose a sub-area from the list", { fields: { subAreaId: ["Choose a sub-area from the list"] } });
}

// A deleted request opens only for its creator (as rides, B3b-1).
export async function loadFood(id: string, options: { includeDeleted?: boolean } = {}): Promise<FoodRow> {
  const row = await prisma.activity.findFirst({
    where: { id, type: "FOOD", ...(!options.includeDeleted && { deletedAt: null }) },
    select: foodSelect,
  });
  if (!row?.foodRequest) throw foodNotFound();
  return row;
}

export async function createFoodRequest(userId: string, input: CreateInput, now = new Date()) {
  assertCreationWindow("FOOD", input.expectedDeliveryTime, now);
  await assertActiveSubArea(input.subAreaId);

  const activity = await runActivityTransaction(async (tx) => {
    await assertCreationLimits(tx, userId, now);
    const created = await tx.activity.create({
      data: {
        type: "FOOD",
        status: "OPEN",
        // The expected delivery time is the activity's start (proposal 7.6)
        startTime: input.expectedDeliveryTime,
        blocksTime: true,
        creatorId: userId,
        foodRequest: {
          create: {
            restaurantName: input.restaurantName,
            restaurantAddress: input.restaurant.address,
            restaurantLat: coord(input.restaurant.lat),
            restaurantLng: coord(input.restaurant.lng),
            items: input.items,
            details: input.details,
            quantity: input.quantity,
            estimatedBudget: decimal(input.estimatedBudget),
            pickupAddress: input.pickup.address,
            pickupLat: coord(input.pickup.lat),
            pickupLng: coord(input.pickup.lng),
            deliveryAddress: input.delivery.address,
            deliveryLat: coord(input.delivery.lat),
            deliveryLng: coord(input.delivery.lng),
            subAreaId: input.subAreaId,
            deliveryServiceAmount: chargeOrNull(input.deliveryCharge),
          },
        },
      },
      select: engineActivitySelect,
    });
    await recordCreation(tx, created, { type: "USER", id: userId });
    return created;
  });

  await scheduleActivityTimers([activity]);
  // 10.3 step 1: users who saved the sub-area are told (B2c engine)
  await queueSubAreaNotification(activity.id);
  return foodView(await loadFood(activity.id), userId);
}

// Before acceptance the creator can change everything (CLAUDE.md 5.7). The
// activity row is claimed first and only while OPEN, so an accept that comes
// in between makes the edit fail instead of changing an accepted request.
export async function updateFoodRequest(userId: string, activityId: string, input: EditInput, now = new Date()) {
  const current = await loadFood(activityId);
  if (current.creatorId !== userId) throw new AppError(403, "NOT_PARTICIPANT", "Only the creator can edit this request");
  if (current.status !== "OPEN") throw new AppError(409, "NOT_EDITABLE", "This request can no longer be edited");
  if (input.expectedDeliveryTime) assertCreationWindow("FOOD", input.expectedDeliveryTime, now);
  if (input.subAreaId) await assertActiveSubArea(input.subAreaId);

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.activity.updateMany({
      where: { id: activityId, status: "OPEN", deletedAt: null, startTime: { gt: now } },
      data: { startTime: input.expectedDeliveryTime ?? current.startTime },
    });
    if (claimed.count === 0) throw new AppError(409, "NOT_EDITABLE", "This request can no longer be edited");
    await tx.foodRequest.update({
      where: { activityId },
      data: {
        ...(input.restaurantName !== undefined && { restaurantName: input.restaurantName }),
        ...(input.restaurant && {
          restaurantAddress: input.restaurant.address,
          restaurantLat: coord(input.restaurant.lat),
          restaurantLng: coord(input.restaurant.lng),
        }),
        ...(input.items !== undefined && { items: input.items }),
        ...(input.details !== undefined && { details: input.details }),
        ...(input.quantity !== undefined && { quantity: input.quantity }),
        ...(input.estimatedBudget !== undefined && { estimatedBudget: decimal(input.estimatedBudget) }),
        ...(input.pickup && { pickupAddress: input.pickup.address, pickupLat: coord(input.pickup.lat), pickupLng: coord(input.pickup.lng) }),
        ...(input.delivery && {
          deliveryAddress: input.delivery.address,
          deliveryLat: coord(input.delivery.lat),
          deliveryLng: coord(input.delivery.lng),
        }),
        ...(input.subAreaId && { subAreaId: input.subAreaId }),
        ...(input.deliveryCharge !== undefined && { deliveryServiceAmount: chargeOrNull(input.deliveryCharge) }),
      },
    });
    return tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: engineActivitySelect });
  });

  if (input.expectedDeliveryTime && input.expectedDeliveryTime.getTime() !== current.startTime.getTime()) {
    await rescheduleAfterStartChange(updated, current.startTime);
  }
  return foodView(await loadFood(activityId), userId);
}

// Upgrade (CLAUDE.md 5.7, B4 Q5): raise the offered delivery charge.
export async function upgradeFoodRequest(userId: string, activityId: string, deliveryCharge: number, now = new Date()) {
  const current = await loadFood(activityId);
  if (deliveryCharge <= Number(current.foodRequest!.deliveryServiceAmount ?? 0)) {
    throw new AppError(400, "AMOUNT_NOT_HIGHER", "Choose a higher delivery charge", { fields: { deliveryCharge: ["Choose a higher amount"] } });
  }
  return updateFoodRequest(userId, activityId, { deliveryCharge }, now);
}

// Any verified student except the creator (proposal 10.4). The engine refuses
// restricted accounts, blocks either way, a passed start and the 90-minute
// conflict for both users, and takes the request only while it is still OPEN.
// The payment record starts from the estimate; the confirmed order replaces it.
export async function acceptFoodRequest(userId: string, activityId: string, now = new Date()) {
  await loadFood(activityId);
  await acceptActivity(activityId, userId, {
    now,
    afterTake: async (tx) => {
      const food = await tx.foodRequest.findUniqueOrThrow({ where: { activityId }, select: { estimatedBudget: true, deliveryServiceAmount: true } });
      const charge = food.deliveryServiceAmount ?? new Prisma.Decimal(0);
      // B4: the accepter buys the food and receives the money
      await createPaymentRecord(tx, {
        activityId,
        amount: food.estimatedBudget.add(charge),
        foodCost: food.estimatedBudget,
        deliveryCharge: charge,
        payeeId: userId,
      });
    },
  });
  return getFoodRequest(userId, activityId, now);
}

export async function getFoodRequest(viewerId: string, activityId: string, now = new Date()) {
  const row = await loadFood(activityId, { includeDeleted: true });
  if (row.deletedAt && viewerId !== row.creatorId) throw foodNotFound();
  const participant = viewerId === row.creatorId || viewerId === row.accepterId;
  if (participant) {
    // 10.3 step 2: both see each other's phone while it runs (B3b-1 fix D)
    const otherId = viewerId === row.creatorId ? row.accepterId : row.creatorId;
    return { ...(await foodView(row, viewerId)), phone: await participantPhone(viewerId, otherId, row.status) };
  }
  // Others see only open requests that have not started, never across a block
  if (row.status !== "OPEN" || row.startTime <= now) throw foodNotFound();
  if (await isBlockedBetween(prisma, viewerId, row.creatorId)) throw foodNotFound();
  return { ...(await foodView(row, viewerId)), phone: null };
}

// --- All Available and Search (10.1, B4 Q4)

const CANDIDATES = 500;

type Box = ReturnType<typeof boundingBox>;
const inBox = (box: Box | null, latField: string, lngField: string) =>
  box ? { [latField]: { gte: box.minLat, lte: box.maxLat }, [lngField]: { gte: box.minLng, lte: box.maxLng } } : {};

function near(point: LatLng, lat: number | undefined, lng: number | undefined, radiusKm: number) {
  return lat === undefined || lng === undefined || distanceKm(point, { lat, lng }) <= radiusKm;
}

// Open requests that have not started, nearest time first. Filters: near the
// restaurant and/or the delivery location (1, 2 or 5 km), an Asia/Dhaka day,
// a sub-area. No filter shows all. Blocked users are left out both ways.
export async function listFood(viewerId: string, query: ListQuery, now = new Date()) {
  const blocked = await blockedUserIds(prisma, viewerId);
  const restaurantBox =
    query.restaurantLat !== undefined && query.restaurantLng !== undefined ? boundingBox({ lat: query.restaurantLat, lng: query.restaurantLng }, query.radiusKm) : null;
  const deliveryBox =
    query.deliveryLat !== undefined && query.deliveryLng !== undefined ? boundingBox({ lat: query.deliveryLat, lng: query.deliveryLng }, query.radiusKm) : null;
  const day = query.date ? { gte: dhakaWallTime(query.date, 0, 0), lt: new Date(dhakaWallTime(query.date, 0, 0).getTime() + DAY) } : {};

  const rows = await prisma.activity.findMany({
    where: {
      type: "FOOD",
      status: "OPEN",
      deletedAt: null,
      startTime: { gt: now, ...day },
      ...(blocked.length > 0 && { creatorId: { notIn: blocked } }),
      foodRequest: {
        ...(query.subAreaId && { subAreaId: query.subAreaId }),
        ...inBox(restaurantBox, "restaurantLat", "restaurantLng"),
        ...inBox(deliveryBox, "deliveryLat", "deliveryLng"),
      },
    },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: foodSelect,
  });
  const matching = rows.filter((row) => {
    const f = row.foodRequest!;
    return (
      near({ lat: Number(f.restaurantLat), lng: Number(f.restaurantLng) }, query.restaurantLat, query.restaurantLng, query.radiusKm) &&
      near({ lat: Number(f.deliveryLat), lng: Number(f.deliveryLng) }, query.deliveryLat, query.deliveryLng, query.radiusKm)
    );
  });
  const size = rules.food.pageSize;
  const page = matching.slice((query.page - 1) * size, query.page * size);
  return {
    items: await Promise.all(page.map((row) => foodCard(row, viewerId))),
    page: query.page,
    hasMore: matching.length > query.page * size,
  };
}

// Limits the forms show (never hard-coded on the client)
export function foodConfig() {
  return {
    budget: rules.food.budget,
    deliveryCharge: rules.food.deliveryCharge,
    quantity: rules.food.quantity,
    restaurantNameMaxLength: rules.food.restaurantNameMaxLength,
    itemsMaxLength: rules.food.itemsMaxLength,
    detailsMaxLength: rules.food.detailsMaxLength,
    searchRadiusKm: rules.food.searchRadiusKm,
    defaultSearchRadiusKm: rules.food.defaultSearchRadiusKm,
    earliestFromNowMinutes: rules.creationWindow.earliestFromNow / 60000,
    latestFromNowHours: rules.creationWindow.foodLatestFromNow / 3600000,
    paymentMethods: rules.payments.methods,
  };
}
