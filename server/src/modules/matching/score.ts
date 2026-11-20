import { rules } from "../../config/rules.js";
import { distanceKm, type LatLng } from "../geo/distance.js";

// The Stage 1 matching score (proposal section 20): explainable and rule
// based. Each part is a number from 0 to 1; the score is their weighted
// average over the parts that have data (rules.matching.weights). Users see
// the strongest parts as reasons ("why this match"). AI only recommends.

export type ScorePart = "pickup" | "destination" | "route" | "time" | "rating" | "completion";

export type MatchContext = {
  pickup?: LatLng | null;
  destination?: LatLng | null;
  time?: Date | null;
};

export type MatchCandidate = {
  pickup?: LatLng | null;
  destination?: LatLng | null;
  time?: Date | null;
  // Carpool: minutes after midnight (Asia/Dhaka) instead of an instant
  minuteOfDay?: number | null;
  rating?: number | null;
  completionRate?: number | null;
};

export type Reason =
  | { code: "PICKUP_NEAR"; km: number }
  | { code: "DESTINATION_NEAR"; km: number }
  | { code: "SAME_DIRECTION" }
  | { code: "TIME_CLOSE"; minutes: number }
  | { code: "HIGH_RATING"; rating: number }
  | { code: "RELIABLE"; percent: number };

export type MatchScore = { score: number; parts: Partial<Record<ScorePart, number>>; reasons: Reason[] };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

// 1 at the same place, falling linearly to 0 at radiusKm.
export const closeness = (km: number, radiusKm = rules.matching.radiusKm) => clamp01(1 - km / radiusKm);

// How much two trips go the same way: 1 same direction, 0.5 at right angles, 0 opposite.
export function sameDirection(a: { from: LatLng; to: LatLng }, b: { from: LatLng; to: LatLng }) {
  const vector = (trip: { from: LatLng; to: LatLng }) => {
    const midLat = ((trip.from.lat + trip.to.lat) / 2) * (Math.PI / 180);
    return { x: (trip.to.lng - trip.from.lng) * Math.cos(midLat), y: trip.to.lat - trip.from.lat };
  };
  const va = vector(a);
  const vb = vector(b);
  const lengths = Math.hypot(va.x, va.y) * Math.hypot(vb.x, vb.y);
  if (lengths === 0) return null;
  const cosine = (va.x * vb.x + va.y * vb.y) / lengths;
  return clamp01((cosine + 1) / 2);
}

// Minutes between two minutes-of-day on a 24-hour clock (across midnight too).
export function minuteGap(a: number, b: number) {
  const gap = Math.abs(a - b) % 1440;
  return Math.min(gap, 1440 - gap);
}

export function scoreMatch(context: MatchContext & { minuteOfDay?: number | null }, candidate: MatchCandidate): MatchScore {
  const parts: Partial<Record<ScorePart, number>> = {};
  const reasons: { reason: Reason; weight: number }[] = [];
  const w = rules.matching.weights;
  const strong = (value: number) => value >= rules.matching.reasonFrom;

  if (context.pickup && candidate.pickup) {
    const km = distanceKm(context.pickup, candidate.pickup);
    parts.pickup = closeness(km);
    if (strong(parts.pickup)) reasons.push({ reason: { code: "PICKUP_NEAR", km: round(km, 1) }, weight: w.pickup * parts.pickup });
  }
  if (context.destination && candidate.destination) {
    const km = distanceKm(context.destination, candidate.destination);
    parts.destination = closeness(km);
    if (strong(parts.destination)) reasons.push({ reason: { code: "DESTINATION_NEAR", km: round(km, 1) }, weight: w.destination * parts.destination });
  }
  if (context.pickup && context.destination && candidate.pickup && candidate.destination) {
    const direction = sameDirection({ from: context.pickup, to: context.destination }, { from: candidate.pickup, to: candidate.destination });
    if (direction !== null) {
      parts.route = direction;
      if (direction >= 0.9) reasons.push({ reason: { code: "SAME_DIRECTION" }, weight: w.route * direction });
    }
  }
  if (context.time && candidate.time) {
    const minutes = Math.abs(context.time.getTime() - candidate.time.getTime()) / 60_000;
    parts.time = clamp01(1 - (minutes * 60_000) / rules.matching.timeWindow);
    if (strong(parts.time)) reasons.push({ reason: { code: "TIME_CLOSE", minutes: Math.round(minutes) }, weight: w.time * parts.time });
  } else if (context.minuteOfDay != null && candidate.minuteOfDay != null) {
    const minutes = minuteGap(context.minuteOfDay, candidate.minuteOfDay);
    parts.time = clamp01(1 - minutes / rules.matching.carpoolMinuteWindow);
    if (strong(parts.time)) reasons.push({ reason: { code: "TIME_CLOSE", minutes }, weight: w.time * parts.time });
  }
  // "New" people (no rating or rate yet) count as neutral, never as bad.
  parts.rating = candidate.rating != null ? clamp01((candidate.rating - 1) / 4) : 0.5;
  if (candidate.rating != null && candidate.rating >= 4.5) reasons.push({ reason: { code: "HIGH_RATING", rating: candidate.rating }, weight: w.rating * parts.rating });
  parts.completion = candidate.completionRate != null ? clamp01(candidate.completionRate) : 0.5;
  if (candidate.completionRate != null && candidate.completionRate >= 0.9) {
    reasons.push({ reason: { code: "RELIABLE", percent: Math.round(candidate.completionRate * 100) }, weight: w.completion * parts.completion });
  }

  let total = 0;
  let weights = 0;
  for (const [part, value] of Object.entries(parts) as [ScorePart, number][]) {
    total += w[part] * value;
    weights += w[part];
  }
  return {
    score: weights === 0 ? 0 : round(total / weights),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)])) as Partial<Record<ScorePart, number>>,
    reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 3).map((item) => item.reason),
  };
}
