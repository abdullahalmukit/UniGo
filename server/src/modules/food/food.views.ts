import type { Prisma } from "../../generated/prisma/client.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { rules } from "../../config/rules.js";
import { completionBy, miniProfile, personSelect, subAreaSelect } from "../ride/ride.views.js";

// What students see of a food request (proposal section 10, B4 decisions).
// Built field by field: never an email; the phone only to the two
// participants while it runs (users/contact.ts, added by the service). The
// order details, approvals and receipts only to the two participants.

export const foodSelect = {
  id: true,
  status: true,
  subStatus: true,
  startTime: true,
  creatorId: true,
  accepterId: true,
  completionRequestedById: true,
  isLateCancellation: true,
  cancelledById: true,
  deletedAt: true,
  createdAt: true,
  creator: { select: personSelect },
  accepter: { select: personSelect },
  chat: { select: { id: true } },
  foodRequest: {
    select: {
      id: true,
      restaurantName: true,
      restaurantAddress: true,
      restaurantLat: true,
      restaurantLng: true,
      items: true,
      details: true,
      quantity: true,
      estimatedBudget: true,
      pickupAddress: true,
      pickupLat: true,
      pickupLng: true,
      deliveryAddress: true,
      deliveryLat: true,
      deliveryLng: true,
      deliveryServiceAmount: true,
      orderItems: true,
      orderFoodPrice: true,
      orderDeliveryCharge: true,
      orderPaymentMethod: true,
      orderVersion: true,
      orderUpdatedById: true,
      orderUpdatedAt: true,
      requesterConfirmedAt: true,
      accepterConfirmedAt: true,
      subArea: { select: subAreaSelect },
      approvals: {
        orderBy: { createdAt: "asc" },
        select: { id: true, amount: true, previousAmount: true, status: true, decidedAt: true, createdAt: true },
      },
      receipts: { orderBy: { createdAt: "asc" }, select: { id: true, fileKey: true, amount: true, createdAt: true } },
    },
  },
} as const satisfies Prisma.ActivitySelect;

export type FoodRow = Prisma.ActivityGetPayload<{ select: typeof foodSelect }>;

const place = (address: string, lat: Prisma.Decimal, lng: Prisma.Decimal) => ({ address, lat: Number(lat), lng: Number(lng) });
const money = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

export async function foodView(row: FoodRow, viewerId: string) {
  const f = row.foodRequest!;
  const isRequester = viewerId === row.creatorId;
  const isAccepter = viewerId === row.accepterId;
  const participant = isRequester || isAccepter;
  const confirmedByMe = isRequester ? f.requesterConfirmedAt !== null : f.accepterConfirmedAt !== null;
  const confirmedByOther = isRequester ? f.accepterConfirmedAt !== null : f.requesterConfirmedAt !== null;

  return {
    id: row.id,
    status: row.status,
    subStatus: row.subStatus,
    expectedDeliveryTime: row.startTime,
    restaurantName: f.restaurantName,
    restaurant: place(f.restaurantAddress, f.restaurantLat, f.restaurantLng),
    items: f.items,
    details: f.details,
    quantity: f.quantity,
    estimatedBudget: Number(f.estimatedBudget),
    pickup: place(f.pickupAddress, f.pickupLat, f.pickupLng),
    delivery: place(f.deliveryAddress, f.deliveryLat, f.deliveryLng),
    // The requester's offered delivery charge (0 when none)
    deliveryCharge: money(f.deliveryServiceAmount) ?? 0,
    subArea: f.subArea,
    requester: await miniProfile(row.creator),
    accepter: participant && row.accepter ? await miniProfile(row.accepter) : null,
    chatId: participant ? (row.chat?.id ?? null) : null,
    mine: isRequester,
    role: isRequester ? ("REQUESTER" as const) : isAccepter ? ("ACCEPTER" as const) : null,
    completionRequestedBy: completionBy(row.completionRequestedById, viewerId),
    isLateCancellation: participant ? row.isLateCancellation : false,
    cancelledBy: participant && row.cancelledById ? (row.cancelledById === viewerId ? ("ME" as const) : row.cancelledById === row.creatorId || row.cancelledById === row.accepterId ? ("OTHER" as const) : ("UNIGO" as const)) : null,
    // The order details to confirm (10.3 step 3), for the two participants
    order:
      participant && f.orderVersion > 0
        ? {
            version: f.orderVersion,
            items: f.orderItems,
            foodPrice: money(f.orderFoodPrice),
            deliveryCharge: money(f.orderDeliveryCharge),
            paymentMethod: f.orderPaymentMethod,
            updatedBy: f.orderUpdatedById === viewerId ? ("ME" as const) : ("OTHER" as const),
            updatedAt: f.orderUpdatedAt,
            confirmedByMe,
            confirmedByOther,
          }
        : null,
    approvals: participant
      ? f.approvals.map((a) => ({
          id: a.id,
          amount: Number(a.amount),
          previousAmount: Number(a.previousAmount),
          status: a.status,
          decidedAt: a.decidedAt,
          createdAt: a.createdAt,
        }))
      : [],
    // The receipt photo, through a short-lived signed link (B2b decision 10)
    receipts: participant
      ? await Promise.all(
          f.receipts.map(async (r) => ({
            id: r.id,
            actualCost: money(r.amount),
            image: await signPrivateFileUrl(r.fileKey, Date.now(), rules.chat.image.signedUrlLifetime),
            createdAt: r.createdAt,
          })),
        )
      : [],
    createdAt: row.createdAt,
  };
}

// The card on All Available and Search: no order, approvals or receipts.
export async function foodCard(row: FoodRow, viewerId: string) {
  const f = row.foodRequest!;
  return {
    id: row.id,
    status: row.status,
    expectedDeliveryTime: row.startTime,
    restaurantName: f.restaurantName,
    restaurant: place(f.restaurantAddress, f.restaurantLat, f.restaurantLng),
    items: f.items,
    quantity: f.quantity,
    estimatedBudget: Number(f.estimatedBudget),
    pickup: place(f.pickupAddress, f.pickupLat, f.pickupLng),
    delivery: place(f.deliveryAddress, f.deliveryLat, f.deliveryLng),
    deliveryCharge: money(f.deliveryServiceAmount) ?? 0,
    subArea: f.subArea,
    requester: await miniProfile(row.creator),
    mine: viewerId === row.creatorId,
    createdAt: row.createdAt,
  };
}
