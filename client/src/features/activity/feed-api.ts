import { useEffect, useRef } from "react";
import { api } from "../../lib/api";
import { chatSocket } from "../../lib/socket";
import type { ActivityStatus, CompletionBy, MiniProfile, Place, PostStatus } from "../ride/ride-api";

// Activity (proposal 12.2) and Upcoming (12.3), B3b-1.

export type Feature = "all" | "ride" | "carpool" | "food" | "service";
export type Role = "all" | "requested" | "accepted";
export type Tab = "active" | "ongoing" | "history";

export type FeedBooking = {
  activityId: string;
  status: ActivityStatus;
  seatsBooked: number;
  amount: number;
  passenger: MiniProfile | null;
  phone: string | null;
};

export type FeedItem = {
  feature: "RIDE";
  kind: "RIDE_REQUEST" | "RIDE_OFFER" | "RIDE_BOOKING";
  id: string;
  role: "REQUESTED" | "ACCEPTED";
  status: ActivityStatus | PostStatus;
  subStatus: string | null;
  completionRequestedBy: CompletionBy;
  time: string;
  pickup: Place;
  destination: Place;
  amount: number;
  seats: number | null;
  otherPerson: MiniProfile | null;
  phone: string | null;
  chatId: string | null;
  // B3b-2
  payment: { amount: number; method: string | null; status: "UNPAID" | "PAID"; payee: "ME" | "OTHER" } | null;
  review: "CAN_REVIEW" | "REVIEWED" | null;
  bookings: FeedBooking[];
  activeBookings: number;
};

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "all") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const listActivity = (filters: { feature: Feature; role: Role; tab: Tab; page?: number }) =>
  api<{ items: FeedItem[]; page: number; hasMore: boolean }>(`/activity${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`);

export const listUpcoming = (filters: { feature?: Feature; role?: Role; limit?: number } = {}) =>
  api<{ items: FeedItem[] }>(`/upcoming${query(filters)}`);

// Reloads when a notification about an activity arrives (a status change) and
// when the tab becomes visible again (B3b-1 addition 3).
export function useFeedRefresh(reload: () => void) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const stop = chatSocket.on("notification:new", (event: { notification?: { activityId?: string | null } }) => {
      if (event.notification?.activityId) latest.current();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

// The page an item opens
export function itemPath(item: Pick<FeedItem, "kind" | "id">) {
  const id = encodeURIComponent(item.id);
  if (item.kind === "RIDE_OFFER") return `/ride/offers/${id}`;
  if (item.kind === "RIDE_BOOKING") return `/ride/bookings/${id}`;
  return `/ride/requests/${id}`;
}
