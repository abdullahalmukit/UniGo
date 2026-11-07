import { Router } from "express";
import { z } from "zod";
import { rules } from "../../config/rules.js";
import { authenticate } from "../../middleware/authenticate.js";
import { geoRateLimit } from "../../middleware/rate-limit.js";
import { parseInput } from "../../middleware/validate.js";
import { reverseGeocode, searchPlaces } from "./geo.service.js";

// Every logged-in user (saved addresses, ride forms). Limited per account on
// top of the server-wide one-per-second queue.
export const geoRouter = Router();
geoRouter.use(authenticate);

const language = z.enum(["bn", "en"]).default("en");
const searchQuery = z.object({ q: z.string().max(rules.geo.queryMaxLength), lang: language });
const reverseQuery = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), lang: language });

geoRouter.get("/search", geoRateLimit, async (req, res) => {
  const { q, lang } = parseInput(searchQuery, req.query);
  res.json({ places: await searchPlaces(q, lang) });
});

geoRouter.get("/reverse", geoRateLimit, async (req, res) => {
  const { lat, lng, lang } = parseInput(reverseQuery, req.query);
  res.json({ address: await reverseGeocode(lat, lng, lang) });
});
