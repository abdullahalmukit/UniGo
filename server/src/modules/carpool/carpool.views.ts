import type { Prisma } from "../../generated/prisma/client.js";
import { dateOnlyString } from "../../utils/time.js";
import { miniProfile, personSelect, vehicleSelect } from "../ride/ride.views.js";
import { toPublicVehicle } from "../vehicles/vehicles.js";
import { contractEndDate, nextRideTime } from "./carpool-dates.js";

// What students see of Carpool (proposal section 9, B6a). Built field by
// field: never an email; phones only through users/contact.ts; vehicles only
// through toPublicVehicle() (masked number). On a post a passenger sees only
// their own booking and the seats left (as on a ride offer, B3a addition 2).

const place = (address: string, lat: Prisma.Decimal, lng: Prisma.Decimal) => ({ address, lat: Number(lat), lng: Number(lng) });

export const postSelect = {
  id: true,
  riderId: true,
  status: true,
  closeReason: true,
  pausedAt: true,
  daysOfWeek: true,
  departureMinute: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  destinationAddress: true,
  destinationLat: true,
  destinationLng: true,
  totalSeats: true,
  seatsAvailable: true,
  notes: true,
  validFrom: true,
  validUntil: true,
  createdAt: true,
  prices: { orderBy: { durationMonths: "asc" }, select: { durationMonths: true, monthlyPrice: true } },
  vehicle: { select: vehicleSelect },
  rider: { select: personSelect },
} as const satisfies Prisma.CarpoolPostSelect;

export type PostRow = Prisma.CarpoolPostGetPayload<{ select: typeof postSelect }>;

export const scheduleOf = (row: { daysOfWeek: number; departureMinute: number; validFrom: Date; validUntil: Date | null }) => ({
  daysOfWeek: row.daysOfWeek,
  departureMinute: row.departureMinute,
  validFrom: dateOnlyString(row.validFrom),
  validUntil: row.validUntil ? dateOnlyString(row.validUntil) : null,
});

// `sessionCancellations`: the rider's cancelled carpool sessions (9.6),
// shown to passengers before they book.
export async function postView(row: PostRow, viewerId: string, sessionCancellations = 0, now = new Date()) {
  const schedule = scheduleOf(row);
  return {
    kind: "CARPOOL_POST" as const,
    id: row.id,
    status: row.status,
    closeReason: viewerId === row.riderId ? row.closeReason : null,
    paused: row.pausedAt !== null,
    ...schedule,
    nextRide: row.status === "CLOSED" ? null : nextRideTime(schedule, now),
    pickup: place(row.pickupAddress, row.pickupLat, row.pickupLng),
    destination: place(row.destinationAddress, row.destinationLat, row.destinationLng),
    totalSeats: row.totalSeats,
    seatsAvailable: row.seatsAvailable,
    notes: row.notes,
    prices: row.prices.map((p) => ({ durationMonths: p.durationMonths, monthlyPrice: Number(p.monthlyPrice) })),
    rider: await miniProfile(row.rider),
    vehicle: toPublicVehicle(row.vehicle),
    riderSessionCancellations: sessionCancellations,
    mine: viewerId === row.riderId,
    createdAt: row.createdAt,
  };
}

export const bookingSelect = {
  activityId: true,
  postId: true,
  durationMonths: true,
  monthlyPrice: true,
  startDate: true,
  holdExpiresAt: true,
  riderAgreedAt: true,
  passengerAgreedAt: true,
  rejectionReason: true,
  createdAt: true,
  contract: { select: { id: true, startDate: true, endDate: true, status: true } },
  activity: {
    select: {
      id: true,
      status: true,
      subStatus: true,
      startTime: true,
      creatorId: true,
      accepterId: true,
      closureReason: true,
      cancelledById: true,
      cancellationReason: true,
      isLateCancellation: true,
      accepter: { select: personSelect },
      creator: { select: personSelect },
      chat: { select: { id: true } },
    },
  },
} as const satisfies Prisma.CarpoolBookingSelect;

export type BookingRow = Prisma.CarpoolBookingGetPayload<{ select: typeof bookingSelect }>;

const whoDid = (userId: string | null, viewerId: string) => (!userId ? null : userId === viewerId ? ("ME" as const) : ("OTHER" as const));

export async function bookingView(row: BookingRow, viewerId: string) {
  const a = row.activity;
  const isRider = viewerId === a.creatorId;
  const start = dateOnlyString(row.startDate);
  const myAgree = isRider ? row.riderAgreedAt : row.passengerAgreedAt;
  const otherAgree = isRider ? row.passengerAgreedAt : row.riderAgreedAt;
  return {
    activityId: row.activityId,
    postId: row.postId,
    status: a.status,
    subStatus: a.subStatus,
    durationMonths: row.durationMonths,
    monthlyPrice: Number(row.monthlyPrice),
    startDate: start,
    endDate: row.contract ? dateOnlyString(row.contract.endDate) : contractEndDate(start, row.durationMonths),
    firstRide: a.startTime,
    // While the seat is held (ACCEPTED, no contract yet)
    holdExpiresAt: a.status === "ACCEPTED" && a.subStatus === null ? row.holdExpiresAt : null,
    agreed: { me: myAgree !== null, other: otherAgree !== null },
    rejectionReason: row.rejectionReason,
    closureReason: a.closureReason,
    cancelledBy: whoDid(a.cancelledById, viewerId),
    cancellationReason: a.cancellationReason,
    isLateCancellation: a.isLateCancellation,
    contract: row.contract
      ? { id: row.contract.id, startDate: dateOnlyString(row.contract.startDate), endDate: dateOnlyString(row.contract.endDate), status: row.contract.status }
      : null,
    passenger: a.accepter ? await miniProfile(a.accepter) : null,
    rider: await miniProfile(a.creator),
    chatId: a.chat?.id ?? null,
    role: isRider ? ("RIDER" as const) : ("PASSENGER" as const),
    createdAt: row.createdAt,
  };
}
