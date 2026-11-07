import { rules } from "../../config/rules.js";
import type { ActivityStatus, PostStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { participantPhones } from "../users/contact.js";
import { completionBy, miniProfile, personSelect } from "./ride.views.js";

// Ride Sharing items for Activity and Upcoming (proposal 12.2 and 12.3,
// B3b-1). Participants (A2 decision 7): the passenger created a request and
// booked a seat (accepter of the booking); the rider accepted a request and
// owns an offer (creator of its bookings). A rider's bookings are shown inside
// their offer, never as separate items (Q1).

export type FeedTab = "active" | "ongoing" | "history";
export type FeedRole = "all" | "requested" | "accepted";

export const TAB_STATUSES: Record<FeedTab, readonly ActivityStatus[]> = {
  active: ["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED"],
  ongoing: ["IN_PROGRESS"],
  history: ["COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"],
};
const RUNNING: readonly ActivityStatus[] = ["ACCEPTED", "IN_PROGRESS", "DISPUTED"];

// How many rows of each kind are read before merging and paging
export const CANDIDATES = 300;

const place = (address: string, lat: Prisma.Decimal, lng: Prisma.Decimal) => ({ address, lat: Number(lat), lng: Number(lng) });

export type FeedItem = {
  // B4: food requests join the feed (food.feed.ts)
  feature: "RIDE" | "FOOD";
  kind: "RIDE_REQUEST" | "RIDE_OFFER" | "RIDE_BOOKING" | "FOOD";
  id: string;
  role: "REQUESTED" | "ACCEPTED";
  // An activity status, or a post status (OPEN, FULL, CLOSED) for an offer
  status: ActivityStatus | PostStatus;
  subStatus: string | null;
  completionRequestedBy: "ME" | "OTHER" | null;
  time: Date;
  pickup: { address: string; lat: number; lng: number };
  destination: { address: string; lat: number; lng: number };
  amount: number;
  seats: number | null;
  otherPerson: Awaited<ReturnType<typeof miniProfile>> | null;
  phone: string | null;
  chatId: string | null;
  // B3b-2: the payment record (none for an offer itself)
  payment: { amount: number; method: string | null; status: "UNPAID" | "PAID"; payee: "ME" | "OTHER" } | null;
  // B3b-2: "CAN_REVIEW" while a completed activity can still be reviewed by
  // the viewer, "REVIEWED" once they have, otherwise null
  review: "CAN_REVIEW" | "REVIEWED" | null;
  // Offers: the rider's bookings on it
  bookings: {
    activityId: string;
    status: ActivityStatus;
    seatsBooked: number;
    amount: number;
    passenger: Awaited<ReturnType<typeof miniProfile>> | null;
    phone: string | null;
  }[];
  activeBookings: number;
  // B4: food only (pickup = restaurant, destination = delivery location)
  food: { restaurantName: string; items: string; quantity: number; foodPrice: number; deliveryCharge: number; cancellableByMe: boolean } | null;
};

const requestFeedSelect = {
  id: true,
  status: true,
  completedAt: true,
  paymentRecord: { select: { amount: true, method: true, status: true, payeeId: true } },
  reviews: { select: { reviewerId: true } },

  subStatus: true,
  startTime: true,
  creatorId: true,
  accepterId: true,
  completionRequestedById: true,
  creator: { select: personSelect },
  accepter: { select: personSelect },
  chat: { select: { id: true } },
  rideRequest: {
    select: {
      pickupAddress: true,
      pickupLat: true,
      pickupLng: true,
      destinationAddress: true,
      destinationLat: true,
      destinationLng: true,
      offeredAmount: true,
      passengerCount: true,
    },
  },
} as const satisfies Prisma.ActivitySelect;

const bookingFeedSelect = {
  id: true,
  status: true,
  completedAt: true,
  paymentRecord: { select: { amount: true, method: true, status: true, payeeId: true } },
  reviews: { select: { reviewerId: true } },

  subStatus: true,
  startTime: true,
  creatorId: true,
  accepterId: true,
  completionRequestedById: true,
  creator: { select: personSelect },
  chat: { select: { id: true } },
  rideBooking: {
    select: {
      seatsBooked: true,
      amount: true,
      rideOffer: { select: { pickupAddress: true, pickupLat: true, pickupLng: true, destinationAddress: true, destinationLat: true, destinationLng: true } },
    },
  },
} as const satisfies Prisma.ActivitySelect;

const offerFeedSelect = {
  id: true,
  status: true,
  departureTime: true,
  farePerSeat: true,
  totalSeats: true,
  seatsAvailable: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  destinationAddress: true,
  destinationLat: true,
  destinationLng: true,
  bookings: {
    orderBy: { createdAt: "asc" },
    select: {
      activityId: true,
      seatsBooked: true,
      amount: true,
      activity: { select: { status: true, accepterId: true, accepter: { select: personSelect } } },
    },
  },
} as const satisfies Prisma.RideOfferSelect;

type OfferRow = Prisma.RideOfferGetPayload<{ select: typeof offerFeedSelect }>;

// Q2: an offer is Active while it can take bookings or a booking has not
// finished; Ongoing while a booking is in progress; History otherwise.
export function offerTab(offer: { status: PostStatus; departureTime: Date; bookings: { activity: { status: ActivityStatus } }[] }, now: Date): FeedTab[] {
  const statuses = offer.bookings.map((b) => b.activity.status);
  const bookable = (offer.status === "OPEN" || offer.status === "FULL") && offer.departureTime > now;
  const running = statuses.some((s) => RUNNING.includes(s));
  const tabs: FeedTab[] = [];
  if (bookable || running) tabs.push("active");
  if (statuses.includes("IN_PROGRESS")) tabs.push("ongoing");
  if (tabs.length === 0) tabs.push("history");
  return tabs;
}

export function requestWhere(userId: string, role: FeedRole): Prisma.ActivityWhereInput {
  if (role === "requested") return { creatorId: userId };
  if (role === "accepted") return { accepterId: userId };
  return { OR: [{ creatorId: userId }, { accepterId: userId }] };
}

async function offerItems(userId: string, rows: OfferRow[]): Promise<FeedItem[]> {
  const phones = await participantPhones(
    userId,
    rows.flatMap((offer) => offer.bookings.map((b) => ({ otherId: b.activity.accepterId, status: b.activity.status }))),
  );
  let i = 0;
  return Promise.all(
    rows.map(async (offer) => {
      const bookings = await Promise.all(
        offer.bookings.map(async (b) => ({
          activityId: b.activityId,
          status: b.activity.status,
          seatsBooked: b.seatsBooked,
          amount: Number(b.amount),
          passenger: b.activity.accepter ? await miniProfile(b.activity.accepter) : null,
          phone: phones[i++] ?? null,
        })),
      );
      return {
        feature: "RIDE" as const,
        kind: "RIDE_OFFER" as const,
        id: offer.id,
        role: "REQUESTED" as const,
        status: offer.status,
        subStatus: null,
        completionRequestedBy: null,
        time: offer.departureTime,
        pickup: place(offer.pickupAddress, offer.pickupLat, offer.pickupLng),
        destination: place(offer.destinationAddress, offer.destinationLat, offer.destinationLng),
        amount: Number(offer.farePerSeat),
        seats: offer.seatsAvailable,
        otherPerson: null,
        phone: null,
        chatId: null,
        payment: null,
        review: null,
        bookings,
        activeBookings: bookings.filter((b) => RUNNING.includes(b.status)).length,
        food: null,
      };
    }),
  );
}

type RequestRow = Prisma.ActivityGetPayload<{ select: typeof requestFeedSelect }>;
type BookingRow = Prisma.ActivityGetPayload<{ select: typeof bookingFeedSelect }>;

type Extras = {
  status: ActivityStatus;
  completedAt: Date | null;
  paymentRecord: { amount: Prisma.Decimal; method: string | null; status: "UNPAID" | "PAID"; payeeId: string } | null;
  reviews: { reviewerId: string }[];
};

export function extras(row: Extras, userId: string, now: Date) {
  const p = row.paymentRecord;
  const reviewed = row.reviews.some((r) => r.reviewerId === userId);
  const open = row.status === "COMPLETED" && row.completedAt !== null && now.getTime() < row.completedAt.getTime() + rules.reviews.window;
  return {
    payment: p ? { amount: Number(p.amount), method: p.method, status: p.status, payee: p.payeeId === userId ? ("ME" as const) : ("OTHER" as const) } : null,
    review: reviewed ? ("REVIEWED" as const) : open ? ("CAN_REVIEW" as const) : null,
  };
}

async function activityItems(userId: string, requests: RequestRow[], bookings: BookingRow[], now = new Date()): Promise<FeedItem[]> {
  const phones = await participantPhones(userId, [
    ...requests.map((r) => ({ otherId: r.creatorId === userId ? r.accepterId : r.creatorId, status: r.status })),
    ...bookings.map((b) => ({ otherId: b.creatorId, status: b.status })),
  ]);
  const requestItems = await Promise.all(
    requests.map(async (row, i): Promise<FeedItem> => {
      const r = row.rideRequest!;
      const mine = row.creatorId === userId;
      const other = mine ? row.accepter : row.creator;
      return {
        feature: "RIDE",
        kind: "RIDE_REQUEST",
        id: row.id,
        role: mine ? "REQUESTED" : "ACCEPTED",
        status: row.status,
        subStatus: row.subStatus,
        completionRequestedBy: completionBy(row.completionRequestedById, userId),
        time: row.startTime,
        pickup: place(r.pickupAddress, r.pickupLat, r.pickupLng),
        destination: place(r.destinationAddress, r.destinationLat, r.destinationLng),
        amount: Number(r.offeredAmount),
        seats: r.passengerCount,
        otherPerson: other ? await miniProfile(other) : null,
        phone: phones[i] ?? null,
        chatId: row.chat?.id ?? null,
        ...extras(row, userId, now),
        bookings: [],
        activeBookings: 0,
        food: null,
      };
    }),
  );
  const bookingItems = await Promise.all(
    bookings.map(async (row, i): Promise<FeedItem> => {
      const offer = row.rideBooking!.rideOffer;
      return {
        feature: "RIDE",
        kind: "RIDE_BOOKING",
        id: row.id,
        role: "ACCEPTED",
        status: row.status,
        subStatus: row.subStatus,
        completionRequestedBy: completionBy(row.completionRequestedById, userId),
        time: row.startTime,
        pickup: place(offer.pickupAddress, offer.pickupLat, offer.pickupLng),
        destination: place(offer.destinationAddress, offer.destinationLat, offer.destinationLng),
        amount: Number(row.rideBooking!.amount),
        seats: row.rideBooking!.seatsBooked,
        otherPerson: await miniProfile(row.creator),
        phone: phones[requests.length + i] ?? null,
        chatId: row.chat?.id ?? null,
        ...extras(row, userId, now),
        bookings: [],
        activeBookings: 0,
        food: null,
      };
    }),
  );
  return [...requestItems, ...bookingItems];
}

// Activity (12.2): the user's ride items for one tab and role. Deleted
// requests are hidden (A2 decision 2).
export async function rideActivity(userId: string, tab: FeedTab, role: FeedRole, now = new Date()) {
  const statuses = [...TAB_STATUSES[tab]];
  const newestFirst = tab === "history";
  const order = { startTime: newestFirst ? ("desc" as const) : ("asc" as const) };

  const requests = await prisma.activity.findMany({
    where: { type: "RIDE_REQUEST", deletedAt: null, status: { in: statuses }, ...requestWhere(userId, role) },
    orderBy: [order, { id: "asc" }],
    take: CANDIDATES,
    select: requestFeedSelect,
  });
  const bookings =
    role === "requested"
      ? []
      : await prisma.activity.findMany({
          where: { type: "RIDE_BOOKING", accepterId: userId, status: { in: statuses } },
          orderBy: [order, { id: "asc" }],
          take: CANDIDATES,
          select: bookingFeedSelect,
        });
  const offers =
    role === "accepted"
      ? []
      : (
          await prisma.rideOffer.findMany({
            where: { riderId: userId },
            orderBy: [{ departureTime: newestFirst ? "desc" : "asc" }, { id: "asc" }],
            take: CANDIDATES,
            select: offerFeedSelect,
          })
        ).filter((offer) => offerTab(offer, now).includes(tab));

  const items = [...(await activityItems(userId, requests, bookings)), ...(await offerItems(userId, offers))];
  return items.sort((a, b) => (newestFirst ? b.time.getTime() - a.time.getTime() : a.time.getTime() - b.time.getTime()));
}

// Upcoming (12.3): future ACCEPTED rides, nearest first. A rider's offer is one
// card while it has at least one accepted booking (Q1, addition 1).
export async function rideUpcoming(userId: string, role: FeedRole, now = new Date()) {
  const future = { status: "ACCEPTED" as const, startTime: { gt: now } };
  const requests = await prisma.activity.findMany({
    where: { type: "RIDE_REQUEST", deletedAt: null, ...future, ...requestWhere(userId, role) },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: requestFeedSelect,
  });
  const bookings =
    role === "requested"
      ? []
      : await prisma.activity.findMany({
          where: { type: "RIDE_BOOKING", accepterId: userId, ...future },
          orderBy: [{ startTime: "asc" }, { id: "asc" }],
          take: CANDIDATES,
          select: bookingFeedSelect,
        });
  const offers =
    role === "accepted"
      ? []
      : await prisma.rideOffer.findMany({
          where: { riderId: userId, departureTime: { gt: now }, bookings: { some: { activity: { status: "ACCEPTED" } } } },
          orderBy: [{ departureTime: "asc" }, { id: "asc" }],
          take: CANDIDATES,
          select: offerFeedSelect,
        });
  const items = [...(await activityItems(userId, requests, bookings)), ...(await offerItems(userId, offers))];
  return items.sort((a, b) => a.time.getTime() - b.time.getTime());
}
