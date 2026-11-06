import type { ActivityStatus, ActivitySubStatus, ActivityType, PostStatus } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { registerUser } from "./helpers.js";

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const fromNow = (ms: number, now = new Date()) => new Date(now.getTime() + ms);

// The race tests register many users; the register rate limit is not what they test.
export const verifiedUser = () => {
  resetRateLimits();
  return registerUser({ studentVerificationStatus: "VERIFIED" });
};

// Inserts an activity directly (features that create them come in B3 on).
export function createActivity(input: {
  type?: ActivityType;
  creatorId: string;
  accepterId?: string | null;
  status?: ActivityStatus;
  subStatus?: ActivitySubStatus | null;
  startTime?: Date;
  blocksTime?: boolean;
  conflictGroupId?: string | null;
  completionRequestedAt?: Date | null;
  completionRequestedById?: string | null;
  createdAt?: Date;
  deletedAt?: Date | null;
}) {
  return prisma.activity.create({
    data: {
      type: input.type ?? "FOOD",
      creatorId: input.creatorId,
      accepterId: input.accepterId ?? null,
      status: input.status ?? "OPEN",
      subStatus: input.subStatus ?? null,
      startTime: input.startTime ?? fromNow(2 * HOUR),
      blocksTime: input.blocksTime ?? true,
      conflictGroupId: input.conflictGroupId ?? null,
      completionRequestedAt: input.completionRequestedAt ?? null,
      completionRequestedById: input.completionRequestedById ?? null,
      deletedAt: input.deletedAt ?? null,
      ...(input.createdAt && { createdAt: input.createdAt }),
    },
  });
}

let plate = 0;

export async function createRideOffer(
  riderId: string,
  input: { seats?: number; seatsAvailable?: number; departureTime?: Date; status?: PostStatus; createdAt?: Date } = {},
) {
  plate += 1;
  const registrationNumber = `DHAKA-${String(plate).padStart(6, "0")}`;
  const vehicle = await prisma.vehicle.create({
    data: {
      ownerId: riderId,
      type: "CAR",
      brand: "Toyota",
      model: "Axio",
      colour: "White",
      registrationNumber,
      registrationNumberNormalized: registrationNumber,
      photoKey: "vehicle-photos/test.jpg",
      seatCapacity: 4,
      status: "APPROVED",
    },
  });
  const seats = input.seats ?? 2;
  return prisma.rideOffer.create({
    data: {
      riderId,
      vehicleId: vehicle.id,
      pickupAddress: "Campus gate",
      pickupLat: 23.8,
      pickupLng: 90.4,
      destinationAddress: "Farmgate",
      destinationLat: 23.75,
      destinationLng: 90.39,
      departureTime: input.departureTime ?? fromNow(3 * HOUR),
      farePerSeat: 80,
      totalSeats: seats,
      seatsAvailable: input.seatsAvailable ?? seats,
      status: input.status ?? "OPEN",
      ...(input.createdAt && { createdAt: input.createdAt }),
    },
  });
}

export const storedActivity = (id: string) => prisma.activity.findUniqueOrThrow({ where: { id } });

export const historyOf = (activityId: string) =>
  prisma.activityStatusHistory.findMany({ where: { activityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

// The error code a rejected promise carries, or "OK".
export async function outcomeCode(promise: Promise<unknown>) {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

// Two verified users and an activity accepted through the engine, so its chat
// was opened in the accept transaction like in the app.
export async function acceptedWithChat(type: "FOOD" | "SERVICE" | "RIDE_REQUEST" = "FOOD", startTime = fromNow(2 * HOUR)) {
  const { acceptActivity } = await import("../../src/modules/activities/engine.js");
  const [creator, accepter] = await Promise.all([verifiedUser(), verifiedUser()]);
  const activity = await createActivity({ type, creatorId: creator.id, startTime });
  await acceptActivity(activity.id, accepter.id);
  const chat = await prisma.chat.findUniqueOrThrow({ where: { activityId: activity.id } });
  return { creator, accepter, activity, chatId: chat.id };
}
