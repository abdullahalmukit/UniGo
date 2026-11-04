// Place search and address lookup with OpenStreetMap Nominatim (CLAUDE.md 9,
// Maps). Its usage policy allows at most 1 request per second, so every
// request waits its turn in one queue, and answers are cached in memory and in
// sessionStorage. Callers debounce typing before calling `search`.

export type Place = { label: string; lat: number; lng: number };

export type GeocoderDeps = {
  fetch: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  baseUrl?: string;
};

const MIN_INTERVAL_MS = 1000;
const CACHE_PREFIX = "unigo.geo.";

export function createGeocoder(deps: GeocoderDeps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const baseUrl = deps.baseUrl ?? "https://nominatim.openstreetmap.org";
  const memory = new Map<string, unknown>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastRequestAt = -Infinity;

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

  // Runs requests one after another, at least MIN_INTERVAL_MS apart.
  function throttled<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = lastRequestAt + MIN_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      return task();
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function lookup<T>(key: string, url: string, parse: (body: unknown) => T): Promise<T> {
    const hit = cached<T>(key);
    if (hit !== undefined) return hit;
    return throttled(async () => {
      // Asked again while waiting in the queue
      const again = cached<T>(key);
      if (again !== undefined) return again;
      const response = await deps.fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
      const value = parse(await response.json());
      remember(key, value);
      return value;
    });
  }

  return {
    // Places in Bangladesh that match the text.
    search(query: string, language: "bn" | "en"): Promise<Place[]> {
      const q = query.trim().replace(/\s+/g, " ");
      if (q.length < 3) return Promise.resolve([]);
      const params = new URLSearchParams({
        q,
        format: "jsonv2",
        countrycodes: "bd",
        limit: "6",
        "accept-language": language,
      });
      return lookup(`s:${language}:${q.toLowerCase()}`, `${baseUrl}/search?${params}`, (body) =>
        (Array.isArray(body) ? body : []).map((item: { display_name: string; lat: string; lon: string }) => ({
          label: item.display_name,
          lat: Number(item.lat),
          lng: Number(item.lon),
        })),
      );
    },

    // The address at a point, or null when Nominatim has none.
    reverse(lat: number, lng: number, language: "bn" | "en"): Promise<string | null> {
      // About 1 m: moving the map a hair does not cost a request.
      const la = lat.toFixed(5);
      const ln = lng.toFixed(5);
      const params = new URLSearchParams({ lat: la, lon: ln, format: "jsonv2", zoom: "18", "accept-language": language });
      return lookup(`r:${language}:${la},${ln}`, `${baseUrl}/reverse?${params}`, (body) => {
        const name = (body as { display_name?: unknown }).display_name;
        return typeof name === "string" ? name : null;
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

// The app's one geocoder, so the 1-per-second rule holds across every page.
export const geocoder = createGeocoder({ fetch: (...args) => fetch(...args), storage: sessionStorageOrNull() });
