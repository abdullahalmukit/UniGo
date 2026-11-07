import { api } from "../../lib/api";

// Admin › Ride Sharing (proposal 17, B3b-2).

export type RideKind = "requests" | "offers" | "bookings";
export type AdminPerson = { id: string; name: string; email: string; phone: string } | null;

export type AdminRideRow = {
  kind: "REQUEST" | "OFFER" | "BOOKING";
  id: string;
  status: string;
  deleted?: boolean;
  time: string;
  pickup: string;
  destination: string;
  amount: number;
  seats: string | null;
  bookings: number | null;
  creator: AdminPerson;
  accepter: AdminPerson;
};

export type HistoryRow = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  fromSubStatus: string | null;
  toSubStatus: string | null;
  actorType: "USER" | "ADMIN" | "SYSTEM";
  reason: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
};

export type AdminReview = {
  id: string;
  rating: number;
  comment: string | null;
  published: boolean;
  hidden: boolean;
  hiddenReason: string | null;
  reviewer: { id: string; name: string };
  reviewee: { id: string; name: string };
};

export type AdminVehicle = { id: string; type: string; brand: string; model: string; colour: string; registrationNumber: string; seatCapacity: number };

export type AdminRideActivity = {
  kind: "REQUEST" | "BOOKING";
  id: string;
  status: string;
  subStatus: string | null;
  startTime: string;
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  isLateCancellation: boolean;
  closureReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  creator: AdminPerson;
  accepter: AdminPerson;
  cancelledBy: { id: string; name: string } | null;
  rideRequest: {
    pickupAddress: string;
    destinationAddress: string;
    offeredAmount: number;
    passengerCount: number;
    notes: string | null;
    subArea: { id: string; name: string } | null;
    vehicle: AdminVehicle | null;
  } | null;
  rideBooking: { rideOfferId: string; seatsBooked: number; amount: number } | null;
  history: HistoryRow[];
  payment: { amount: number; method: string | null; status: string; paidAt: string | null; payeeId: string } | null;
  reviews: AdminReview[];
};

export type AdminRideOffer = {
  kind: "OFFER";
  id: string;
  status: string;
  closeReason: string | null;
  departureTime: string;
  pickupAddress: string;
  destinationAddress: string;
  farePerSeat: number;
  totalSeats: number;
  seatsAvailable: number;
  notes: string | null;
  subArea: { id: string; name: string } | null;
  vehicle: AdminVehicle;
  rider: AdminPerson;
  bookings: { activityId: string; seatsBooked: number; amount: number; status: string; passenger: AdminPerson }[];
};

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `?${search}`;
}

const enc = encodeURIComponent;

export const adminRidesApi = {
  list: (filters: { kind: RideKind; status?: string; q?: string; date?: string; page: number }) =>
    api<{ items: AdminRideRow[]; total: number; page: number; pageSize: number }>(`/admin/rides${query(filters)}`),
  activity: (id: string) => api<{ ride: AdminRideActivity }>(`/admin/rides/activities/${enc(id)}`).then((r) => r.ride),
  offer: (id: string) => api<{ offer: AdminRideOffer }>(`/admin/rides/offers/${enc(id)}`).then((r) => r.offer),
  cancelActivity: (id: string, reason: string) => api(`/admin/rides/activities/${enc(id)}/cancel`, { method: "POST", body: { reason } }),
  cancelOffer: (id: string, reason: string) => api(`/admin/rides/offers/${enc(id)}/cancel`, { method: "POST", body: { reason } }),
  hideReview: (id: string, reason: string) => api(`/admin/reviews/${enc(id)}/hide`, { method: "POST", body: { reason } }),
};
