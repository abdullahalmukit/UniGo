import { z } from "zod";
import { rules } from "../../config/rules.js";

const { reasonMinLength, reasonMaxLength, descriptionMinLength, descriptionMaxLength, maxEvidenceFiles, kinds } = rules.disputes;

export const createDisputeSchema = z.object({
  activityId: z.string().trim().min(1),
  kind: z.enum(kinds).default("COMPLAINT"),
  reason: z.string().trim().min(reasonMinLength, `At least ${reasonMinLength} characters`).max(reasonMaxLength, `At most ${reasonMaxLength} characters`),
  description: z.string().trim().min(descriptionMinLength, `At least ${descriptionMinLength} characters`).max(descriptionMaxLength, `At most ${descriptionMaxLength} characters`),
  evidenceKeys: z.array(z.string().trim().min(1)).max(maxEvidenceFiles).optional(),
});

export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

export const resolveDisputeSchema = z.object({
  decision: z.enum(["RESOLVE_COMPLETED", "RESOLVE_CANCELLED"]),
  decisionNote: z.string().trim().min(3, "At least 3 characters").max(2000, "At most 2000 characters"),
  action: z.enum(["warn", "restrict", "suspend", "ban"]).optional(),
  actionReason: z.string().trim().min(3).max(500).optional(),
  suspensionDays: z.coerce.number().int().min(1).max(365).optional(),
});

export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

export const listDisputesQuery = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED"]).optional(),
  kind: z.enum(kinds).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type ListDisputesQuery = z.infer<typeof listDisputesQuery>;

