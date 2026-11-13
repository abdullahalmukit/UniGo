import { z } from "zod";

export const allRequestsQuery = z.object({
  feature: z.enum(["all", "ride", "food", "carpool", "service"]).default("all"),
  subAreaId: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

export type AllRequestsQuery = z.infer<typeof allRequestsQuery>;

