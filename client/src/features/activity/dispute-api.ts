import { api } from "../../lib/api";

export type DisputeKind = "COMPLAINT" | "COMPLETION_DISPUTE";

export type DisputeListItem = {
  id: string;
  activityId: string;
  activityType: string;
  kind: DisputeKind;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED";
  reason: string;
  raisedBy: { id: string; name: string | null };
  againstUser: { id: string; name: string | null };
  mine: boolean;
  createdAt: string;
};

export type DisputeDetail = {
  id: string;
  activityId: string;
  activityType: string;
  activityStatus: string;
  kind: DisputeKind;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED";
  reason: string;
  description: string;
  finalStatus: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  raisedBy: { id: string; name: string | null };
  againstUser: { id: string; name: string | null };
  mine: boolean;
  evidence: { id: string; url: string; note: string | null; createdAt: string }[];
  createdAt: string;
};

const enc = encodeURIComponent;

export const raiseDispute = (body: {
  activityId: string;
  kind?: DisputeKind;
  reason: string;
  description: string;
}) => api<{ dispute: DisputeDetail }>("/disputes", { method: "POST", body }).then((r) => r.dispute);

export const getMyDisputes = () =>
  api<{ disputes: DisputeListItem[] }>("/disputes/my").then((r) => r.disputes);

export const getDispute = (id: string) =>
  api<{ dispute: DisputeDetail }>(`/disputes/${enc(id)}`).then((r) => r.dispute);
