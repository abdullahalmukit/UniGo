import { env } from "../../config/env.js";
import { rules } from "../../config/rules.js";
import { prisma } from "../../lib/prisma.js";
import { getJson } from "../../lib/outbound.js";
import { createTtlCache } from "../../lib/ttl-cache.js";
import { recordAudit } from "../admin/audit-log.js";

// Suggested fare (proposal 8.2): OSRM driving distance x the admin's rate per
// km. A recommendation only: the user sets the amount. For a passenger request
// it is the total; for a ride offer the fare per seat. When OSRM does not
// answer, or no rate is set, there is no suggestion and the forms still work.

export type Point = { lat: number; lng: number };

const distanceCache = createTtlCache<number>(rules.ride.fareEstimate.cacheSize, rules.ride.fareEstimate.cacheTtl);

export function resetFareCacheForTests() {
  distanceCache.clear();
}

// About 11 m: two forms with nearly the same points share one OSRM call.
const key = (from: Point, to: Point) => [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(",");

// Driving distance in km, or null when OSRM cannot tell.
export async function routeDistanceKm(from: Point, to: Point): Promise<number | null> {
  const cacheKey = key(from, to);
  const hit = distanceCache.get(cacheKey);
  if (hit !== undefined) return hit;
  try {
    const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const body = (await getJson(`${env.OSRM_URL}/route/v1/driving/${coordinates}?overview=false`, rules.ride.fareEstimate.timeout)) as {
      code?: string;
      routes?: { distance?: number }[];
    };
    const metres = body.code === "Ok" ? body.routes?.[0]?.distance : undefined;
    if (typeof metres !== "number" || !Number.isFinite(metres)) return null;
    const km = Math.round(metres / 10) / 100;
    distanceCache.set(cacheKey, km);
    return km;
  } catch {
    return null;
  }
}

// The rate in force now: the newest one whose start has come.
export async function currentRatePerKm(now = new Date()) {
  const row = await prisma.fareSetting.findFirst({
    where: { effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    select: { ratePerKm: true },
  });
  return row ? Number(row.ratePerKm) : null;
}

// Rounded to whole taka and kept inside the allowed amount range.
export function suggestedAmount(distanceKm: number, ratePerKm: number) {
  const { min, max } = rules.ride.amount;
  return Math.min(max, Math.max(min, Math.round(distanceKm * ratePerKm)));
}

export async function estimateFare(from: Point, to: Point) {
  const [distanceKm, ratePerKm] = await Promise.all([routeDistanceKm(from, to), currentRatePerKm()]);
  return {
    distanceKm,
    ratePerKm,
    suggested: distanceKm !== null && ratePerKm !== null ? suggestedAmount(distanceKm, ratePerKm) : null,
  };
}

// --- Fare Settings in the admin panel (Super Admin)

export async function listFareSettings() {
  const rows = await prisma.fareSetting.findMany({ orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }], take: 50 });
  return {
    current: await currentRatePerKm(),
    history: rows.map((row) => ({ id: row.id, ratePerKm: Number(row.ratePerKm), effectiveFrom: row.effectiveFrom })),
    limits: rules.ride.ratePerKm,
  };
}

// A new rate applies from now; earlier rates stay as history.
export async function setRatePerKm(adminId: string, ratePerKm: number, ipAddress?: string) {
  await prisma.$transaction(async (tx) => {
    const previous = await tx.fareSetting.findFirst({ orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }], select: { ratePerKm: true } });
    const created = await tx.fareSetting.create({ data: { ratePerKm, effectiveFrom: new Date() } });
    await recordAudit(tx, {
      adminId,
      action: "FARE_RATE_SET",
      targetType: "fare_setting",
      targetId: created.id,
      oldValue: { ratePerKm: previous ? Number(previous.ratePerKm) : null },
      newValue: { ratePerKm },
      ipAddress,
    });
  });
  return listFareSettings();
}
