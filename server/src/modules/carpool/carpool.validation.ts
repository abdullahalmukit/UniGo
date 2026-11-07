import { z } from "zod";
import { rules } from "../../config/rules.js";

// Carpool input (proposal section 9, B6a decisions). Dates, seats, the
// schedule limit, overlaps and permissions are checked in the service; these
// only check shape and ranges.

const { monthlyPrice, notesMaxLength, addressMaxLength, durationMonths, rejectReasonMaxLength } = rules.carpool;

const point = z.object({
  address: z.string().trim().min(1, "Choose a place").max(addressMaxLength),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const notes = z
  .string()
  .trim()
  .max(notesMaxLength)
  .transform((value) => value || null)
  .nullish();

const id = z.uuid();
const date = z.iso.date();
const duration = z.coerce
  .number()
  .int()
  .refine((value) => (durationMonths as readonly number[]).includes(value), "Choose 1, 2, 3 or 4 months");

const price = z.object({
  durationMonths: duration,
  monthlyPrice: z.coerce
    .number()
    .min(monthlyPrice.min, `At least ${monthlyPrice.min}`)
    .max(monthlyPrice.max, `At most ${monthlyPrice.max}`)
    .transform((value) => Math.round(value * 100) / 100),
});

const postFields = {
  // Bitmask of weekdays: bit 0 = Sunday ... bit 6 = Saturday; at least one day
  daysOfWeek: z.coerce.number().int().min(1, "Choose at least one day").max(127),
  // Minutes after midnight, Asia/Dhaka
  departureMinute: z.coerce.number().int().min(0).max(24 * 60 - 1),
  pickup: point,
  destination: point,
  vehicleId: id,
  seats: z.coerce.number().int().min(1).max(rules.seats.car.max),
  notes,
  prices: z
    .array(price)
    .min(1, "Offer at least one duration")
    .max(durationMonths.length)
    .refine((list) => new Set(list.map((p) => p.durationMonths)).size === list.length, "Each duration once"),
  validFrom: date,
  validUntil: date.nullish(),
};

export const postSchema = z.object(postFields);
export type PostInput = z.infer<typeof postSchema>;

export const postEditSchema = postSchema.partial();
export type PostEditInput = z.infer<typeof postEditSchema>;

export const seatsSchema = z.object({ seats: z.coerce.number().int().min(1).max(rules.seats.car.max) });

export const bookingSchema = z.object({ durationMonths: duration, startDate: date });
export type BookingInput = z.infer<typeof bookingSchema>;

export const quoteQuery = bookingSchema;

export const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(rejectReasonMaxLength)
    .transform((value) => value || null)
    .nullish(),
});

const coordinate = (min: number, max: number) => z.coerce.number().min(min).max(max);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const searchQuery = z
  .object({
    // A weekday the post runs on: 0 = Sunday ... 6 = Saturday
    day: z.coerce.number().int().min(0).max(6).optional(),
    timeFrom: hhmm.optional(),
    timeTo: hhmm.optional(),
    pickupLat: coordinate(-90, 90).optional(),
    pickupLng: coordinate(-180, 180).optional(),
    destinationLat: coordinate(-90, 90).optional(),
    destinationLng: coordinate(-180, 180).optional(),
    radiusKm: z.coerce
      .number()
      .refine((value) => (rules.carpool.searchRadiusKm as readonly number[]).includes(value), "Choose 1, 2 or 5 km")
      .default(rules.carpool.defaultSearchRadiusKm),
    page: z.coerce.number().int().min(1).max(100).default(1),
  })
  .refine((q) => (q.pickupLat === undefined) === (q.pickupLng === undefined), { message: "Give both pickup coordinates", path: ["pickupLat"] })
  .refine((q) => (q.destinationLat === undefined) === (q.destinationLng === undefined), {
    message: "Give both destination coordinates",
    path: ["destinationLat"],
  });
export type SearchQuery = z.infer<typeof searchQuery>;
