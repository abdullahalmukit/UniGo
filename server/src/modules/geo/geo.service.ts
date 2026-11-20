import { env } from "../../config/env.js";
import { rules } from "../../config/rules.js";
import { getJson } from "../../lib/outbound.js";
import { createSpacedQueue, createTtlCache } from "../../lib/ttl-cache.js";
import { AppError } from "../../utils/app-error.js";

// Place search, address lookup and road routes through the server (CLAUDE.md 9,
// Maps; B3a decision 15). Two providers:
// - Barikoi (Bangladesh maps), used when BARIKOI_API_KEY is set. The key stays
//   on the server and is never logged.
// - OpenStreetMap: Nominatim for places (one request per second for the whole
//   server, its usage policy) and OSRM for routes.
// Answers are cached for a day. Bangladesh only.

export type Place = { label: string; lat: number; lng: number };
export type GeoLanguage = "bn" | "en";
export type Point = { lat: number; lng: number };
// Distance in metres, duration in seconds, the road as [lng, lat] pairs.
export type Route = { distanceMeters: number; durationSeconds: number; coordinates: [number, number][] };
export type MapProvider = "barikoi" | "osm";

let providerOverride: MapProvider | null = null;
const provider = (): MapProvider => providerOverride ?? env.mapProvider;

const nominatimQueue = createSpacedQueue(rules.geo.minInterval);
const cache = createTtlCache<unknown>(rules.geo.cacheSize, rules.geo.cacheTtl);

export function resetGeoForTests() {
  nominatimQueue.reset();
  cache.clear();
}

export function setMapProviderForTests(value: MapProvider | null) {
  providerOverride = value;
  cache.clear();
}

async function fetchOrUnavailable(url: string, timeout: number) {
  try {
    return await getJson(url, timeout);
  } catch {
    throw new AppError(503, "GEO_UNAVAILABLE", "Place search is not available right now. Try again in a moment.");
  }
}

async function lookup<T>(key: string, url: string, parse: (body: unknown) => T, timeout: number = rules.geo.timeout): Promise<T> {
  const fullKey = `${provider()}:${key}`;
  const hit = cache.get(fullKey) as T | undefined;
  if (hit !== undefined) return hit;
  const run = async () => {
    // Asked again while waiting in the queue
    const again = cache.get(fullKey) as T | undefined;
    if (again !== undefined) return again;
    const value = parse(await fetchOrUnavailable(url, timeout));
    cache.set(fullKey, value);
    return value;
  };
  // Only Nominatim asks for one request per second.
  return provider() === "osm" && !url.startsWith(env.OSRM_URL) ? nominatimQueue.run(run) : run();
}

const normalise = (query: string) => query.trim().replace(/\s+/g, " ");
const barikoi = (path: string, params: Record<string, string>) =>
  `${env.BARIKOI_URL}${path}?${new URLSearchParams({ api_key: env.BARIKOI_API_KEY ?? "", ...params })}`;

// --- Barikoi answers (exported for unit tests)

type BarikoiPlace = { address?: unknown; address_bn?: unknown; latitude?: unknown; longitude?: unknown };

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function parseBarikoiPlaces(body: unknown, language: GeoLanguage): Place[] {
  const places = (body as { places?: unknown } | null)?.places;
  return (Array.isArray(places) ? (places as BarikoiPlace[]) : [])
    .map((item) => ({
      label: (language === "bn" ? text(item.address_bn) : null) ?? text(item.address) ?? "",
      lat: Number(item.latitude),
      lng: Number(item.longitude),
    }))
    .filter((place) => place.label && Number.isFinite(place.lat) && Number.isFinite(place.lng))
    .slice(0, rules.geo.results);
}

export function parseBarikoiReverse(body: unknown, language: GeoLanguage): string | null {
  const place = (body as { place?: BarikoiPlace } | null)?.place;
  if (!place) return null;
  return (language === "bn" ? text(place.address_bn) : null) ?? text(place.address);
}

// OSRM and Barikoi's route overview answer in the same shape.
export function parseOsrmRoute(body: unknown): Route | null {
  const route = (body as { code?: unknown; routes?: { distance?: unknown; duration?: unknown; geometry?: unknown }[] } | null);
  const first = route?.code === "Ok" ? route.routes?.[0] : undefined;
  if (!first || typeof first.distance !== "number" || !Number.isFinite(first.distance)) return null;
  const raw = (first.geometry as { coordinates?: unknown } | undefined)?.coordinates;
  const coordinates = (Array.isArray(raw) ? raw : [])
    .filter((pair): pair is [number, number] => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
    .map(([lng, lat]) => [lng, lat] as [number, number]);
  return {
    distanceMeters: Math.round(first.distance),
    durationSeconds: typeof first.duration === "number" && Number.isFinite(first.duration) ? Math.round(first.duration) : 0,
    coordinates,
  };
}

// --- Place search and address lookup

export function searchPlaces(query: string, language: GeoLanguage): Promise<Place[]> {
  const q = normalise(query);
  if (q.length < 3) return Promise.resolve([]);
  const key = `s:${language}:${q.toLowerCase()}`;
  if (provider() === "barikoi") {
    const url = barikoi("/v2/api/search/autocomplete/place", { q, ...(language === "bn" ? { bangla: "true" } : {}) });
    return lookup(key, url, (body) => parseBarikoiPlaces(body, language));
  }
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    countrycodes: "bd",
    limit: String(rules.geo.results),
    "accept-language": language,
  });
  return lookup(key, `${env.NOMINATIM_URL}/search?${params}`, (body) =>
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
  const key = `r:${language}:${la},${ln}`;
  if (provider() === "barikoi") {
    const url = barikoi("/v2/api/search/reverse/geocode", {
      latitude: la,
      longitude: ln,
      address: "true",
      area: "true",
      city: "true",
      ...(language === "bn" ? { bangla: "true" } : {}),
    });
    return lookup(key, url, (body) => parseBarikoiReverse(body, language));
  }
  const params = new URLSearchParams({ lat: la, lon: ln, format: "jsonv2", zoom: "18", "accept-language": language });
  return lookup(key, `${env.NOMINATIM_URL}/reverse?${params}`, (body) => {
    const name = (body as { display_name?: unknown } | null)?.display_name;
    return typeof name === "string" ? name : null;
  });
}

// --- Road route between two points (route map, ETA and the suggested fare)

// About 11 m: nearly the same points share one call.
const pointKey = (point: Point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;

// The driving route, or null when there is none. Throws GEO_UNAVAILABLE when
// the route server does not answer.
export function drivingRoute(from: Point, to: Point, timeout: number = rules.geo.routeTimeout): Promise<Route | null> {
  const coordinates = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
  const url =
    provider() === "barikoi"
      ? barikoi(`/v2/api/route/${coordinates}`, { geometries: "geojson", profile: "car" })
      : `${env.OSRM_URL}/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
  return lookup(`route:${pointKey(from)};${pointKey(to)}`, url, parseOsrmRoute, timeout);
}
