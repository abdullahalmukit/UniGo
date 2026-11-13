import { api } from "../../lib/api";
import type { ActivityStatus, CompletionBy, MiniProfile, Place, SignedLink, SubAreaRef } from "../ride/ride-api";

export type ServiceCategoryCode =
  | "SHOPPING_PURCHASING"
  | "PARCEL_DELIVERY"
  | "PHARMACY_HEALTHCARE"
  | "DOCUMENT_ACADEMIC"
  | "WARRANTY_REPAIR"
  | "FINANCIAL_ADMINISTRATIVE"
  | "CUSTOM_OTHER";

export type ServiceCategory = {
  id: string;
  code: ServiceCategoryCode;
  sortOrder?: number;
  isActive?: boolean;
};

export type ServiceRequest = {
  id: string;
  status: ActivityStatus;
  subStatus: string | null;
  startTime: string;
  preferredDate: string;
  hasPreferredTime: boolean;
  categoryId: string;
  category: { id: string; code: ServiceCategoryCode };
  serviceTitle: string;
  taskTitle: string;
  description: string;
  destination: Place;
  pickup: Place | null;
  subArea: SubAreaRef | null;
  offeredAmount: number;
  estimatedBudget: number | null;
  itemDetails: string | null;
  quantity: number | null;
  instructions: string | null;
  referenceImage: SignedLink | null;
  requester: MiniProfile;
  accepter: MiniProfile | null;
  chatId: string | null;
  mine: boolean;
  role: "REQUESTER" | "ACCEPTER" | null;
  completionRequestedBy: CompletionBy;
  isLateCancellation: boolean;
  createdAt: string;
  phone?: string | null;
};

export type ServiceCardItem = Pick<
  ServiceRequest,
  | "id"
  | "status"
  | "startTime"
  | "preferredDate"
  | "hasPreferredTime"
  | "category"
  | "serviceTitle"
  | "taskTitle"
  | "description"
  | "destination"
  | "pickup"
  | "subArea"
  | "offeredAmount"
  | "estimatedBudget"
  | "itemDetails"
  | "quantity"
  | "requester"
  | "mine"
  | "createdAt"
>;

export type CreateServiceInput = {
  categoryId: string;
  serviceTitle: string;
  taskTitle: string;
  description: string;
  destination: Place;
  preferredDate: string;
  preferredTime?: string;
  offeredAmount: number;
  itemDetails?: string;
  quantity?: number;
  pickup?: Place;
  subAreaId?: string;
  estimatedBudget?: number;
  instructions?: string;
};

export type EditServiceInput = Partial<CreateServiceInput>;

export type ServiceFilters = {
  categoryId?: string;
  subAreaId?: string;
  date?: string;
  search?: string;
  page?: number;
};

const enc = encodeURIComponent;
type One = { request: ServiceRequest };

export const listServiceCategories = () => api<{ categories: ServiceCategory[] }>("/service/categories");

export function listServiceRequests(filters: ServiceFilters = {}) {
  const params = new URLSearchParams();
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.subAreaId) params.set("subAreaId", filters.subAreaId);
  if (filters.date) params.set("date", filters.date);
  if (filters.search) params.set("search", filters.search);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return api<{ items: ServiceCardItem[]; page: number; hasMore: boolean; total: number }>(`/service${query ? `?${query}` : ""}`);
}

export const createServiceRequest = (input: CreateServiceInput) => api<One>("/service/requests", { method: "POST", body: input });
export const getServiceRequest = (id: string) => api<One>(`/service/requests/${enc(id)}`);
export const updateServiceRequest = (id: string, input: EditServiceInput) => api<One>(`/service/requests/${enc(id)}`, { method: "PATCH", body: input });
export const acceptServiceRequest = (id: string) => api<One>(`/service/requests/${enc(id)}/accept`, { method: "POST" });
export const startService = (id: string) => api<One>(`/service/requests/${enc(id)}/start`, { method: "POST" });
export const deliverService = (id: string) => api<One>(`/service/requests/${enc(id)}/deliver`, { method: "POST" });

