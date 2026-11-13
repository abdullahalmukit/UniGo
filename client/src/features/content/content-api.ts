import { api } from "../../lib/api";

export type SpotlightItem = {
  id: string;
  title: string | null;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  linkUrl: string | null;
  linkLabel: string | null;
  startsAt: string;
  expiresAt: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Promo = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  promoCode: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Banner = {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string | null;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export const getSpotlight = () => api<SpotlightItem[]>("/content/spotlight");
export const getPromos = () => api<Promo[]>("/content/promos");
export const getBanners = () => api<Banner[]>("/content/banners");

// Admin API
export const adminContentApi = {
  // Spotlight
  listSpotlight: () => api<SpotlightItem[]>("/admin/content/spotlight"),
  createSpotlight: (body: Partial<SpotlightItem> & { mediaType: string; mediaUrl: string }) =>
    api<SpotlightItem>("/admin/content/spotlight", { method: "POST", body }),
  updateSpotlight: (id: string, body: Partial<SpotlightItem>) =>
    api<SpotlightItem>(`/admin/content/spotlight/${id}`, { method: "PATCH", body }),
  deleteSpotlight: (id: string) => api<void>(`/admin/content/spotlight/${id}`, { method: "DELETE" }),
  // Promos
  listPromos: () => api<Promo[]>("/admin/content/promos"),
  createPromo: (body: Partial<Promo> & { title: string; startsAt: string; endsAt: string }) =>
    api<Promo>("/admin/content/promos", { method: "POST", body }),
  updatePromo: (id: string, body: Partial<Promo>) =>
    api<Promo>(`/admin/content/promos/${id}`, { method: "PATCH", body }),
  deletePromo: (id: string) => api<void>(`/admin/content/promos/${id}`, { method: "DELETE" }),
  // Banners
  listBanners: () => api<Banner[]>("/admin/content/banners"),
  createBanner: (body: Partial<Banner> & { title: string; imageUrl: string; startsAt: string; endsAt: string }) =>
    api<Banner>("/admin/content/banners", { method: "POST", body }),
  updateBanner: (id: string, body: Partial<Banner>) =>
    api<Banner>(`/admin/content/banners/${id}`, { method: "PATCH", body }),
  deleteBanner: (id: string) => api<void>(`/admin/content/banners/${id}`, { method: "DELETE" }),
};

