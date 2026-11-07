import { env } from "../../config/env.js";
import { rules } from "../../config/rules.js";
import { getJson } from "../../lib/outbound.js";
import { createSpacedQueue, createTtlCache } from "../../lib/ttl-cache.js";
import { AppError } from "../../utils/app-error.js";

// Place search and address lookup through the server (CLAUDE.md 9, Maps;
// B3a decision). OpenStreetMap Nominatim allows one request per second: one
// queue for the whole server keeps to it, whatever the number of users, and
// answers are cached for a day. Bangladesh only.

export type Place = { label: string; lat: number; lng: number };
export type GeoLanguage = "bn" | "en";

const queue = createSpacedQueue(rules.geo.minInterval);
const cache = createTtlCache<unknown>(rules.geo.cacheSize, rules.geo.cacheTtl);

export function resetGeoForTests() {
  queue.reset();
  cache.clear();
}

async function lookup<T>(key: string, url: string, parse: (body: unknown) => T): Promise<T> {
  const hit = cache.get(key) as T | undefined;
  if (hit !== undefined) return hit;
  return queue.run(async () => {
    // Asked again while waiting in the queue
    const again = cache.get(key) as T | undefined;
    if (again !== undefined) return again;
    let body: unknown;
    try {
      body = await getJson(url, rules.geo.timeout);
    } catch {
      throw new AppError(503, "GEO_UNAVAILABLE", "Place search is not available right now. Try again in a moment.");
    }
    const value = parse(body);
    cache.set(key, value);
    return value;
  });
}

const normalise = (query: string) => query.trim().replace(/\s+/g, " ");

export function searchPlaces(query: string, language: GeoLanguage): Promise<Place[]> {
  const q = normalise(query);
  if (q.length < 3) return Promise.resolve([]);
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    countrycodes: "bd",
    limit: String(rules.geo.results),
    "accept-language": language,
  });
  return lookup(`s:${language}:${q.toLowerCase()}`, `${env.NOMINATIM_URL}/search?${params}`, (body) =>
    (Array.isArray(body) ? body : [])
      .map((item: { display_name?: unknown; lat?: unknown; lon?: unknown }) => ({
        label: String(item.display_name ?? ""),
        lat: Number(item.lat),
        lng: Number(item.lon),
      }))
      .filter((place) => place.label && Number.isFinite(place.lat) && Number.isFinite(place.lng)),
  );
}

export function reverseGeocode(lat: number, lng: number, language: GeoLanguage): Promise<string | null> {
  // About 1 m: moving the map a hair does not cost a request.
  const la = lat.toFixed(5);
  const ln = lng.toFixed(5);
  const params = new URLSearchParams({ lat: la, lon: ln, format: "jsonv2", zoom: "18", "accept-language": language });
  return lookup(`r:${language}:${la},${ln}`, `${env.NOMINATIM_URL}/reverse?${params}`, (body) => {
    const name = (body as { display_name?: unknown } | null)?.display_name;
    return typeof name === "string" ? name : null;
  });
}
