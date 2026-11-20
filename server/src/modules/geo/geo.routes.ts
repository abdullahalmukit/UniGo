import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { rules } from "../../config/rules.js";
import { authenticate } from "../../middleware/authenticate.js";
import { geoRateLimit, geoRouteRateLimit } from "../../middleware/rate-limit.js";
import { parseInput } from "../../middleware/validate.js";
import { drivingRoute, reverseGeocode, searchPlaces } from "./geo.service.js";

// Every logged-in user (saved addresses, ride forms, route maps). Limited per
// account on top of the server-wide limits.
export const geoRouter = Router();
geoRouter.use(authenticate);

const language = z.enum(["bn", "en"]).default("en");
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const searchQuery = z.object({ q: z.string().max(rules.geo.queryMaxLength), lang: language });
const reverseQuery = z.object({ lat, lng, lang: language });
const routeQuery = z.object({ fromLat: lat, fromLng: lng, toLat: lat, toLng: lng });

// How the client draws maps. With Barikoi the style links carry the key, which
// Barikoi's map tiles need in the browser (restrict the key to the site's
// domain in the Barikoi dashboard). Without it the client uses OpenStreetMap tiles.
geoRouter.get("/config", (_req, res) => {
  const key = env.mapProvider === "barikoi" ? env.BARIKOI_API_KEY : undefined;
  const style = (name: string) => `https://map.barikoi.com/styles/${name}/style.json?key=${encodeURIComponent(key ?? "")}`;
  res.json({
    provider: env.mapProvider,
    styles: key ? { light: style("barikoi-light"), dark: style("barikoi-dark") } : null,
  });
});

geoRouter.get("/search", geoRateLimit, async (req, res) => {
  const { q, lang } = parseInput(searchQuery, req.query);
  res.json({ places: await searchPlaces(q, lang) });
});

geoRouter.get("/reverse", geoRateLimit, async (req, res) => {
  const { lat: la, lng: ln, lang } = parseInput(reverseQuery, req.query);
  res.json({ address: await reverseGeocode(la, ln, lang) });
});

// The driving route between two points: distance (m), duration (s) and the
// road line, for the route map and the arrival time.
geoRouter.get("/route", geoRouteRateLimit, async (req, res) => {
  const { fromLat, fromLng, toLat, toLng } = parseInput(routeQuery, req.query);
  res.json({ route: await drivingRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }) });
});
