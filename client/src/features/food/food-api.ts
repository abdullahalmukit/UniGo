import { api } from "../../lib/api";
import type { ActivityStatus, CompletionBy, MiniProfile, Place, SignedLink, SubAreaRef } from "../ride/ride-api";

// Food Delivery (proposal section 10, B4). Cancelling, completion and deleting
// an OPEN request use the common /activities endpoints (B2a); the payment and
// reviews use the B3b-2 activity endpoints.

export type PaymentMethod = "CASH" | "BKASH" | "NAGAD";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export type FoodOrder = {
  version: number;
  items: string | null;
  foodPrice: number | null;
  deliveryCharge: number | null;
  paymentMethod: PaymentMethod | null;
  updatedBy: "ME" | "OTHER";
  updatedAt: string | null;
  confirmedByMe: boolean;
  confirmedByOther: boolean;
};

export type FoodApproval = { id: string; amount: number; previousAmount: number; status: ApprovalStatus; decidedAt: string | null; createdAt: string };
export type FoodReceipt = { id: string; actualCost: number | null; image: SignedLink; createdAt: string };

export type FoodRequest = {
  id: string;
  status: ActivityStatus;
  subStatus: string | null;
  expectedDeliveryTime: string;
  restaurantName: string;
  restaurant: Place;
  items: string;
  details: string;
  quantity: number;
  estimatedBudget: number;
  pickup: Place;
  delivery: Place;
  deliveryCharge: number;
  subArea: SubAreaRef;
  requester: MiniProfile;
  accepter: MiniProfile | null;
  chatId: string | null;
  mine: boolean;
  role: "REQUESTER" | "ACCEPTER" | null;
  completionRequestedBy: CompletionBy;
  isLateCancellation: boolean;
  cancelledBy: "ME" | "OTHER" | "UNIGO" | null;
  order: FoodOrder | null;
  approvals: FoodApproval[];
  receipts: FoodReceipt[];
  createdAt: string;
  // The other participant's phone while it runs (detail only)
  phone?: string | null;
};

// A card on All Available and Search
export type FoodCardItem = Pick<
  FoodRequest,
  | "id"
  | "status"
  | "expectedDeliveryTime"
  | "restaurantName"
  | "restaurant"
  | "items"
  | "quantity"
  | "estimatedBudget"
  | "pickup"
  | "delivery"
  | "deliveryCharge"
  | "subArea"
  | "requester"
  | "mine"
  | "createdAt"
>;

export type FoodConfig = {
  budget: { min: number; max: number };
  deliveryCharge: { min: number; max: number };
  quantity: { min: number; max: number };
  restaurantNameMaxLength: number;
  itemsMaxLength: number;
  detailsMaxLength: number;
  searchRadiusKm: number[];
  defaultSearchRadiusKm: number;
  earliestFromNowMinutes: number;
  latestFromNowHours: number;
  paymentMethods: PaymentMethod[];
};

export type FoodFilters = {
  restaurant?: Place | null;
  delivery?: Place | null;
  radiusKm?: number;
  date?: string;
  subAreaId?: string;
  page?: number;
};

export type FoodInput = {
  restaurantName: string;
  restaurant: Place;
  items: string;
  details: string;
  quantity: number;
  estimatedBudget: number;
  pickup: Place;
  delivery: Place;
  subAreaId: string;
  expectedDeliveryTime: string;
  deliveryCharge: number;
};

export type OrderInput = { items: string; foodPrice: number; deliveryCharge: number; paymentMethod: PaymentMethod };

const enc = encodeURIComponent;
type One = { request: FoodRequest };

export const getFoodConfig = () => api<FoodConfig>("/food/config");

export function listFood(filters: FoodFilters = {}) {
  const params = new URLSearchParams();
  if (filters.restaurant) {
    params.set("restaurantLat", String(filters.restaurant.lat));
    params.set("restaurantLng", String(filters.restaurant.lng));
  }
  if (filters.delivery) {
    params.set("deliveryLat", String(filters.delivery.lat));
    params.set("deliveryLng", String(filters.delivery.lng));
  }
  if ((filters.restaurant || filters.delivery) && filters.radiusKm) params.set("radiusKm", String(filters.radiusKm));
  if (filters.date) params.set("date", filters.date);
  if (filters.subAreaId) params.set("subAreaId", filters.subAreaId);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return api<{ items: FoodCardItem[]; page: number; hasMore: boolean }>(`/food${query ? `?${query}` : ""}`);
}

export const createFood = (input: FoodInput) => api<One>("/food/requests", { method: "POST", body: input });
export const getFood = (id: string) => api<One>(`/food/requests/${enc(id)}`);
export const updateFood = (id: string, input: Partial<FoodInput>) => api<One>(`/food/requests/${enc(id)}`, { method: "PATCH", body: input });
export const upgradeFood = (id: string, deliveryCharge: number) => api<One>(`/food/requests/${enc(id)}/upgrade`, { method: "POST", body: { deliveryCharge } });
export const acceptFood = (id: string) => api<One>(`/food/requests/${enc(id)}/accept`, { method: "POST" });
export const saveOrder = (id: string, input: OrderInput) => api<One>(`/food/requests/${enc(id)}/order`, { method: "PUT", body: input });
export const confirmOrder = (id: string, version: number) => api<One>(`/food/requests/${enc(id)}/order/confirm`, { method: "POST", body: { version } });
export const askApproval = (id: string, amount: number) => api<One>(`/food/requests/${enc(id)}/budget-approvals`, { method: "POST", body: { amount } });
export const decideApproval = (id: string, approvalId: string, approve: boolean) =>
  api<One>(`/food/requests/${enc(id)}/budget-approvals/${enc(approvalId)}/${approve ? "approve" : "reject"}`, { method: "POST" });

// The receipt photo and the actual cost (multipart)
export function uploadReceipt(id: string, file: Blob, actualCost: number) {
  const form = new FormData();
  form.set("actualCost", String(actualCost));
  form.set("receipt", file, "receipt.jpg");
  return api<One>(`/food/requests/${enc(id)}/receipt`, { method: "POST", body: form });
}
