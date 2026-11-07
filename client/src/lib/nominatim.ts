import { api } from "./api";

// Place search and address lookup (CLAUDE.md 9, Maps). Since B3a they go
// through the UniGo server (/api/geo), which keeps OpenStreetMap Nominatim's
// one-request-per-second rule for the whole app and caches answers. Here the
// answers are also cached in memory and in sessionStorage; callers debounce
// typing before calling `search`.

export type Place = { label: string; lat: number; lng: number };

export type GeocoderDeps = {
  // GET a path of the UniGo API (e.g. "/geo/search?q=...")
  get: (path: string) => Promise<unknown>;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
};

const CACHE_PREFIX = "unigo.geo.";

export function createGeocoder(deps: GeocoderDeps) {
  const memory = new Map<string, unknown>();

  function cached<T>(key: string): T | undefined {
    if (memory.has(key)) return memory.get(key) as T;
    try {
      const stored = deps.storage?.getItem(CACHE_PREFIX + key);
      if (stored) {
        const value = JSON.parse(stored) as T;
        memory.set(key, value);
        return value;
      }
    } catch {
      // Storage blocked or full: the memory cache still works.
    }
    return undefined;
  }

  function remember(key: string, value: unknown) {
    memory.set(key, value);
    try {
      deps.storage?.setItem(CACHE_PREFIX + key, JSON.stringify(value));
    } catch {
      // Ignore: see above.
    }
  }

  // The same question asked twice at once waits for one answer.
  const pending = new Map<string, Promise<unknown>>();

  async function lookup<T>(key: string, path: string, parse: (body: unknown) => T): Promise<T> {
    const hit = cached<T>(key);
    if (hit !== undefined) return hit;
    const running = pending.get(key) as Promise<T> | undefined;
    if (running) return running;
    const request = deps
      .get(path)
      .then((body) => {
        const value = parse(body);
        remember(key, value);
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  return {
    // Places in Bangladesh that match the text.
    search(query: string, language: "bn" | "en"): Promise<Place[]> {
      const q = query.trim().replace(/\s+/g, " ");
      if (q.length < 3) return Promise.resolve([]);
      const params = new URLSearchParams({ q, lang: language });
      return lookup(`s:${language}:${q.toLowerCase()}`, `/geo/search?${params}`, (body) => {
        const places = (body as { places?: unknown } | null)?.places;
        return Array.isArray(places) ? (places as Place[]) : [];
      });
    },

    // The address at a point, or null when there is none.
    reverse(lat: number, lng: number, language: "bn" | "en"): Promise<string | null> {
      // About 1 m: moving the map a hair does not cost a request.
      const la = lat.toFixed(5);
      const ln = lng.toFixed(5);
      const params = new URLSearchParams({ lat: la, lng: ln, lang: language });
      return lookup(`r:${language}:${la},${ln}`, `/geo/reverse?${params}`, (body) => {
        const address = (body as { address?: unknown } | null)?.address;
        return typeof address === "string" ? address : null;
      });
    },
  };
}

export type Geocoder = ReturnType<typeof createGeocoder>;

function sessionStorageOrNull() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

// The app's one geocoder, with one cache for every page.
export const geocoder = createGeocoder({ get: (path) => api<unknown>(path), storage: sessionStorageOrNull() });
