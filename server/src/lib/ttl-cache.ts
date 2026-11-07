// A small in-memory cache with a size cap and an expiry per entry. The
// oldest entry goes first when the cap is reached (Map keeps insertion order).
export function createTtlCache<V>(maxSize: number, ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key: string): V | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: V) {
      entries.delete(key);
      if (entries.size >= maxSize) entries.delete(entries.keys().next().value!);
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

// Runs tasks one after another, at least `intervalMs` apart (a usage policy
// such as Nominatim's one request per second for the whole server).
export function createSpacedQueue(intervalMs: number, now: () => number = Date.now, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  let queue: Promise<unknown> = Promise.resolve();
  let lastAt = -Infinity;
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = queue.then(async () => {
        const wait = lastAt + intervalMs - now();
        if (wait > 0) await sleep(wait);
        lastAt = now();
        return task();
      });
      queue = next.catch(() => undefined);
      return next;
    },
    reset() {
      queue = Promise.resolve();
      lastAt = -Infinity;
    },
  };
}
