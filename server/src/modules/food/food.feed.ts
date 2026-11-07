import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { participantPhones } from "../users/contact.js";
import { CANDIDATES, extras, requestWhere, TAB_STATUSES, type FeedItem, type FeedRole, type FeedTab } from "../ride/ride.feed.js";
import { completionBy, miniProfile, personSelect } from "../ride/ride.views.js";

// Food items for Activity and Upcoming (proposal 12.2 and 12.3, B4). My
// Orders = requested by me, Accepted Orders = accepted by me (A2 decision 7).

const place = (address: string, lat: Prisma.Decimal, lng: Prisma.Decimal) => ({ address, lat: Number(lat), lng: Number(lng) });

const foodFeedSelect = {
  id: true,
  status: true,
  subStatus: true,
  startTime: true,
  completedAt: true,
  creatorId: true,
  accepterId: true,
  completionRequestedById: true,
  paymentRecord: { select: { amount: true, method: true, status: true, payeeId: true } },
  reviews: { select: { reviewerId: true } },
  creator: { select: personSelect },
  accepter: { select: personSelect },
  chat: { select: { id: true } },
  foodRequest: {
    select: {
      restaurantName: true,
      restaurantAddress: true,
      restaurantLat: true,
      restaurantLng: true,
      deliveryAddress: true,
      deliveryLat: true,
      deliveryLng: true,
      items: true,
      quantity: true,
      estimatedBudget: true,
      deliveryServiceAmount: true,
      orderFoodPrice: true,
      orderDeliveryCharge: true,
    },
  },
} as const satisfies Prisma.ActivitySelect;

type Row = Prisma.ActivityGetPayload<{ select: typeof foodFeedSelect }>;

async function items(userId: string, rows: Row[], now = new Date()): Promise<FeedItem[]> {
  const phones = await participantPhones(
    userId,
    rows.map((r) => ({ otherId: r.creatorId === userId ? r.accepterId : r.creatorId, status: r.status })),
  );
  return Promise.all(
    rows.map(async (row, i): Promise<FeedItem> => {
      const f = row.foodRequest!;
      const mine = row.creatorId === userId;
      const other = mine ? row.accepter : row.creator;
      const foodPrice = Number(f.orderFoodPrice ?? f.estimatedBudget);
      const deliveryCharge = Number(f.orderDeliveryCharge ?? f.deliveryServiceAmount ?? 0);
      // B4: after the receipt only the accepter can cancel
      const collected = row.status === "IN_PROGRESS" && row.subStatus === "FOOD_COLLECTED";
      return {
        feature: "FOOD",
        kind: "FOOD",
        id: row.id,
        role: mine ? "REQUESTED" : "ACCEPTED",
        status: row.status,
        subStatus: row.subStatus,
        completionRequestedBy: completionBy(row.completionRequestedById, userId),
        time: row.startTime,
        pickup: place(f.restaurantAddress, f.restaurantLat, f.restaurantLng),
        destination: place(f.deliveryAddress, f.deliveryLat, f.deliveryLng),
        amount: foodPrice + deliveryCharge,
        seats: null,
        otherPerson: other ? await miniProfile(other) : null,
        phone: phones[i] ?? null,
        chatId: row.chat?.id ?? null,
        ...extras(row, userId, now),
        bookings: [],
        activeBookings: 0,
        food: {
          restaurantName: f.restaurantName,
          items: f.items,
          quantity: f.quantity,
          foodPrice,
          deliveryCharge,
          cancellableByMe: (row.status === "ACCEPTED" || collected) && (!collected || row.accepterId === userId),
        },
      };
    }),
  );
}

// Activity (12.2): the user's food requests for one tab and role. Deleted
// requests are hidden (A2 decision 2).
export async function foodActivity(userId: string, tab: FeedTab, role: FeedRole) {
  const newestFirst = tab === "history";
  const rows = await prisma.activity.findMany({
    where: { type: "FOOD", deletedAt: null, status: { in: [...TAB_STATUSES[tab]] }, ...requestWhere(userId, role) },
    orderBy: [{ startTime: newestFirst ? "desc" : "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: foodFeedSelect,
  });
  return items(userId, rows);
}

// Upcoming (12.3): future ACCEPTED food requests, nearest first.
export async function foodUpcoming(userId: string, role: FeedRole, now = new Date()) {
  const rows = await prisma.activity.findMany({
    where: { type: "FOOD", deletedAt: null, status: "ACCEPTED", startTime: { gt: now }, ...requestWhere(userId, role) },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: foodFeedSelect,
  });
  return items(userId, rows, now);
}
