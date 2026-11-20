import { z } from "zod";
import { rules } from "../../config/rules.js";

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

export const suggestionsQuery = z
  .object({
    feature: z.enum(["ride", "carpool", "food", "service"]),
    // ride only: what to suggest when there is no `from`
    target: z.enum(["offers", "requests"]).default("offers"),
    // One of the viewer's own open ride requests or offers
    from: z.string().trim().min(1).max(64).optional(),
    pickupLat: lat.optional(),
    pickupLng: lng.optional(),
    destinationLat: lat.optional(),
    destinationLng: lng.optional(),
    time: z.coerce.date().optional(),
    seats: z.coerce.number().int().min(1).max(rules.seats.car.max).optional(),
    limit: z.coerce.number().int().min(1).max(rules.matching.limit.max).default(rules.matching.limit.default),
  })
  .refine((q) => (q.pickupLat === undefined) === (q.pickupLng === undefined), { message: "Give both pickup coordinates", path: ["pickupLat"] })
  .refine((q) => (q.destinationLat === undefined) === (q.destinationLng === undefined), { message: "Give both destination coordinates", path: ["destinationLat"] });

export type SuggestionsQuery = z.infer<typeof suggestionsQuery>;

export const categoryHintQuery = z.object({ text: z.string().max(2000) });
