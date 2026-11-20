import { api } from "./api";

// How maps are drawn (Barikoi or OpenStreetMap), asked once from the server
// (/api/geo/config), which holds the Barikoi key. Without Barikoi the maps use
// OpenStreetMap raster tiles.

export type MapProvider = "barikoi" | "osm";
export type MapConfig = { provider: MapProvider; styles: { light: string; dark: string } | null };
export type LatLng = { lat: number; lng: number };
export type Route = { distanceMeters: number; durationSeconds: number; coordinates: [number, number][] };

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

let configRequest: Promise<MapConfig> | null = null;

export function mapConfig(): Promise<MapConfig> {
  configRequest ??= api<MapConfig>("/geo/config").catch(() => {
    configRequest = null;
    return { provider: "osm" as const, styles: null };
  });
  return configRequest;
}

// The style for the current theme: a Barikoi style link, or the OSM raster style.
export async function mapStyle(theme: "light" | "dark") {
  const config = await mapConfig();
  return config.styles ? config.styles[theme] : OSM_STYLE;
}

const routeCache = new Map<string, Promise<Route | null>>();

// The driving route between two points, through the server; null when there is none.
export function fetchRoute(from: LatLng, to: LatLng): Promise<Route | null> {
  const key = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(",");
  let request = routeCache.get(key);
  if (!request) {
    const params = new URLSearchParams({
      fromLat: from.lat.toFixed(6),
      fromLng: from.lng.toFixed(6),
      toLat: to.lat.toFixed(6),
      toLng: to.lng.toFixed(6),
    });
    request = api<{ route: Route | null }>(`/geo/route?${params}`).then(
      (body) => body.route,
      (error: unknown) => {
        routeCache.delete(key);
        throw error;
      },
    );
    routeCache.set(key, request);
  }
  return request;
}

// Straight-line distance in metres (for "moved enough to ask for a new route").
export function metresBetween(a: LatLng, b: LatLng) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
