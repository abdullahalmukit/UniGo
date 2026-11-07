import { rules } from "../../config/rules.js";
import type { ActivityStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { dateOnlyString } from "../../utils/time.js";
import { CANDIDATES, TAB_STATUSES, type FeedItem, type FeedRole, type FeedTab } from "../ride/ride.feed.js";
import { miniProfile, personSelect } from "../ride/ride.views.js";
import { participantPhones } from "../users/contact.js";
import { contractEndDate, nextRideTime } from "./carpool-dates.js";
import { scheduleOf } from "./carpool.views.js";

// Carpool items for Activity and Upcoming (proposal 12.2 and 12.3, B6a).
// Participants (A2 decision 7): the rider owns the post ("Requested by me")
// and is the creator of its bookings; the passenger requested a seat
// ("Accepted by me"). A rider's bookings are shown inside their post, never
// as separate items (as ride offers, B3b-1). Upcoming lists only sessions in
// the next 7 days; a rider sees one card per post and ride time.

// A booking still waiting, holding a seat or under a contract
const UNFINISHED: readonly ActivityStatus[] = ["OPEN", "ACCEPTED", "DISPUTED"];
const RUNNING: readonly ActivityStatus[] = ["ACCEPTED", "IN_PROGRESS", "DISPUTED"];

const place = (address: string, lat: Prisma.Decimal, lng: Prisma.Decimal) => ({ address, lat: Number(lat), lng: Number(lng) });

const postFeedSelect = {
  id: true,
  status: true,
  pausedAt: true,
  daysOfWeek: true,
  departureMinute: true,
  validFrom: true,
  validUntil: true,
  closedAt: true,
  createdAt: true,
  seatsAvailable: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  destinationAddress: true,
  destinationLat: true,
  destinationLng: true,
  prices: { orderBy: { durationMonths: "asc" }, select: { monthlyPrice: true } },
  bookings: {
    orderBy: { createdAt: "asc" },
    select: { activityId: true, monthlyPrice: true, activity: { select: { status: true, accepterId: true, accepter: { select: personSelect } } } },
  },
} as const satisfies Prisma.CarpoolPostSelect;

type PostRow = Prisma.CarpoolPostGetPayload<{ select: typeof postFeedSelect }>;

const bookingFeedSelect = {
  id: true,
  status: true,
  subStatus: true,
  startTime: true,
  creatorId: true,
  creator: { select: personSelect },
  chat: { select: { id: true } },
  carpoolBooking: {
    select: {
      postId: true,
      durationMonths: true,
      monthlyPrice: true,
      startDate: true,
      holdExpiresAt: true,
      riderAgreedAt: true,
      passengerAgreedAt: true,
      contract: { select: { endDate: true } },
      post: {
        select: {
          daysOfWeek: true,
          departureMinute: true,
          pausedAt: true,
          pickupAddress: true,
          pickupLat: true,
          pickupLng: true,
          destinationAddress: true,
          destinationLat: true,
          destinationLng: true,
        },
      },
    },
  },
} as const satisfies Prisma.ActivitySelect;

type BookingRow = Prisma.ActivityGetPayload<{ select: typeof bookingFeedSelect }>;

// A post is Active while it is not CLOSED or a booking on it has not
// finished; it is never Ongoing (carpool items are never IN_PROGRESS, B6a
// Q12); History otherwise.
export function postTab(post: { status: string; bookings: { activity: { status: ActivityStatus } }[] }): FeedTab {
  const unfinished = post.bookings.some((b) => UNFINISHED.includes(b.activity.status));
  return post.status !== "CLOSED" || unfinished ? "active" : "history";
}

const empty = { durationMonths: null, startDate: null, endDate: null, holdExpiresAt: null, agreed: null } as const;

async function postItems(userId: string, rows: PostRow[], now: Date): Promise<FeedItem[]> {
  const phones = await participantPhones(
    userId,
    rows.flatMap((post) => post.bookings.map((b) => ({ otherId: b.activity.accepterId, status: b.activity.status }))),
  );
  let i = 0;
  return Promise.all(
    rows.map(async (post) => {
      const bookings = await Promise.all(
        post.bookings.map(async (b) => ({
          activityId: b.activityId,
          status: b.activity.status,
          seatsBooked: 1,
          amount: Number(b.monthlyPrice),
          passenger: b.activity.accepter ? await miniProfile(b.activity.accepter) : null,
          phone: phones[i++] ?? null,
        })),
      );
      const next = post.status === "CLOSED" ? null : nextRideTime(scheduleOf(post), now);
      return {
        feature: "CARPOOL" as const,
        kind: "CARPOOL_POST" as const,
        id: post.id,
        role: "REQUESTED" as const,
        status: post.status,
        subStatus: null,
        completionRequestedBy: null,
        time: next ?? post.closedAt ?? post.createdAt,
        pickup: place(post.pickupAddress, post.pickupLat, post.pickupLng),
        destination: place(post.destinationAddress, post.destinationLat, post.destinationLng),
        amount: Number(post.prices[0]?.monthlyPrice ?? 0),
        seats: post.seatsAvailable,
        otherPerson: null,
        phone: null,
        chatId: null,
        payment: null,
        review: null,
        bookings: bookings.filter((b) => b.status !== "OPEN"),
        activeBookings: bookings.filter((b) => RUNNING.includes(b.status)).length,
        food: null,
        carpool: {
          postId: post.id,
          bookingId: null,
          daysOfWeek: post.daysOfWeek,
          departureMinute: post.departureMinute,
          paused: post.pausedAt !== null,
          pendingRequests: bookings.filter((b) => b.status === "OPEN").length,
          ...empty,
        },
      };
    }),
  );
}

async function bookingItems(userId: string, rows: BookingRow[]): Promise<FeedItem[]> {
  const phones = await participantPhones(
    userId,
    rows.map((row) => ({ otherId: row.creatorId, status: row.status })),
  );
  return Promise.all(
    rows.map(async (row, i): Promise<FeedItem> => {
      const b = row.carpoolBooking!;
      const start = dateOnlyString(b.startDate);
      return {
        feature: "CARPOOL",
        kind: "CARPOOL_BOOKING",
        id: row.id,
        role: "ACCEPTED",
        status: row.status,
        subStatus: row.subStatus,
        completionRequestedBy: null,
        time: row.startTime,
        pickup: place(b.post.pickupAddress, b.post.pickupLat, b.post.pickupLng),
        destination: place(b.post.destinationAddress, b.post.destinationLat, b.post.destinationLng),
        amount: Number(b.monthlyPrice),
        seats: 1,
        otherPerson: await miniProfile(row.creator),
        phone: phones[i] ?? null,
        chatId: row.chat?.id ?? null,
        payment: null,
        review: null,
        bookings: [],
        activeBookings: 0,
        food: null,
        carpool: {
          postId: b.postId,
          bookingId: row.id,
          daysOfWeek: b.post.daysOfWeek,
          departureMinute: b.post.departureMinute,
          paused: b.post.pausedAt !== null,
          pendingRequests: 0,
          durationMonths: b.durationMonths,
          startDate: start,
          endDate: b.contract ? dateOnlyString(b.contract.endDate) : contractEndDate(start, b.durationMonths),
          holdExpiresAt: row.status === "ACCEPTED" && row.subStatus === null ? b.holdExpiresAt : null,
          agreed: { me: b.passengerAgreedAt !== null, other: b.riderAgreedAt !== null },
        },
      };
    }),
  );
}

// Activity (12.2): a rider's posts with their bookings inside (Requested),
// a passenger's requests, held seats and contracts (Accepted).
export async function carpoolActivity(userId: string, tab: FeedTab, role: FeedRole, now = new Date()) {
  const newestFirst = tab === "history";
  const bookings =
    role === "requested"
      ? []
      : await prisma.activity.findMany({
          where: { type: "CARPOOL_BOOKING", accepterId: userId, status: { in: [...TAB_STATUSES[tab]] } },
          orderBy: [{ startTime: newestFirst ? "desc" : "asc" }, { id: "asc" }],
          take: CANDIDATES,
          select: bookingFeedSelect,
        });
  const posts =
    role === "accepted" || tab === "ongoing"
      ? []
      : (
          await prisma.carpoolPost.findMany({
            where: { riderId: userId },
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: CANDIDATES,
            select: postFeedSelect,
          })
        ).filter((post) => postTab(post) === tab);
  return [...(await bookingItems(userId, bookings)), ...(await postItems(userId, posts, now))];
}

const sessionSelect = {
  id: true,
  status: true,
  startTime: true,
  creatorId: true,
  accepterId: true,
  conflictGroupId: true,
  creator: { select: personSelect },
  accepter: { select: personSelect },
  carpoolSession: {
    select: {
      contract: {
        select: {
          booking: {
            select: {
              activityId: true,
              monthlyPrice: true,
              activity: { select: { chat: { select: { id: true } } } },
              post: {
                select: {
                  id: true,
                  daysOfWeek: true,
                  departureMinute: true,
                  pausedAt: true,
                  pickupAddress: true,
                  pickupLat: true,
                  pickupLng: true,
                  destinationAddress: true,
                  destinationLat: true,
                  destinationLng: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.ActivitySelect;

type SessionRow = Prisma.ActivityGetPayload<{ select: typeof sessionSelect }>;

// Upcoming (12.3): ACCEPTED carpool sessions in the next 7 days, nearest
// first. A passenger sees each of their sessions; a rider one card per post
// and ride time, with that ride's passengers.
export async function carpoolUpcoming(userId: string, role: FeedRole, now = new Date()) {
  const window = { gt: now, lte: new Date(now.getTime() + rules.carpool.upcomingSessionsWindow) };
  const where = role === "requested" ? { creatorId: userId } : role === "accepted" ? { accepterId: userId } : { OR: [{ creatorId: userId }, { accepterId: userId }] };
  const rows = await prisma.activity.findMany({
    where: { type: "CARPOOL_SESSION", status: "ACCEPTED", deletedAt: null, startTime: window, ...where },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: sessionSelect,
  });
  const phones = await participantPhones(
    userId,
    rows.map((row) => ({ otherId: row.creatorId === userId ? row.accepterId : row.creatorId, status: row.status })),
  );

  const items: FeedItem[] = [];
  const riderCards = new Map<string, FeedItem>();
  for (const [i, row] of rows.entries()) {
    const booking = row.carpoolSession!.contract.booking;
    const post = booking.post;
    const isRider = row.creatorId === userId;
    const base = {
      feature: "CARPOOL" as const,
      kind: "CARPOOL_SESSION" as const,
      status: row.status,
      subStatus: null,
      completionRequestedBy: null,
      time: row.startTime,
      pickup: place(post.pickupAddress, post.pickupLat, post.pickupLng),
      destination: place(post.destinationAddress, post.destinationLat, post.destinationLng),
      amount: Number(booking.monthlyPrice),
      payment: null,
      review: null,
      food: null,
    };
    const details = {
      postId: post.id,
      daysOfWeek: post.daysOfWeek,
      departureMinute: post.departureMinute,
      paused: post.pausedAt !== null,
      pendingRequests: 0,
      ...empty,
    };
    if (isRider) {
      const key = `${post.id}:${row.startTime.getTime()}`;
      let card = riderCards.get(key);
      if (!card) {
        card = { ...base, id: row.id, role: "REQUESTED", seats: 0, otherPerson: null, phone: null, chatId: null, bookings: [], activeBookings: 0, carpool: { ...details, bookingId: null } };
        riderCards.set(key, card);
        items.push(card);
      }
      card.bookings.push({
        activityId: booking.activityId,
        status: row.status,
        seatsBooked: 1,
        amount: Number(booking.monthlyPrice),
        passenger: row.accepter ? await miniProfile(row.accepter) : null,
        phone: phones[i] ?? null,
      });
      card.activeBookings = card.bookings.length;
      card.seats = card.bookings.length;
      continue;
    }
    items.push({
      ...base,
      id: row.id,
      role: "ACCEPTED",
      seats: 1,
      otherPerson: await miniProfile(row.creator),
      phone: phones[i] ?? null,
      chatId: booking.activity.chat?.id ?? null,
      bookings: [],
      activeBookings: 0,
      carpool: { ...details, bookingId: booking.activityId },
    });
  }
  return items;
}

export type { SessionRow };
