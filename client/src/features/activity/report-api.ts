import { api } from "../../lib/api";

export type ReportReason =
  | "HARASSMENT"
  | "INAPPROPRIATE_CONTENT"
  | "SPAM"
  | "SCAM_OR_FRAUD"
  | "SAFETY_CONCERN"
  | "FAKE_PROFILE"
  | "OTHER";

export const REPORT_REASONS: ReportReason[] = [
  "HARASSMENT",
  "INAPPROPRIATE_CONTENT",
  "SPAM",
  "SCAM_OR_FRAUD",
  "SAFETY_CONCERN",
  "FAKE_PROFILE",
  "OTHER",
];

export const submitReport = (body: {
  reason: ReportReason;
  description?: string;
  activityId?: string;
  messageId?: string;
  reportedUserId?: string;
}) => api<{ id: string; status: string }>("/reports", { method: "POST", body });
