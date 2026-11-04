import { z } from "zod";
import { rules } from "../../config/rules.js";
import { addYearsToDateString, dhakaDateString } from "../../utils/time.js";
import { normalizeRegistrationNumber } from "../../utils/registration-number.js";

const { rider, seats } = rules;

const text = (max: number, message: string) => z.string().trim().min(1, message).max(max);

export const vehicleSchema = z
  .object({
    type: z.enum(["BIKE", "CAR"]),
    brand: text(rider.vehicleText.brandMaxLength, "Enter the brand"),
    model: text(rider.vehicleText.modelMaxLength, "Enter the model"),
    colour: text(rider.vehicleText.colourMaxLength, "Enter the colour"),
    registrationNumber: z
      .string()
      .trim()
      .min(rider.registrationNumber.minLength, "Enter the full registration number")
      .max(rider.registrationNumber.maxLength)
      .refine((value) => /[0-9০-৯]/.test(value), "The registration number must contain digits"),
    seatCapacity: z.number().int(),
  })
  .strict()
  .superRefine((vehicle, ctx) => {
    // BIKE = 1, CAR = 1-4 passenger seats, rider not counted (CLAUDE.md 6.2).
    const limits = vehicle.type === "BIKE" ? seats.bike : seats.car;
    if (vehicle.seatCapacity < limits.min || vehicle.seatCapacity > limits.max) {
      ctx.addIssue({
        code: "custom",
        path: ["seatCapacity"],
        message: `A ${vehicle.type === "BIKE" ? "bike" : "car"} has ${limits.min === limits.max ? limits.min : `${limits.min}-${limits.max}`} passenger seats`,
      });
    }
  });

// "YYYY-MM-DD", after today in Asia/Dhaka and at most licenceMaxYearsAhead ahead.
// `today` is a function so tests and the time of the request decide it.
export function licenceExpirySchema(today: () => string = () => dhakaDateString()) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the licence expiry date")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), "Choose a real date")
    .refine((value) => value > today(), "The licence has already expired")
    .refine(
      (value) => value <= addYearsToDateString(today(), rider.licenceMaxYearsAhead),
      `The expiry date can be at most ${rider.licenceMaxYearsAhead} years ahead`,
    );
}

// The JSON part of POST /api/rider/applications. Files come as separate parts.
export function applicationDataSchema(today?: () => string) {
  return z
    .object({
      licenceExpiresOn: licenceExpirySchema(today),
      vehicles: z.array(vehicleSchema).max(rider.maxVehiclesPerApplication, `Add at most ${rider.maxVehiclesPerApplication} vehicles`),
    })
    .strict()
    .superRefine((data, ctx) => {
      const seen = new Set<string>();
      data.vehicles.forEach((vehicle, index) => {
        const normalized = normalizeRegistrationNumber(vehicle.registrationNumber);
        if (seen.has(normalized)) {
          ctx.addIssue({ code: "custom", path: ["vehicles", index, "registrationNumber"], message: "This vehicle is listed twice" });
        }
        seen.add(normalized);
      });
    });
}

export type ApplicationData = z.output<ReturnType<typeof applicationDataSchema>>;
export type VehicleInput = z.output<typeof vehicleSchema>;

export const setActiveSchema = z.object({ active: z.boolean() }).strict();

const { minLength, maxLength } = rules.admin.reason;
const reason = z
  .string()
  .trim()
  .min(minLength, `Give a reason of at least ${minLength} characters`)
  .max(maxLength, `The reason must be at most ${maxLength} characters`);

export const rejectApplicationSchema = z.object({ reason });
export const suspendRiderSchema = z.object({ reason, endsAt: z.coerce.date().nullish() });
export const reinstateRiderSchema = z.object({ reason });
