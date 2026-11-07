import { env } from "../config/env.js";

// Calls to outside services (Nominatim, OSRM). Tests replace the fetch, so
// they never reach the internet; without a replacement a test call fails.

export type OutboundFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let replacement: OutboundFetch | null = null;

export function setOutboundFetchForTests(fetcher: OutboundFetch | null) {
  replacement = fetcher;
}

// Identifies UniGo to the public services, as their usage policies ask. No
// personal data: the app's own address only.
const USER_AGENT = `UniGo/0.1 (+${env.CLIENT_URL})`;

export async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const fetcher: OutboundFetch | null =
    replacement ?? (env.NODE_ENV === "test" ? null : (target, init) => fetch(target, init));
  if (!fetcher) throw new Error("Outbound calls are disabled in tests");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Answered ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
