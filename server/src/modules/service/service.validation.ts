import { z } from "zod";
import { rules } from "../../config/rules.js";

const { offeredAmount, estimatedBudget, quantity, serviceTitleMaxLength, taskTitleMaxLength, descriptionMaxLength, instructionsMaxLength, addressMaxLength } = rules.service;

const point = z.object({
  address: z.string().trim().min(1, "Choose a place").max(addressMaxLength),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const serviceAmountMoney = z.coerce
  .number()
  .min(offeredAmount.min, `At least ${offeredAmount.min}`)
  .max(offeredAmount.max, `At most ${offeredAmount.max}`)
  .transform(roundMoney);

export const budgetMoney = z.coerce
  .number()
  .min(estimatedBudget.min, `At least ${estimatedBudget.min}`)
  .max(estimatedBudget.max, `At most ${estimatedBudget.max}`)
  .transform(roundMoney);

const text = (max: number) => z.string().trim().min(1, "Required").max(max, `At most ${max} characters`);
const id = z.uuid();

export const createServiceSchema = z.object({
  categoryId: id,
  serviceTitle: text(serviceTitleMaxLength),
  taskTitle: text(taskTitleMaxLength),
  description: text(descriptionMaxLength),
  destination: point,
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  preferredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm").optional(),
  offeredAmount: serviceAmountMoney,
  itemDetails: z.string().trim().max(1000).optional(),
  quantity: z.coerce.number().int().min(quantity.min).max(quantity.max).optional(),
  pickup: point.optional(),
  subAreaId: id.optional(),
  estimatedBudget: budgetMoney.optional(),
  instructions: z.string().trim().max(instructionsMaxLength).optional(),
});
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const editServiceSchema = createServiceSchema.partial();
export type EditServiceInput = z.infer<typeof editServiceSchema>;

export const listServicesQuery = z.object({
  categoryId: z.string().trim().min(1).optional(),
  subAreaId: z.string().trim().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
  radiusKm: z.coerce.number().default(rules.food.defaultSearchRadiusKm),
});
export type ListServicesQuery = z.infer<typeof listServicesQuery>;

