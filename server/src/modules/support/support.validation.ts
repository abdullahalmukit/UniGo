import { z } from "zod";
import { rules } from "../../config/rules.js";

const { messageMinLength, messageMaxLength, categories } = rules.support;

export const createSupportSchema = z.object({
  category: z.enum(categories),
  message: z.string().trim().min(messageMinLength, `At least ${messageMinLength} characters`).max(messageMaxLength, `At most ${messageMaxLength} characters`),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  screenshotKey: z.string().trim().min(1).optional(),
});

export type CreateSupportInput = z.infer<typeof createSupportSchema>;

export const adminReplySupportSchema = z.object({
  reply: z.string().trim().min(2, "Reply cannot be empty").max(2000),
  status: z.enum(["IN_PROGRESS", "RESOLVED", "CLOSED"]).default("RESOLVED"),
});

export type AdminReplySupportInput = z.infer<typeof adminReplySupportSchema>;

export const listSupportQuery = z.object({
  category: z.enum(categories).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type ListSupportQuery = z.infer<typeof listSupportQuery>;

