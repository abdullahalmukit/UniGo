import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { offerSelect, offerView, requestSelect, requestView } from "../ride/ride.views.js";
import { toPublicVehicle } from "../vehicles/vehicles.js";
import { isBlockedBetween } from "./blocks.service.js";
import { photoLink } from "./photo.js";

// A person's public profile (proposal 8.3, B3b-1 G). Opened by verified
// students from ride cards, detail pages, the chat header and Activity. Never
// a phone number or an email. Blocked users (either way) and BANNED accounts
// answer "not found" (Q3). Rating, completion rate, late cancellation rate
// and reviews are filled in by B3b-2.

const notFound = () => new AppError(404, "PROFILE_NOT_FOUND", "This profile is not available");

export async function getPublicProfile(viewerId: string, userId: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      accountStatus: true,
      studentVerificationStatus: true,
      isVerifiedRider: true,
      riderActive: true,
      createdAt: true,
      university: { select: { name: true, shortName: true } },
      profile: { select: { fullName: true, department: true, batch: true, photoKey: true } },
      vehicles: {
        where: { status: "APPROVED", isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, brand: true, model: true, colour: true, registrationNumber: true, seatCapacity: true },
      },
    },
  });
  if (!user || user.accountStatus === "BANNED") throw notFound();
  if (viewerId !== userId && (await isBlockedBetween(prisma, viewerId, userId))) throw notFound();

  // Open requests and offers only, as on the Ride page (offers of Active riders)
  const [requests, offers] = await Promise.all([
    prisma.activity.findMany({
      where: { type: "RIDE_REQUEST", creatorId: userId, status: "OPEN", deletedAt: null, startTime: { gt: now } },
      orderBy: { startTime: "asc" },
      take: 20,
      select: requestSelect,
    }),
    user.riderActive
      ? prisma.rideOffer.findMany({
          where: { riderId: userId, status: "OPEN", departureTime: { gt: now } },
          orderBy: { departureTime: "asc" },
          take: 20,
          select: offerSelect,
        })
      : Promise.resolve([]),
  ]);

  const badges: string[] = [];
  if (user.studentVerificationStatus === "VERIFIED") badges.push("VERIFIED_STUDENT");
  if (user.isVerifiedRider) badges.push("VERIFIED_RIDER");

  return {
    id: user.id,
    name: user.profile?.fullName ?? "",
    photo: await photoLink(user.profile?.photoKey),
    university: user.university,
    department: user.profile?.department ?? null,
    batch: user.profile?.batch ?? null,
    memberSince: user.createdAt,
    badges,
    vehicles: user.isVerifiedRider ? user.vehicles.map(toPublicVehicle) : [],
    // B3b-2
    stats: { rating: null, completed: null, completionRate: null, lateCancellationRate: null },
    reviews: [] as unknown[],
    openRides: [
      ...(await Promise.all(requests.map((row) => requestView(row, viewerId)))),
      ...(await Promise.all(offers.map((row) => offerView(row, viewerId)))),
    ],
    isMe: viewerId === userId,
  };
}
