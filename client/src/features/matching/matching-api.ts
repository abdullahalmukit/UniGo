import { api } from "../../lib/api";

// B9 Stage 1 (proposal section 20): ranked suggestions with reasons, and the
// Uni Service category hint. AI only recommends; users always choose.

export type MatchFeature = "ride" | "carpool" | "food" | "service";
export type MatchTarget = "ride_offer" | "ride_request" | "carpool_post" | "food" | "service";
export type MatchReason =
  | { code: "PICKUP_NEAR"; km: number }
  | { code: "DESTINATION_NEAR"; km: number }
  | { code: "SAME_DIRECTION" }
  | { code: "TIME_CLOSE"; minutes: number }
  | { code: "HIGH_RATING"; rating: number }
  | { code: "RELIABLE"; percent: number };

type Place = { address: string; lat: number; lng: number } | null;
// The fields of the listed item that the suggestion card shows
export type MatchItem = {
  id: string;
  pickup?: Place;
  destination?: Place;
  restaurant?: Place;
  restaurantName?: string;
  delivery?: Place;
  taskTitle?: string;
  startTime?: string;
  departureTime?: string;
  expectedDeliveryTime?: string;
  departureMinute?: number;
  rider?: { name: string } | null;
  passenger?: { name: string } | null;
  requester?: { name: string } | null;
};

export type Suggestion = { rank: number; score: number; reasons: MatchReason[]; target: MatchTarget; item: MatchItem };
export type SuggestionsResult = { feature: MatchFeature; target: MatchTarget; sourceId: string | null; suggestions: Suggestion[] };

export type SuggestionsQuery = {
  feature: MatchFeature;
  target?: "offers" | "requests";
  from?: string;
  pickup?: { lat: number; lng: number } | null;
  destination?: { lat: number; lng: number } | null;
  time?: string;
  seats?: number;
  limit?: number;
};

export function getSuggestions(query: SuggestionsQuery) {
  const params = new URLSearchParams({ feature: query.feature });
  if (query.target) params.set("target", query.target);
  if (query.from) params.set("from", query.from);
  if (query.pickup) (params.set("pickupLat", String(query.pickup.lat)), params.set("pickupLng", String(query.pickup.lng)));
  if (query.destination) (params.set("destinationLat", String(query.destination.lat)), params.set("destinationLng", String(query.destination.lng)));
  if (query.time) params.set("time", query.time);
  if (query.seats) params.set("seats", String(query.seats));
  if (query.limit) params.set("limit", String(query.limit));
  return api<SuggestionsResult>(`/matching/suggestions?${params}`);
}

export const getCategoryHint = (text: string) =>
  api<{ suggestion: { categoryId: string; code: string; confidence: number } | null }>(`/matching/service-category?${new URLSearchParams({ text })}`);

export function suggestionLink(target: MatchTarget, id: string) {
  const enc = encodeURIComponent(id);
  switch (target) {
    case "ride_offer":
      return `/ride/offers/${enc}`;
    case "ride_request":
      return `/ride/requests/${enc}`;
    case "carpool_post":
      return `/carpool/posts/${enc}`;
    case "food":
      return `/food/requests/${enc}`;
    default:
      return `/service/requests/${enc}`;
  }
}
