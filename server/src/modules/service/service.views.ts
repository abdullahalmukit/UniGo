import type { Prisma } from "../../generated/prisma/client.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { completionBy, miniProfile, personSelect, subAreaSelect } from "../ride/ride.views.js";

export const serviceSelect = {
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
  serviceRequest: {
    select: {
      id: true,
      categoryId: true,
      category: { select: { id: true, code: true } },
      serviceTitle: true,
      taskTitle: true,
      description: true,
      destinationAddress: true,
      destinationLat: true,
      destinationLng: true,
      preferredDate: true,
      hasPreferredTime: true,
      offeredAmount: true,
      itemDetails: true,
      quantity: true,
      referenceImageKey: true,
      pickupAddress: true,
      pickupLat: true,
      pickupLng: true,
      subAreaId: true,
      subArea: { select: subAreaSelect },
      estimatedBudget: true,
      instructions: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.ActivitySelect;

export type ServiceRow = Prisma.ActivityGetPayload<{ select: typeof serviceSelect }>;

export async function serviceView(row: ServiceRow, viewerId: string) {
  const req = row.serviceRequest!;
  const mine = viewerId === row.creatorId;
  const isAccepter = viewerId === row.accepterId;
  const participant = mine || isAccepter;

  return {
    id: row.id,
    status: row.status,
    subStatus: row.subStatus,
    startTime: row.startTime.toISOString(),
    preferredDate: req.preferredDate.toISOString().slice(0, 10),
    hasPreferredTime: req.hasPreferredTime,
    categoryId: req.categoryId,
    category: req.category,
    serviceTitle: req.serviceTitle,
    taskTitle: req.taskTitle,
    description: req.description,
    destination: {
      address: req.destinationAddress,
      lat: Number(req.destinationLat),
      lng: Number(req.destinationLng),
    },
    pickup: req.pickupAddress
      ? {
          address: req.pickupAddress,
          lat: req.pickupLat ? Number(req.pickupLat) : 0,
          lng: req.pickupLng ? Number(req.pickupLng) : 0,
        }
      : null,
    subArea: req.subArea,
    offeredAmount: Number(req.offeredAmount),
    estimatedBudget: req.estimatedBudget ? Number(req.estimatedBudget) : null,
    itemDetails: req.itemDetails,
    quantity: req.quantity,
    instructions: req.instructions,
    referenceImage: req.referenceImageKey ? await signPrivateFileUrl(req.referenceImageKey) : null,
    requester: await miniProfile(row.creator),
    accepter: row.accepter ? await miniProfile(row.accepter) : null,
    chatId: participant ? row.chat?.id ?? null : null,
    mine,
    role: mine ? "REQUESTER" : isAccepter ? "ACCEPTER" : null,
    completionRequestedBy: completionBy(row.completionRequestedById, viewerId),
    isLateCancellation: row.isLateCancellation,
    createdAt: row.createdAt.toISOString(),
  };
}
