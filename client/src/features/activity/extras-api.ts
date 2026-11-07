import { api } from "../../lib/api";
import type { SignedLink } from "../ride/ride-api";

// Reviews (proposal 15.1) and payment records (16) of one activity, B3b-2.

export type PaymentMethod = "CASH" | "BKASH" | "NAGAD";
export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "BKASH", "NAGAD"];

export type Payment = {
  amount: number;
  // B4: food cost and delivery charge, separately (null for other features)
  foodCost?: number | null;
  deliveryCharge?: number | null;
  method: PaymentMethod | null;
  status: "UNPAID" | "PAID";
  paidAt: string | null;
  payee: "ME" | "OTHER";
  canChooseMethod: boolean;
  canMarkPaid: boolean;
};

export type Review = {
  id: string;
  rating: number;
  comment: string | null;
  activityType: string;
  reviewer: { id: string; name: string; photo: SignedLink | null };
  publishedAt: string | null;
  createdAt: string;
};

export type ActivityReviews = {
  canReview: boolean;
  closesAt: string | null;
  mine: Review | null;
  theirs: Review | null;
  otherSubmitted: boolean;
};

const enc = encodeURIComponent;

export const getPayment = (activityId: string) => api<{ payment: Payment }>(`/activities/${enc(activityId)}/payment`).then((r) => r.payment);
export const setPaymentMethod = (activityId: string, method: PaymentMethod) =>
  api<{ payment: Payment }>(`/activities/${enc(activityId)}/payment`, { method: "PATCH", body: { method } }).then((r) => r.payment);
export const markPaid = (activityId: string) => api<{ payment: Payment }>(`/activities/${enc(activityId)}/payment/paid`, { method: "POST" }).then((r) => r.payment);

export const getReviews = (activityId: string) => api<ActivityReviews>(`/activities/${enc(activityId)}/reviews`);
export const submitReview = (activityId: string, rating: number, comment: string) =>
  api<ActivityReviews>(`/activities/${enc(activityId)}/review`, { method: "POST", body: { rating, comment: comment.trim() || null } });
export const getUserReviews = (userId: string, page: number) =>
  api<{ reviews: Review[]; page: number; total: number; hasMore: boolean }>(`/users/${enc(userId)}/reviews?page=${page}`);
