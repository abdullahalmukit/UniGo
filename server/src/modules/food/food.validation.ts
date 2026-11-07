import { z } from "zod";
import { rules } from "../../config/rules.js";

// Food Delivery input (proposal section 10, B4 decisions). Time rules,
// participants and states are checked in the service; these only check shape
// and ranges. Every limit comes from rules.food.

const { budget, deliveryCharge, quantity, addressMaxLength, restaurantNameMaxLength, itemsMaxLength, detailsMaxLength } = rules.food;

const point = z.object({
  address: z.string().trim().min(1, "Choose a place").max(addressMaxLength),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const roundMoney = (value: number) => Math.round(value * 100) / 100;

// Estimated food budget, confirmed food price, approval amount and receipt cost
export const foodMoney = z.coerce
  .number()
  .min(budget.min, `At least ${budget.min}`)
  .max(budget.max, `At most ${budget.max}`)
  .transform(roundMoney);

// 0 means no delivery charge; otherwise within the range
export const deliveryChargeMoney = z.coerce
  .number()
  .refine((value) => value === 0 || (value >= deliveryCharge.min && value <= deliveryCharge.max), `0, or ${deliveryCharge.min} to ${deliveryCharge.max}`)
  .transform(roundMoney);

const text = (max: number) => z.string().trim().min(1, "Required").max(max, `At most ${max} characters`);
const time = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const id = z.uuid();

export const createSchema = z.object({
  restaurantName: text(restaurantNameMaxLength),
  restaurant: point,
  items: text(itemsMaxLength),
  details: text(detailsMaxLength),
  quantity: z.coerce.number().int().min(quantity.min).max(quantity.max),
  estimatedBudget: foodMoney,
  // Prefilled from the restaurant on the form, editable (10.2)
  pickup: point,
  delivery: point,
  subAreaId: id,
  expectedDeliveryTime: time,
  deliveryCharge: deliveryChargeMoney.nullish(),
});
export type CreateInput = z.infer<typeof createSchema>;

export const editSchema = createSchema.partial();
export type EditInput = z.infer<typeof editSchema>;

// Upgrade (B4 Q5): raise the offered delivery charge
export const upgradeSchema = z.object({ deliveryCharge: deliveryChargeMoney });

// The order details both participants confirm before buying (10.3 step 3)
export const orderSchema = z.object({
  items: text(itemsMaxLength),
  foodPrice: foodMoney,
  deliveryCharge: deliveryChargeMoney,
  paymentMethod: z.enum(["CASH", "BKASH", "NAGAD"]),
});
export type OrderInput = z.infer<typeof orderSchema>;

export const confirmOrderSchema = z.object({ version: z.coerce.number().int().min(1) });

export const approvalSchema = z.object({ amount: foodMoney });

// Sent as a form field next to the receipt photo
export const receiptSchema = z.object({ actualCost: foodMoney });

const coordinate = (min: number, max: number) => z.coerce.number().min(min).max(max);

export const listQuery = z
  .object({
    restaurantLat: coordinate(-90, 90).optional(),
    restaurantLng: coordinate(-180, 180).optional(),
    deliveryLat: coordinate(-90, 90).optional(),
    deliveryLng: coordinate(-180, 180).optional(),
    radiusKm: z.coerce
      .number()
      .refine((value) => (rules.food.searchRadiusKm as readonly number[]).includes(value), "Choose 1, 2 or 5 km")
      .default(rules.food.defaultSearchRadiusKm),
    // A day in Asia/Dhaka
    date: z.iso.date().optional(),
    subAreaId: id.optional(),
    page: z.coerce.number().int().min(1).max(100).default(1),
  })
  .refine((q) => (q.restaurantLat === undefined) === (q.restaurantLng === undefined), {
    message: "Give both restaurant coordinates",
    path: ["restaurantLat"],
  })
  .refine((q) => (q.deliveryLat === undefined) === (q.deliveryLng === undefined), { message: "Give both delivery coordinates", path: ["deliveryLat"] });
export type ListQuery = z.infer<typeof listQuery>;
