import { describe, expect, it, vi } from "vitest";
import { createGeocoder } from "./nominatim";

function setup() {
  let clock = 10_000;
  const calls: { url: string; at: number }[] = [];
  const fetch = vi.fn(async (url: string) => {
    calls.push({ url, at: clock });
    const body = url.includes("/reverse")
      ? { display_name: "Road 27, Dhanmondi" }
      : [{ display_name: "Dhanmondi Lake, Dhaka", lat: "23.74", lon: "90.37" }];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const storage = new Map<string, string>();
  const geocoder = createGeocoder({
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value) },
  });
  return { geocoder, fetch, calls, storage };
}

describe("nominatim geocoder", () => {
  it("searches places in Bangladesh and parses the coordinates", async () => {
    const { geocoder, calls } = setup();
    const places = await geocoder.search("  Dhanmondi   lake ", "en");

    expect(places).toEqual([{ label: "Dhanmondi Lake, Dhaka", lat: 23.74, lng: 90.37 }]);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("q")).toBe("Dhanmondi lake");
    expect(url.searchParams.get("countrycodes")).toBe("bd");
    expect(url.searchParams.get("accept-language")).toBe("en");
  });

  it("skips very short searches", async () => {
    const { geocoder, fetch } = setup();
    expect(await geocoder.search("ab", "en")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers repeats from the cache, also after a reload (sessionStorage)", async () => {
    const { geocoder, fetch, storage } = setup();
    await geocoder.search("Mirpur 10", "en");
    await geocoder.search("mirpur 10", "en");
    await geocoder.reverse(23.746512, 90.376201, "en");
    await geocoder.reverse(23.746514, 90.376199, "en");
    expect(fetch).toHaveBeenCalledTimes(2);

    // A new geocoder (page reload) with the same storage
    const again = createGeocoder({
      fetch: fetch as unknown as typeof globalThis.fetch,
      storage: { getItem: (key) => storage.get(key) ?? null, setItem: () => {} },
    });
    expect(await again.search("Mirpur 10", "en")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends at most one request per second, in order", async () => {
    const { geocoder, calls } = setup();
    await Promise.all([
      geocoder.search("Uttara", "en"),
      geocoder.search("Banani", "en"),
      geocoder.reverse(23.8, 90.4, "bn"),
    ]);

    expect(calls).toHaveLength(3);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1000);
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(1000);
  });

  it("keeps the queue going after a failed request", async () => {
    const { geocoder, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    await expect(geocoder.search("Gulshan", "en")).rejects.toThrow();
    expect(await geocoder.search("Gulshan", "en")).toHaveLength(1);
  });
});
