import { describe, expect, it, vi } from "vitest";
import { createGeocoder } from "./nominatim";

function setup() {
  const paths: string[] = [];
  const get = vi.fn(async (path: string) => {
    paths.push(path);
    return path.startsWith("/geo/reverse")
      ? { address: "Road 27, Dhanmondi" }
      : { places: [{ label: "Dhanmondi Lake, Dhaka", lat: 23.74, lng: 90.37 }] };
  });
  const storage = new Map<string, string>();
  const geocoder = createGeocoder({
    get,
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value) },
  });
  return { geocoder, get, paths, storage };
}

describe("geocoder (through the UniGo server, B3a)", () => {
  it("searches places through /api/geo with the tidied text and language", async () => {
    const { geocoder, paths } = setup();
    const places = await geocoder.search("  Dhanmondi   lake ", "en");

    expect(places).toEqual([{ label: "Dhanmondi Lake, Dhaka", lat: 23.74, lng: 90.37 }]);
    const url = new URL(paths[0], "http://x");
    expect(url.pathname).toBe("/geo/search");
    expect(url.searchParams.get("q")).toBe("Dhanmondi lake");
    expect(url.searchParams.get("lang")).toBe("en");
  });

  it("skips very short searches", async () => {
    const { geocoder, get } = setup();
    expect(await geocoder.search("ab", "en")).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("answers repeats from the cache, also after a reload (sessionStorage)", async () => {
    const { geocoder, get, storage } = setup();
    await geocoder.search("Mirpur 10", "en");
    await geocoder.search("mirpur 10", "en");
    expect(await geocoder.reverse(23.746512, 90.376201, "en")).toBe("Road 27, Dhanmondi");
    await geocoder.reverse(23.746514, 90.376199, "en");
    expect(get).toHaveBeenCalledTimes(2);

    // A new geocoder (page reload) with the same storage
    const again = createGeocoder({ get, storage: { getItem: (key) => storage.get(key) ?? null, setItem: () => {} } });
    expect(await again.search("Mirpur 10", "en")).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("asks once when the same question is asked twice at the same time", async () => {
    const { geocoder, get } = setup();
    await Promise.all([geocoder.search("Uttara", "en"), geocoder.search("uttara", "en")]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed request", async () => {
    const { geocoder, get } = setup();
    get.mockRejectedValueOnce(new Error("GEO_UNAVAILABLE"));
    await expect(geocoder.search("Gulshan", "en")).rejects.toThrow();
    expect(await geocoder.search("Gulshan", "en")).toHaveLength(1);
  });
});
