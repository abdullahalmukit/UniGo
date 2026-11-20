import { Prisma } from "../../generated/prisma/client.js";
import { rules } from "../../config/rules.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { runInBackground } from "../../utils/background.js";
import { searchCarpools } from "../carpool/carpool.service.js";
import { listFood } from "../food/food.service.js";
import { getRideOffer, getRideRequest, listRides } from "../ride/ride.service.js";
import { listServiceRequests } from "../service/service.service.js";
import { fillPersonStats } from "../users/stats.service.js";
import type { LatLng } from "../geo/distance.js";
import { scoreMatch, type MatchContext, type MatchScore } from "./score.js";
import type { SuggestionsQuery } from "./matching.validation.js";

// B9 Stage 1 suggestions (proposal section 20): the open items a user could
// take, ranked by the explainable score. Candidates come from the normal list
// functions, so the same rules apply as on each feature's page (open items
// only, Active riders' offers, no blocked users, start not passed); the
// viewer's own items are left out. Every suggestion shown is logged for
// Stage 2 and the metrics. AI only recommends: users always choose.

export type Target = "ride_offer" | "ride_request" | "carpool_post" | "food" | "service";

type Candidate = {
  id: string;
  target: Target;
  item: unknown;
  pickup?: LatLng | null;
  destination?: LatLng | null;
  time?: Date | null;
  minuteOfDay?: number | null;
  person: { rating: number | null; completionRate: number | null } | null;
};

const point = (lat?: number, lng?: number): LatLng | null => (lat !== undefined && lng !== undefined ? { lat, lng } : null);
const plain = (p: { lat: number; lng: number } | null | undefined) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null);

// Minutes after midnight in Asia/Dhaka (UTC+6, no daylight saving)
const dhakaMinute = (time: Date) => (time.getUTCHours() * 60 + time.getUTCMinutes() + 360) % 1440;
const dhakaWeekday = (time: Date) => new Date(time.getTime() + 6 * 3600_000).getUTCDay();

async function pages<T>(read: (page: number) => Promise<{ items: T[]; hasMore: boolean }>) {
  const all: T[] = [];
  for (let page = 1; page <= rules.matching.candidatePages; page += 1) {
    const result = await read(page);
    all.push(...result.items);
    if (!result.hasMore) break;
  }
  return all;
}

const NO_CONTEXT = () => new AppError(400, "MATCH_CONTEXT_REQUIRED", "Give a place, or one of your own requests or offers, to match against");

// The context and target a query asks for. `from` is one of the viewer's own
// open ride requests (-> ride offers) or ride offers (-> passenger requests).
async function resolveContext(viewerId: string, query: SuggestionsQuery, now: Date) {
  const context: MatchContext & { minuteOfDay?: number | null; seats?: number } = {
    pickup: point(query.pickupLat, query.pickupLng),
    destination: point(query.destinationLat, query.destinationLng),
    time: query.time ?? null,
  };
  let target: Target;
  let sourceId: string | null = null;

  if (query.feature === "ride" && query.from) {
    const request = await getRideRequest(viewerId, query.from, now).catch(() => null);
    if (request && request.mine) {
      if (request.status !== "OPEN") throw new AppError(409, "MATCH_SOURCE_CLOSED", "This request is no longer open");
      Object.assign(context, { pickup: plain(request.pickup), destination: plain(request.destination), time: new Date(request.startTime), seats: request.passengerCount });
      return { context, target: "ride_offer" as Target, sourceId: request.id };
    }
    const offer = await getRideOffer(viewerId, query.from, now).catch(() => null);
    if (offer && offer.mine) {
      if (offer.status !== "OPEN") throw new AppError(409, "MATCH_SOURCE_CLOSED", "This offer is not taking bookings");
      Object.assign(context, { pickup: plain(offer.pickup), destination: plain(offer.destination), time: new Date(offer.departureTime), seats: offer.seatsAvailable });
      return { context, target: "ride_request" as Target, sourceId: offer.id };
    }
    throw new AppError(404, "MATCH_SOURCE_NOT_FOUND", "Your request or offer was not found");
  }

  if (!context.pickup && !context.destination) throw NO_CONTEXT();
  switch (query.feature) {
    case "ride":
      target = query.target === "requests" ? "ride_request" : "ride_offer";
      context.seats = query.seats;
      break;
    case "carpool":
      target = "carpool_post";
      if (context.time) context.minuteOfDay = dhakaMinute(context.time);
      context.time = null;
      break;
    case "food":
      target = "food";
      break;
    default:
      target = "service";
  }
  return { context, target, sourceId };
}

async function candidatesFor(viewerId: string, target: Target, context: MatchContext & { seats?: number }, query: SuggestionsQuery, now: Date): Promise<Candidate[]> {
  const radiusKm = rules.matching.radiusKm;
  // Narrow by the pickup when there is one, else by the destination.
  const near = context.pickup
    ? { pickupLat: context.pickup.lat, pickupLng: context.pickup.lng }
    : context.destination
      ? { destinationLat: context.destination.lat, destinationLng: context.destination.lng }
      : {};

  if (target === "ride_offer" || target === "ride_request") {
    const items = await pages((page) =>
      listRides(viewerId, { type: target === "ride_offer" ? "offers" : "requests", radiusKm, page, ...near } as Parameters<typeof listRides>[1], now),
    );
    await fillPersonStats(items);
    return items
      .filter((item) => !item.mine)
      .filter((item) =>
        item.kind === "OFFER"
          ? item.seatsAvailable >= (context.seats ?? 1)
          : context.seats === undefined || item.passengerCount <= context.seats,
      )
      .map((item) => ({
        id: item.id,
        target,
        item,
        pickup: plain(item.pickup),
        destination: plain(item.destination),
        time: new Date(item.kind === "OFFER" ? item.departureTime : item.startTime),
        person: item.kind === "OFFER" ? item.rider : item.passenger,
      }));
  }

  if (target === "carpool_post") {
    const day = query.time ? dhakaWeekday(query.time) : undefined;
    const items = await pages((page) => searchCarpools(viewerId, { radiusKm, page, ...(day !== undefined && { day }), ...near } as Parameters<typeof searchCarpools>[1], now));
    await fillPersonStats(items);
    return items
      .filter((item) => !item.mine && item.seatsAvailable > 0)
      .map((item) => ({
        id: item.id,
        target,
        item,
        pickup: plain(item.pickup),
        destination: plain(item.destination),
        minuteOfDay: item.departureMinute,
        person: item.rider,
      }));
  }

  if (target === "food") {
    const foodNear = context.pickup
      ? { restaurantLat: context.pickup.lat, restaurantLng: context.pickup.lng }
      : context.destination
        ? { deliveryLat: context.destination.lat, deliveryLng: context.destination.lng }
        : {};
    const items = await pages((page) => listFood(viewerId, { radiusKm, page, ...foodNear } as Parameters<typeof listFood>[1], now));
    await fillPersonStats(items);
    return items
      .filter((item) => !item.mine)
      .map((item) => ({
        id: item.id,
        target,
        item,
        pickup: plain(item.restaurant),
        destination: plain(item.delivery),
        time: new Date(item.expectedDeliveryTime),
        person: item.requester,
      }));
  }

  const items = await pages((page) => listServiceRequests(viewerId, { page, radiusKm } as Parameters<typeof listServiceRequests>[1], now));
  await fillPersonStats(items);
  return items
    .filter((item) => !item.mine)
    .map((item) => ({
      id: item.id,
      target,
      item,
      pickup: item.pickup ? plain(item.pickup) : null,
      destination: plain(item.destination),
      time: item.hasPreferredTime ? new Date(item.startTime) : null,
      person: item.requester,
    }));
}

export async function getSuggestions(viewerId: string, query: SuggestionsQuery, now = new Date()) {
  const { context, target, sourceId } = await resolveContext(viewerId, query, now);
  const candidates = await candidatesFor(viewerId, target, context, query, now);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      match: scoreMatch(context, {
        pickup: candidate.pickup,
        destination: candidate.destination,
        time: candidate.time,
        minuteOfDay: candidate.minuteOfDay,
        rating: candidate.person?.rating ?? null,
        completionRate: candidate.person?.completionRate ?? null,
      }),
    }))
    .sort((a, b) => b.match.score - a.match.score || a.candidate.id.localeCompare(b.candidate.id))
    .slice(0, query.limit);

  runInBackground("match suggestion log", () => logShown(viewerId, query.feature, target, sourceId, scored, now));
  return {
    feature: query.feature,
    target,
    sourceId,
    suggestions: scored.map(({ candidate, match }, index) => ({
      rank: index + 1,
      score: match.score,
      reasons: match.reasons,
      target: candidate.target,
      item: candidate.item,
    })),
  };
}

// One row per suggestion shown; the same viewer and candidate at most once
// per hour (rules.matching.logEvery), so reloading a page logs nothing new.
async function logShown(viewerId: string, feature: string, target: Target, sourceId: string | null, scored: { candidate: Candidate; match: MatchScore }[], now: Date) {
  if (scored.length === 0) return;
  const recent = await prisma.matchSuggestion.findMany({
    where: { viewerId, candidateId: { in: scored.map((s) => s.candidate.id) }, shownAt: { gte: new Date(now.getTime() - rules.matching.logEvery) } },
    select: { candidateId: true },
  });
  const seen = new Set(recent.map((row) => row.candidateId));
  const rows = scored
    .map((s, index) => ({ ...s, rank: index + 1 }))
    .filter((s) => !seen.has(s.candidate.id))
    .map((s) => ({
      viewerId,
      feature,
      target,
      candidateId: s.candidate.id,
      sourceId,
      rank: s.rank,
      score: new Prisma.Decimal(s.match.score.toFixed(4)),
      components: s.match.parts as Prisma.InputJsonValue,
      shownAt: now,
    }));
  if (rows.length > 0) await prisma.matchSuggestion.createMany({ data: rows });
}

// Called after the viewer accepted a request, booked an offer or asked for a
// carpool seat: a suggestion of that item shown in the last day is "taken".
export function markSuggestionTaken(viewerId: string, candidateId: string, now = new Date()) {
  runInBackground("match suggestion taken", () =>
    prisma.matchSuggestion.updateMany({
      where: { viewerId, candidateId, takenAt: null, shownAt: { gte: new Date(now.getTime() - rules.matching.takenWithin) } },
      data: { takenAt: now },
    }),
  );
}

// Admin metrics (proposal section 20 evaluation): suggestions shown and taken,
// the acceptance rate, and by rank (precision@k: share of shown top-k
// suggestions that were taken).
export async function matchingMetrics(days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 3600_000);
  const rows = await prisma.matchSuggestion.groupBy({
    by: ["feature", "rank"],
    where: { shownAt: { gte: since } },
    _count: { _all: true, takenAt: true },
  });
  const shown = rows.reduce((sum, row) => sum + row._count._all, 0);
  const taken = rows.reduce((sum, row) => sum + row._count.takenAt, 0);
  const precisionAt = (k: number) => {
    const top = rows.filter((row) => row.rank <= k);
    const topShown = top.reduce((sum, row) => sum + row._count._all, 0);
    return topShown === 0 ? null : Math.round((top.reduce((sum, row) => sum + row._count.takenAt, 0) / topShown) * 10000) / 10000;
  };
  const features = [...new Set(rows.map((row) => row.feature))].sort().map((feature) => {
    const own = rows.filter((row) => row.feature === feature);
    const s = own.reduce((sum, row) => sum + row._count._all, 0);
    const t = own.reduce((sum, row) => sum + row._count.takenAt, 0);
    return { feature, shown: s, taken: t, acceptanceRate: s === 0 ? null : Math.round((t / s) * 10000) / 10000 };
  });
  return {
    days,
    shown,
    taken,
    acceptanceRate: shown === 0 ? null : Math.round((taken / shown) * 10000) / 10000,
    precisionAt1: precisionAt(1),
    precisionAt3: precisionAt(3),
    precisionAt5: precisionAt(5),
    features,
  };
}
