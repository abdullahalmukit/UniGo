import { api } from "../../lib/api";
import type { MiniProfile, Place } from "../ride/ride-api";

export type ServiceFeature = "all" | "ride" | "food" | "carpool" | "service";

export type ServiceRequestCardItem = {
  id: string;
  activityId?: string;
  feature: "ride" | "food" | "carpool" | "service";
  kind: "RIDE_REQUEST" | "FOOD" | "CARPOOL_POST" | "SERVICE";
  status: "OPEN";
  title: string;
  creator: MiniProfile;
  pickup: Place;
  destination: Place;
  time: string;
  amount: number;
  amountLabel: string;
  subArea: { id: string; name: string } | null;
  mine: boolean;
  details: {
    notes?: string | null;
    items?: string | null;
    passengerCount?: number;
    availableSeats?: number;
    totalSeats?: number;
    restaurantName?: string;
    deliveryCharge?: number;
    vehicle?: {
      id: string;
      type: "BIKE" | "CAR";
      brand: string;
      model: string;
      colour: string;
      seatCapacity: number;
      registrationNumber: string;
    } | null;
    prices?: { durationMonths: number; monthlyPrice: number }[];
  };
  link: string;
  createdAt: string;
};

export type ListAllRequestsQuery = {
  feature?: ServiceFeature;
  search?: string;
  subAreaId?: string;
  date?: string;
  page?: number;
  limit?: number;
};

export type ListAllRequestsResult = {
  items: ServiceRequestCardItem[];
  total: number;
  page: number;
  hasMore: boolean;
};

export async function listAllRequests(query: ListAllRequestsQuery = {}): Promise<ListAllRequestsResult> {
  const params = new URLSearchParams();
  if (query.feature && query.feature !== "all") params.set("feature", query.feature);
  if (query.search) params.set("search", query.search);
  if (query.subAreaId) params.set("subAreaId", query.subAreaId);
  if (query.date) params.set("date", query.date);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));

  const qs = params.toString();
  return api<ListAllRequestsResult>(`/services/requests${qs ? `?${qs}` : ""}`);
}

