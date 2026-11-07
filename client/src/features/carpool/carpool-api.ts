import { api } from "../../lib/api";
import type { ActivityStatus, MiniProfile, Place, PostStatus, PublicVehicle } from "../ride/ride-api";

// Carpool (proposal section 9, B6a). Cancelling a held seat uses the common
// /activities cancel endpoint (B2a); My Carpool Posts and My Bookings are the
// Activity feed with feature=carpool (B3b-1).

export type CarpoolPrice = { durationMonths: number; monthlyPrice: number };

export type CarpoolPost = {
  kind: "CARPOOL_POST";
  id: string;
  status: PostStatus;
  closeReason: string | null;
  paused: boolean;
  // Bitmask: bit 0 = Sunday ... bit 6 = Saturday
  daysOfWeek: number;
  // Minutes after midnight, Asia/Dhaka
  departureMinute: number;
  validFrom: string;
  validUntil: string | null;
  nextRide: string | null;
  pickup: Place;
  destination: Place;
  totalSeats: number;
  seatsAvailable: number;
  notes: string | null;
  prices: CarpoolPrice[];
  rider: MiniProfile;
  vehicle: PublicVehicle;
  riderSessionCancellations: number;
  mine: boolean;
  createdAt: string;
};

export type CarpoolBookingSummary = {
  activityId: string;
  postId: string;
  status: ActivityStatus;
  subStatus: string | null;
  durationMonths: number;
  monthlyPrice: number;
  startDate: string;
  endDate: string;
  firstRide: string;
  holdExpiresAt: string | null;
  agreed: { me: boolean; other: boolean };
  rejectionReason: string | null;
  closureReason: string | null;
  cancelledBy: "ME" | "OTHER" | null;
  cancellationReason: string | null;
  isLateCancellation: boolean;
  contract: { id: string; startDate: string; endDate: string; status: "ACTIVE" | "ENDED" | "TERMINATED" } | null;
  passenger: MiniProfile | null;
  rider: MiniProfile;
  chatId: string | null;
  role: "RIDER" | "PASSENGER";
  createdAt: string;
  phone?: string | null;
};

export type CarpoolSession = { activityId: string; date: string; startTime: string; status: ActivityStatus; cancelledBy: "ME" | "OTHER" | null };

export type CarpoolBooking = CarpoolBookingSummary & { post: CarpoolPost; sessions: CarpoolSession[] };

export type CarpoolPostDetail = CarpoolPost & { bookings: CarpoolBookingSummary[]; myBooking: CarpoolBookingSummary | null };

export type CarpoolConfig = {
  maxSchedules: number;
  durationMonths: number[];
  monthlyPrice: { min: number; max: number };
  notesMaxLength: number;
  validFromMaxDaysAhead: number;
  rejectReasonMaxLength: number;
  seatHoldHours: number;
  searchRadiusKm: number[];
  defaultSearchRadiusKm: number;
  seats: { bike: { min: number; max: number }; car: { min: number; max: number } };
};

export type CarpoolFilters = {
  day?: number;
  timeFrom?: string;
  timeTo?: string;
  pickup?: Place | null;
  destination?: Place | null;
  radiusKm?: number;
  page?: number;
};

export type PostInput = {
  daysOfWeek: number;
  departureMinute: number;
  pickup: Place;
  destination: Place;
  vehicleId: string;
  seats: number;
  notes: string | null;
  prices: CarpoolPrice[];
  validFrom: string;
  validUntil: string | null;
};

export type Quote = { startDate: string; endDate: string; sessions: number; firstRide: string | null; monthlyPrice: number; total: number };

function query(filters: CarpoolFilters) {
  const search = new URLSearchParams();
  if (filters.day !== undefined) search.set("day", String(filters.day));
  if (filters.timeFrom) search.set("timeFrom", filters.timeFrom);
  if (filters.timeTo) search.set("timeTo", filters.timeTo);
  if (filters.pickup) (search.set("pickupLat", String(filters.pickup.lat)), search.set("pickupLng", String(filters.pickup.lng)));
  if (filters.destination) (search.set("destinationLat", String(filters.destination.lat)), search.set("destinationLng", String(filters.destination.lng)));
  if (filters.radiusKm) search.set("radiusKm", String(filters.radiusKm));
  if (filters.page && filters.page > 1) search.set("page", String(filters.page));
  const text = search.toString();
  return text ? `?${text}` : "";
}

const json = (method: "POST" | "PATCH" | "DELETE", body?: unknown) => ({ method, ...(body !== undefined && { body }) });

export const getCarpoolConfig = () => api<CarpoolConfig>("/carpool/config");
export const searchCarpools = (filters: CarpoolFilters) => api<{ items: CarpoolPost[]; page: number; hasMore: boolean }>(`/carpool${query(filters)}`);
export const getPost = (id: string) => api<{ post: CarpoolPostDetail }>(`/carpool/posts/${encodeURIComponent(id)}`);
export const createPost = (body: PostInput) => api<{ post: CarpoolPostDetail }>("/carpool/posts", json("POST", body));
export const updatePost = (id: string, body: Partial<PostInput>) => api<{ post: CarpoolPostDetail }>(`/carpool/posts/${encodeURIComponent(id)}`, json("PATCH", body));
export const addSeats = (id: string, seats: number) => api<{ post: CarpoolPostDetail }>(`/carpool/posts/${encodeURIComponent(id)}/seats`, json("POST", { seats }));
export const pausePost = (id: string, paused: boolean) =>
  api<{ post: CarpoolPostDetail }>(`/carpool/posts/${encodeURIComponent(id)}/${paused ? "pause" : "resume"}`, json("POST"));
export const removePost = (id: string) => api<{ post: CarpoolPostDetail }>(`/carpool/posts/${encodeURIComponent(id)}`, json("DELETE"));
export const quote = (id: string, durationMonths: number, startDate: string) =>
  api<Quote>(`/carpool/posts/${encodeURIComponent(id)}/quote?durationMonths=${durationMonths}&startDate=${startDate}`);

export const requestSeat = (postId: string, durationMonths: number, startDate: string) =>
  api<{ booking: CarpoolBooking }>(`/carpool/posts/${encodeURIComponent(postId)}/bookings`, json("POST", { durationMonths, startDate }));
export const getBooking = (id: string) => api<{ booking: CarpoolBooking }>(`/carpool/bookings/${encodeURIComponent(id)}`);
export const acceptBooking = (id: string) => api<{ booking: CarpoolBooking }>(`/carpool/bookings/${encodeURIComponent(id)}/accept`, json("POST"));
export const rejectBooking = (id: string, reason: string | null) =>
  api<{ booking: CarpoolBooking }>(`/carpool/bookings/${encodeURIComponent(id)}/reject`, json("POST", reason ? { reason } : {}));
export const withdrawBooking = (id: string) => api<{ booking: CarpoolBooking }>(`/carpool/bookings/${encodeURIComponent(id)}/withdraw`, json("POST"));
export const agreeBooking = (id: string) => api<{ booking: CarpoolBooking }>(`/carpool/bookings/${encodeURIComponent(id)}/agree`, json("POST"));

// --- Days and times

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const runsOn = (mask: number, day: number) => (mask & (1 << day)) !== 0;

// "08:30" (24-hour, for the time selects) <-> minutes after midnight
export const minuteToTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export const timeToMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

// Today in Asia/Dhaka as "YYYY-MM-DD", plus days
export function dhakaDate(addDays = 0, now = new Date()) {
  return new Date(now.getTime() + 6 * 60 * 60 * 1000 + addDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The weekday of a "YYYY-MM-DD" date (0 = Sunday)
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();
