import { z } from "zod";
import { rules } from "../../config/rules.js";

// Ride Sharing input (proposal section 8). Time rules, seats and permissions
// are checked in the service; these only check shape and ranges.

const { amount, passengers, notesMaxLength, addressMaxLength } = rules.ride;

const point = z.object({
  address: z.string().trim().min(1, "Choose a place").max(addressMaxLength),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// Whole taka or paisa; stored with 2 decimals
const money = z.coerce
  .number()
  .min(amount.min, `At least ${amount.min}`)
  .max(amount.max, `At most ${amount.max}`)
  .transform((value) => Math.round(value * 100) / 100);

const notes = z
  .string()
  .trim()
  .max(notesMaxLength)
  .transform((value) => value || null)
  .nullish();

const time = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const id = z.uuid();
const seatCount = z.coerce.number().int().min(passengers.min).max(passengers.max);

export const requestSchema = z.object({
  pickup: point,
  destination: point,
  startTime: time,
  offeredAmount: money,
  passengerCount: seatCount,
  notes,
  subAreaId: id,
});
export type RequestInput = z.infer<typeof requestSchema>;

export const requestEditSchema = requestSchema.partial();
export type RequestEditInput = z.infer<typeof requestEditSchema>;

export const upgradeSchema = z.object({ offeredAmount: money });

export const offerSchema = z.object({
  pickup: point,
  destination: point,
  departureTime: time,
  farePerSeat: money,
  vehicleId: id,
  seats: seatCount,
  notes,
  subAreaId: id.nullish(),
});
export type OfferInput = z.infer<typeof offerSchema>;

export const offerEditSchema = offerSchema.partial();
export type OfferEditInput = z.infer<typeof offerEditSchema>;

export const acceptSchema = z.object({ vehicleId: id });
export const bookSchema = z.object({ seats: seatCount.default(1) });

const { minLength, maxLength } = rules.activity.cancelReason;
export const cancelOfferSchema = z.object({
  reason: z.string().trim().min(minLength, `At least ${minLength} characters`).max(maxLength, `At most ${maxLength} characters`),
});

const coordinate = (min: number, max: number) => z.coerce.number().min(min).max(max);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const listQuery = z
  .object({
    type: z.enum(["all", "requests", "offers"]).default("all"),
    pickupLat: coordinate(-90, 90).optional(),
    pickupLng: coordinate(-180, 180).optional(),
    destinationLat: coordinate(-90, 90).optional(),
    destinationLng: coordinate(-180, 180).optional(),
    radiusKm: z.coerce
      .number()
      .refine((value) => (rules.ride.searchRadiusKm as readonly number[]).includes(value), "Choose 1, 2 or 5 km")
      .default(rules.ride.defaultSearchRadiusKm),
    // A day in Asia/Dhaka
    date: z.iso.date().optional(),
    timeFrom: hhmm.optional(),
    timeTo: hhmm.optional(),
    subAreaId: id.optional(),
    page: z.coerce.number().int().min(1).max(100).default(1),
  })
  .refine((q) => (q.pickupLat === undefined) === (q.pickupLng === undefined), { message: "Give both pickup coordinates", path: ["pickupLat"] })
  .refine((q) => (q.destinationLat === undefined) === (q.destinationLng === undefined), {
    message: "Give both destination coordinates",
    path: ["destinationLat"],
  });
export type ListQuery = z.infer<typeof listQuery>;

export const fareQuery = z.object({
  fromLat: coordinate(-90, 90),
  fromLng: coordinate(-180, 180),
  toLat: coordinate(-90, 90),
  toLng: coordinate(-180, 180),
});
