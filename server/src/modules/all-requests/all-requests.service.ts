import { rules } from "../../config/rules.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { blockedUserIds } from "../users/blocks.service.js";
import { fillPersonStats } from "../users/stats.service.js";
import { miniProfile, personSelect, subAreaSelect } from "../ride/ride.views.js";
import { toPublicVehicle } from "../vehicles/vehicles.js";
import { dhakaWallTime } from "../../utils/time.js";
import type { AllRequestsQuery } from "./all-requests.validation.js";

const DAY = 24 * 60 * 60 * 1000;
const place = (address: string, lat: Prisma.Decimal, lng: Prisma.Decimal) => ({
  address,
  lat: Number(lat),
  lng: Number(lng),
});

export type UnifiedRequestItem = {
  id: string;
  activityId?: string;
  feature: "ride" | "food" | "carpool" | "service";
  kind: "RIDE_REQUEST" | "FOOD" | "CARPOOL_POST" | "SERVICE";
  status: "OPEN";
  title: string;
  creator: Awaited<ReturnType<typeof miniProfile>>;
  pickup: { address: string; lat: number; lng: number };
  destination: { address: string; lat: number; lng: number };
  time: Date;
  amount: number;
  amountLabel: string;
  subArea: { id: string; name: string } | null;
  mine: boolean;
  details: {
    notes?: string | null;
    items?: string | null;
    passengerCount?: number;
    availableSeats?: number;
    totalSeats?: number;
    restaurantName?: string;
    deliveryCharge?: number;
    vehicle?: ReturnType<typeof toPublicVehicle> | null;
    prices?: { durationMonths: number; monthlyPrice: number }[];
  };
  link: string;
  createdAt: Date;
};

export async function listAllOpenRequests(viewerId: string | null, query: AllRequestsQuery, now = new Date()) {
  const blocked = viewerId ? await blockedUserIds(prisma, viewerId) : [];
  const graceCutoff = new Date(now.getTime() - rules.activity.expiryGracePeriod);
  const day = query.date ? { gte: dhakaWallTime(query.date, 0, 0), lt: new Date(dhakaWallTime(query.date, 0, 0).getTime() + DAY) } : {};

  const candidates: UnifiedRequestItem[] = [];

  // 1. Ride requests
  if (query.feature === "all" || query.feature === "ride") {
    const rides = await prisma.activity.findMany({
      where: {
        type: "RIDE_REQUEST",
        status: "OPEN",
        deletedAt: null,
        startTime: { gte: graceCutoff, ...day },
        ...(blocked.length > 0 && { creatorId: { notIn: blocked } }),
        rideRequest: {
          ...(query.subAreaId && { subAreaId: query.subAreaId }),
          ...(query.search && {
            OR: [
              { pickupAddress: { contains: query.search } },
              { destinationAddress: { contains: query.search } },
              { notes: { contains: query.search } },
            ],
          }),
        },
      },
      include: {
        creator: { select: personSelect },
        rideRequest: {
          include: { subArea: { select: subAreaSelect } },
        },
      },
      orderBy: { startTime: "asc" },
      take: 50,
    });

    for (const r of rides) {
      const req = r.rideRequest!;
      candidates.push({
        id: r.id,
        activityId: r.id,
        feature: "ride",
        kind: "RIDE_REQUEST",
        status: "OPEN",
        title: `${req.pickupAddress.split(",")[0].trim()} → ${req.destinationAddress.split(",")[0].trim()}`,
        creator: await miniProfile(r.creator),
        pickup: place(req.pickupAddress, req.pickupLat, req.pickupLng),
        destination: place(req.destinationAddress, req.destinationLat, req.destinationLng),
        time: r.startTime,
        amount: Number(req.offeredAmount),
        amountLabel: "Offered Fare",
        subArea: req.subArea,
        mine: viewerId === r.creatorId,
        details: {
          notes: req.notes,
          passengerCount: req.passengerCount,
        },
        link: `/ride/requests/${r.id}`,
        createdAt: r.createdAt,
      });
    }
  }

  // 2. Food requests
  if (query.feature === "all" || query.feature === "food") {
    const foods = await prisma.activity.findMany({
      where: {
        type: "FOOD",
        status: "OPEN",
        deletedAt: null,
        startTime: { gte: graceCutoff, ...day },
        ...(blocked.length > 0 && { creatorId: { notIn: blocked } }),
        foodRequest: {
          ...(query.subAreaId && { subAreaId: query.subAreaId }),
          ...(query.search && {
            OR: [
              { restaurantName: { contains: query.search } },
              { items: { contains: query.search } },
              { deliveryAddress: { contains: query.search } },
              { restaurantAddress: { contains: query.search } },
            ],
          }),
        },
      },
      include: {
        creator: { select: personSelect },
        foodRequest: {
          include: { subArea: { select: subAreaSelect } },
        },
      },
      orderBy: { startTime: "asc" },
      take: 50,
    });

    for (const f of foods) {
      const req = f.foodRequest!;
      const deliveryCharge = req.deliveryServiceAmount ? Number(req.deliveryServiceAmount) : 0;
      candidates.push({
        id: f.id,
        activityId: f.id,
        feature: "food",
        kind: "FOOD",
        status: "OPEN",
        title: `${req.restaurantName} → ${req.deliveryAddress.split(",")[0].trim()}`,
        creator: await miniProfile(f.creator),
        pickup: place(req.restaurantAddress, req.restaurantLat, req.restaurantLng),
        destination: place(req.deliveryAddress, req.deliveryLat, req.deliveryLng),
        time: f.startTime,
        amount: Number(req.estimatedBudget) + deliveryCharge,
        amountLabel: "Estimated Budget",
        subArea: req.subArea,
        mine: viewerId === f.creatorId,
        details: {
          restaurantName: req.restaurantName,
          items: req.items,
          notes: req.details,
          deliveryCharge,
        },
        link: `/food/requests/${f.id}`,
        createdAt: f.createdAt,
      });
    }
  }

  // 3. Carpool posts
  if (query.feature === "all" || query.feature === "carpool") {
    const posts = await prisma.carpoolPost.findMany({
      where: {
        status: "OPEN",
        pausedAt: null,
        seatsAvailable: { gt: 0 },
        ...(blocked.length > 0 && { riderId: { notIn: blocked } }),
        ...(query.search && {
          OR: [
            { pickupAddress: { contains: query.search } },
            { destinationAddress: { contains: query.search } },
            { notes: { contains: query.search } },
          ],
        }),
      },
      include: {
        rider: { select: personSelect },
        vehicle: true,
        prices: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    for (const p of posts) {
      const minPrice = p.prices.length > 0 ? Math.min(...p.prices.map((pr) => Number(pr.monthlyPrice))) : 0;
      candidates.push({
        id: p.id,
        feature: "carpool",
        kind: "CARPOOL_POST",
        status: "OPEN",
        title: `${p.pickupAddress.split(",")[0].trim()} → ${p.destinationAddress.split(",")[0].trim()}`,
        creator: await miniProfile(p.rider),
        pickup: place(p.pickupAddress, p.pickupLat, p.pickupLng),
        destination: place(p.destinationAddress, p.destinationLat, p.destinationLng),
        time: p.validFrom,
        amount: minPrice,
        amountLabel: "From / month",
        subArea: null,
        mine: viewerId === p.riderId,
        details: {
          availableSeats: p.seatsAvailable,
          totalSeats: p.totalSeats,
          vehicle: toPublicVehicle(p.vehicle),
          notes: p.notes,
          prices: p.prices.map((pr) => ({ durationMonths: pr.durationMonths, monthlyPrice: Number(pr.monthlyPrice) })),
        },
        link: `/carpool/posts/${p.id}`,
        createdAt: p.createdAt,
      });
    }
  }

  // 4. Uni Service
  if (query.feature === "all" || query.feature === "service") {
    const services = await prisma.activity.findMany({
      where: {
        type: "SERVICE",
        status: "OPEN",
        deletedAt: null,
        startTime: { gte: graceCutoff, ...day },
        ...(blocked.length > 0 && { creatorId: { notIn: blocked } }),
        serviceRequest: {
          ...(query.subAreaId && { subAreaId: query.subAreaId }),
          ...(query.search && {
            OR: [
              { serviceTitle: { contains: query.search } },
              { taskTitle: { contains: query.search } },
              { description: { contains: query.search } },
              { destinationAddress: { contains: query.search } },
              { pickupAddress: { contains: query.search } },
            ],
          }),
        },
      },
      include: {
        creator: { select: personSelect },
        serviceRequest: {
          include: {
            subArea: { select: subAreaSelect },
            category: true,
          },
        },
      },
      orderBy: { startTime: "asc" },
      take: 50,
    });

    for (const s of services) {
      const req = s.serviceRequest!;
      const offered = Number(req.offeredAmount);
      const budget = req.estimatedBudget ? Number(req.estimatedBudget) : 0;
      const pickupPlace = req.pickupAddress
        ? place(req.pickupAddress, req.pickupLat!, req.pickupLng!)
        : place(req.destinationAddress, req.destinationLat, req.destinationLng);

      candidates.push({
        id: s.id,
        activityId: s.id,
        feature: "service",
        kind: "SERVICE",
        status: "OPEN",
        title: `${req.serviceTitle}: ${req.taskTitle}`,
        creator: await miniProfile(s.creator),
        pickup: pickupPlace,
        destination: place(req.destinationAddress, req.destinationLat, req.destinationLng),
        time: s.startTime,
        amount: offered + budget,
        amountLabel: "Offered Amount",
        subArea: req.subArea,
        mine: viewerId === s.creatorId,
        details: {
          notes: req.description,
          items: req.itemDetails,
        },
        link: `/service/requests/${s.id}`,
        createdAt: s.createdAt,
      });
    }
  }

  // Sort candidates by time (nearest first)
  candidates.sort((a, b) => a.time.getTime() - b.time.getTime());

  // Pagination
  const page = query.page;
  const limit = query.limit;
  const start = (page - 1) * limit;
  const paginated = candidates.slice(start, start + limit);
  const hasMore = candidates.length > start + limit;

  // Fill stats (ratings, completion rate, badges)
  const result = await fillPersonStats({
    items: paginated,
    total: candidates.length,
    page,
    hasMore,
  });

  return result;
}

