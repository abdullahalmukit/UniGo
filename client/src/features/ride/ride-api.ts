import { api } from "../../lib/api";

// Ride Sharing (proposal section 8, B3a). Start, completion, cancelling a
// booking or an accepted request and deleting an OPEN request use the common
// /activities endpoints (B2a).

export type SignedLink = { url: string; expiresAt: string };
export type Place = { address: string; lat: number; lng: number };
export type ActivityStatus = "OPEN" | "ACCEPTED" | "IN_PROGRESS" | "DISPUTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "NOT_MARKED";
export type PostStatus = "OPEN" | "FULL" | "CLOSED";

export type MiniProfile = {
  id: string;
  name: string;
  photo: SignedLink | null;
  university: { name: string; shortName: string | null } | null;
  department: string | null;
  isVerifiedRider: boolean;
  rating: number | null;
  completionRate: number | null;
  badges: string[];
};

export type PublicVehicle = {
  id: string;
  type: "BIKE" | "CAR";
  brand: string;
  model: string;
  colour: string;
  seatCapacity: number;
  registrationNumber: string;
};

export type CompletionBy = "ME" | "OTHER" | null;

export type RideRequest = {
  kind: "REQUEST";
  id: string;
  status: ActivityStatus;
  subStatus: string | null;
  startTime: string;
  pickup: Place;
  destination: Place;
  offeredAmount: number;
  passengerCount: number;
  notes: string | null;
  routeDistanceKm: number | null;
  subArea: { id: string; name: string };
  passenger: MiniProfile;
  rider: MiniProfile | null;
  vehicle: PublicVehicle | null;
  chatId: string | null;
  mine: boolean;
  role: "PASSENGER" | "RIDER" | null;
  completionRequestedBy: CompletionBy;
  createdAt: string;
};

export type RideBookingSummary = {
  activityId: string;
  status: ActivityStatus;
  subStatus: string | null;
  seatsBooked: number;
  amount: number;
  passenger: MiniProfile | null;
  chatId: string | null;
  createdAt: string;
};

export type RideOffer = {
  kind: "OFFER";
  id: string;
  status: PostStatus;
  closeReason: string | null;
  departureTime: string;
  pickup: Place;
  destination: Place;
  farePerSeat: number;
  totalSeats: number;
  seatsAvailable: number;
  notes: string | null;
  routeDistanceKm: number | null;
  subArea: { id: string; name: string } | null;
  rider: MiniProfile;
  vehicle: PublicVehicle;
  mine: boolean;
  createdAt: string;
  // Detail only: every booking for the rider; for a passenger only their own
  bookings?: RideBookingSummary[];
  myBooking?: RideBookingSummary | null;
};

export type RideBooking = RideBookingSummary & {
  startTime: string;
  isLateCancellation: boolean;
  role: "RIDER" | "PASSENGER";
  completionRequestedBy: CompletionBy;
  offer: RideOffer;
};

export type RideItem = RideRequest | RideOffer;

export type RideConfig = {
  amount: { min: number; max: number };
  passengers: { min: number; max: number };
  notesMaxLength: number;
  searchRadiusKm: number[];
  defaultSearchRadiusKm: number;
  startAllowedBeforeMinutes: number;
  earliestFromNowMinutes: number;
  latestFromNowHours: number;
  seats: { bike: { min: number; max: number }; car: { min: number; max: number } };
};

export type RideFilters = {
  type?: "all" | "requests" | "offers";
  pickup?: Place | null;
  destination?: Place | null;
  radiusKm?: number;
  date?: string;
  timeFrom?: string;
  timeTo?: string;
  subAreaId?: string;
  page?: number;
};

export type RequestInput = {
  pickup: Place;
  destination: Place;
  startTime: string;
  offeredAmount: number;
  passengerCount: number;
  notes: string | null;
  subAreaId: string;
};

export type OfferInput = {
  pickup: Place;
  destination: Place;
  departureTime: string;
  farePerSeat: number;
  vehicleId: string;
  seats: number;
  notes: string | null;
  subAreaId: string | null;
};

export const getRideConfig = () => api<RideConfig>("/rides/config");

export function listRides(filters: RideFilters = {}) {
  const params = new URLSearchParams();
  if (filters.type && filters.type !== "all") params.set("type", filters.type);
  if (filters.pickup) {
    params.set("pickupLat", String(filters.pickup.lat));
    params.set("pickupLng", String(filters.pickup.lng));
  }
  if (filters.destination) {
    params.set("destinationLat", String(filters.destination.lat));
    params.set("destinationLng", String(filters.destination.lng));
  }
  if ((filters.pickup || filters.destination) && filters.radiusKm) params.set("radiusKm", String(filters.radiusKm));
  if (filters.date) params.set("date", filters.date);
  if (filters.timeFrom) params.set("timeFrom", filters.timeFrom);
  if (filters.timeTo) params.set("timeTo", filters.timeTo);
  if (filters.subAreaId) params.set("subAreaId", filters.subAreaId);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return api<{ items: RideItem[]; page: number; hasMore: boolean }>(`/rides${query ? `?${query}` : ""}`);
}

export type FareEstimate = { distanceKm: number | null; ratePerKm: number | null; suggested: number | null };
export const estimateFare = (from: Place, to: Place) =>
  api<FareEstimate>(`/rides/fare-estimate?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`);

const enc = encodeURIComponent;

export const createRequest = (input: RequestInput) => api<{ request: RideRequest }>("/rides/requests", { method: "POST", body: input });
export const getRequest = (id: string) => api<{ request: RideRequest }>(`/rides/requests/${enc(id)}`);
export const updateRequest = (id: string, input: Partial<RequestInput>) =>
  api<{ request: RideRequest }>(`/rides/requests/${enc(id)}`, { method: "PATCH", body: input });
export const upgradeRequest = (id: string, offeredAmount: number) =>
  api<{ request: RideRequest }>(`/rides/requests/${enc(id)}/upgrade`, { method: "POST", body: { offeredAmount } });
export const acceptRequest = (id: string, vehicleId: string) =>
  api<{ request: RideRequest }>(`/rides/requests/${enc(id)}/accept`, { method: "POST", body: { vehicleId } });

export const createOffer = (input: OfferInput) => api<{ offer: RideOffer }>("/rides/offers", { method: "POST", body: input });
export const getOffer = (id: string) => api<{ offer: RideOffer }>(`/rides/offers/${enc(id)}`);
export const updateOffer = (id: string, input: Partial<OfferInput>) => api<{ offer: RideOffer }>(`/rides/offers/${enc(id)}`, { method: "PATCH", body: input });
export const stopOffer = (id: string) => api<{ offer: RideOffer }>(`/rides/offers/${enc(id)}/stop`, { method: "POST" });
export const cancelOffer = (id: string, reason: string) => api<{ offer: RideOffer }>(`/rides/offers/${enc(id)}/cancel`, { method: "POST", body: { reason } });
export const removeOffer = (id: string) => api<{ offer: RideOffer }>(`/rides/offers/${enc(id)}`, { method: "DELETE" });
export const bookOffer = (id: string, seats: number) => api<{ booking: RideBooking }>(`/rides/offers/${enc(id)}/bookings`, { method: "POST", body: { seats } });
export const getBooking = (activityId: string) => api<{ booking: RideBooking }>(`/rides/bookings/${enc(activityId)}`);

// Lifecycle steps of an accepted ride (B2a endpoints)
export const startActivity = (id: string) => api(`/activities/${enc(id)}/start`, { method: "POST" });
export const requestCompletion = (id: string) => api(`/activities/${enc(id)}/request-completion`, { method: "POST" });
export const confirmCompletion = (id: string) => api(`/activities/${enc(id)}/confirm-completion`, { method: "POST" });
export const cancelActivity = (id: string, reason: string) => api(`/activities/${enc(id)}/cancel`, { method: "POST", body: { reason } });
export const deleteActivity = (id: string) => api(`/activities/${enc(id)}`, { method: "DELETE" });
