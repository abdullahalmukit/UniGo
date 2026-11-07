import type { Prisma } from "../../generated/prisma/client.js";
import { photoLink } from "../users/photo.js";
import { toPublicVehicle } from "../vehicles/vehicles.js";

// What students see of rides (proposal 8.3, B3a decisions). Built field by
// field: never an email; the phone only to the two participants while the
// ride runs (users/contact.ts, B2b and B3b-1);
// vehicles always through toPublicVehicle() (masked registration number). On
// a shared offer a passenger sees only their own booking and the seats left.

export const personSelect = {
  id: true,
  isVerifiedRider: true,
  university: { select: { name: true, shortName: true } },
  profile: { select: { fullName: true, department: true, photoKey: true } },
} as const satisfies Prisma.UserSelect;

type Person = Prisma.UserGetPayload<{ select: typeof personSelect }>;

// The mini profile on a ride card. Rating, completion rate and badges come in B3b.
export async function miniProfile(user: Person) {
  return {
    id: user.id,
    name: user.profile?.fullName ?? "",
    photo: await photoLink(user.profile?.photoKey),
    university: user.university,
    department: user.profile?.department ?? null,
    isVerifiedRider: user.isVerifiedRider,
    rating: null,
    completionRate: null,
    badges: [] as string[],
  };
}

export const vehicleSelect = {
  id: true,
  type: true,
  brand: true,
  model: true,
  colour: true,
  registrationNumber: true,
  seatCapacity: true,
} as const satisfies Prisma.VehicleSelect;

// isActive: "Create again" leaves a sub-area empty when it is no longer active (B3b-1)
export const subAreaSelect = { id: true, name: true, isActive: true } as const;

const place = (address: string, lat: Prisma.Decimal, lng: Prisma.Decimal) => ({ address, lat: Number(lat), lng: Number(lng) });

// --- Passenger requests

export const requestSelect = {
  id: true,
  status: true,
  subStatus: true,
  startTime: true,
  creatorId: true,
  accepterId: true,
  completionRequestedById: true,
  deletedAt: true,
  createdAt: true,
  creator: { select: personSelect },
  accepter: { select: personSelect },
  chat: { select: { id: true } },
  rideRequest: {
    select: {
      pickupAddress: true,
      pickupLat: true,
      pickupLng: true,
      destinationAddress: true,
      destinationLat: true,
      destinationLng: true,
      offeredAmount: true,
      passengerCount: true,
      notes: true,
      routeDistanceKm: true,
      subArea: { select: subAreaSelect },
      vehicle: { select: vehicleSelect },
    },
  },
} as const satisfies Prisma.ActivitySelect;

export type RequestRow = Prisma.ActivityGetPayload<{ select: typeof requestSelect }>;

export async function requestView(row: RequestRow, viewerId: string) {
  const r = row.rideRequest!;
  const participant = viewerId === row.creatorId || viewerId === row.accepterId;
  return {
    kind: "REQUEST" as const,
    id: row.id,
    status: row.status,
    subStatus: row.subStatus,
    startTime: row.startTime,
    pickup: place(r.pickupAddress, r.pickupLat, r.pickupLng),
    destination: place(r.destinationAddress, r.destinationLat, r.destinationLng),
    offeredAmount: Number(r.offeredAmount),
    passengerCount: r.passengerCount,
    notes: r.notes,
    routeDistanceKm: r.routeDistanceKm === null ? null : Number(r.routeDistanceKm),
    subArea: r.subArea,
    passenger: await miniProfile(row.creator),
    // The rider and their vehicle, once accepted, for the two participants only
    rider: participant && row.accepter ? await miniProfile(row.accepter) : null,
    vehicle: participant && r.vehicle ? toPublicVehicle(r.vehicle) : null,
    chatId: participant ? (row.chat?.id ?? null) : null,
    mine: viewerId === row.creatorId,
    role: viewerId === row.creatorId ? ("PASSENGER" as const) : viewerId === row.accepterId ? ("RIDER" as const) : null,
    completionRequestedBy: completionBy(row.completionRequestedById, viewerId),
    createdAt: row.createdAt,
  };
}

// --- Ride offers

export const offerSelect = {
  id: true,
  riderId: true,
  status: true,
  closeReason: true,
  departureTime: true,
  farePerSeat: true,
  totalSeats: true,
  seatsAvailable: true,
  notes: true,
  routeDistanceKm: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  destinationAddress: true,
  destinationLat: true,
  destinationLng: true,
  createdAt: true,
  subArea: { select: subAreaSelect },
  vehicle: { select: vehicleSelect },
  rider: { select: personSelect },
} as const satisfies Prisma.RideOfferSelect;

export type OfferRow = Prisma.RideOfferGetPayload<{ select: typeof offerSelect }>;

export async function offerView(row: OfferRow, viewerId: string) {
  return {
    kind: "OFFER" as const,
    id: row.id,
    status: row.status,
    closeReason: viewerId === row.riderId ? row.closeReason : null,
    departureTime: row.departureTime,
    pickup: place(row.pickupAddress, row.pickupLat, row.pickupLng),
    destination: place(row.destinationAddress, row.destinationLat, row.destinationLng),
    farePerSeat: Number(row.farePerSeat),
    totalSeats: row.totalSeats,
    seatsAvailable: row.seatsAvailable,
    notes: row.notes,
    routeDistanceKm: row.routeDistanceKm === null ? null : Number(row.routeDistanceKm),
    subArea: row.subArea,
    rider: await miniProfile(row.rider),
    vehicle: toPublicVehicle(row.vehicle),
    mine: viewerId === row.riderId,
    createdAt: row.createdAt,
  };
}

// --- Bookings on an offer

export const bookingSelect = {
  activityId: true,
  seatsBooked: true,
  amount: true,
  createdAt: true,
  activity: {
    select: {
      id: true,
      status: true,
      subStatus: true,
      startTime: true,
      creatorId: true,
      accepterId: true,
      completionRequestedById: true,
      isLateCancellation: true,
      accepter: { select: personSelect },
      chat: { select: { id: true } },
    },
  },
} as const satisfies Prisma.RideBookingSelect;

export type BookingRow = Prisma.RideBookingGetPayload<{ select: typeof bookingSelect }>;

// Who asked for completion, seen by the viewer (the other one confirms).
export function completionBy(requestedById: string | null, viewerId: string) {
  if (!requestedById) return null;
  return requestedById === viewerId ? ("ME" as const) : ("OTHER" as const);
}

export async function bookingView(row: BookingRow) {
  return {
    activityId: row.activityId,
    status: row.activity.status,
    subStatus: row.activity.subStatus,
    seatsBooked: row.seatsBooked,
    amount: Number(row.amount),
    passenger: row.activity.accepter ? await miniProfile(row.activity.accepter) : null,
    chatId: row.activity.chat?.id ?? null,
    createdAt: row.createdAt,
  };
}
