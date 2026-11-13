import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { participantPhones } from "../users/contact.js";
import { CANDIDATES, extras, requestWhere, TAB_STATUSES, type FeedItem, type FeedRole, type FeedTab } from "../ride/ride.feed.js";
import { completionBy, miniProfile, personSelect } from "../ride/ride.views.js";

const place = (address: string, lat: Prisma.Decimal, lng: Prisma.Decimal) => ({ address, lat: Number(lat), lng: Number(lng) });

const serviceFeedSelect = {
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
  serviceRequest: {
    select: {
      serviceTitle: true,
      taskTitle: true,
      destinationAddress: true,
      destinationLat: true,
      destinationLng: true,
      pickupAddress: true,
      pickupLat: true,
      pickupLng: true,
      offeredAmount: true,
      estimatedBudget: true,
    },
  },
} as const satisfies Prisma.ActivitySelect;

type Row = Prisma.ActivityGetPayload<{ select: typeof serviceFeedSelect }>;

async function items(userId: string, rows: Row[], now = new Date()): Promise<FeedItem[]> {
  const phones = await participantPhones(
    userId,
    rows.map((r) => ({ otherId: r.creatorId === userId ? r.accepterId : r.creatorId, status: r.status })),
  );
  return Promise.all(
    rows.map(async (row, i): Promise<FeedItem> => {
      const s = row.serviceRequest!;
      const mine = row.creatorId === userId;
      const other = mine ? row.accepter : row.creator;
      const budget = Number(s.estimatedBudget ?? 0);
      const amount = Number(s.offeredAmount) + budget;
      const pickupPlace = s.pickupAddress
        ? place(s.pickupAddress, s.pickupLat ?? new Prisma.Decimal(0), s.pickupLng ?? new Prisma.Decimal(0))
        : place("Campus", new Prisma.Decimal(23.73), new Prisma.Decimal(90.39));

      return {
        feature: "SERVICE",
        kind: "SERVICE",
        id: row.id,
        role: mine ? "REQUESTED" : "ACCEPTED",
        status: row.status,
        subStatus: row.subStatus,
        completionRequestedBy: completionBy(row.completionRequestedById, userId),
        time: row.startTime,
        pickup: pickupPlace,
        destination: place(s.destinationAddress, s.destinationLat, s.destinationLng),
        amount,
        seats: null,
        otherPerson: other ? await miniProfile(other) : null,
        phone: phones[i],
        chatId: row.chat?.id ?? null,
        ...extras(row, userId, now),
        bookings: [],
        activeBookings: 0,
        food: null,
      };
    }),
  );
}

export async function serviceActivity(userId: string, tab: FeedTab, role: FeedRole, now = new Date()) {
  const statuses = TAB_STATUSES[tab];
  const rows = await prisma.activity.findMany({
    where: {
      type: "SERVICE",
      ...requestWhere(userId, role),
      status: { in: [...statuses] },
      deletedAt: null,
    },
    orderBy: [{ startTime: tab === "history" ? "desc" : "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: serviceFeedSelect,
  });
  return items(userId, rows, now);
}

export async function serviceUpcoming(userId: string, role: FeedRole, now = new Date()) {
  const rows = await prisma.activity.findMany({
    where: {
      type: "SERVICE",
      ...requestWhere(userId, role),
      status: "ACCEPTED",
      deletedAt: null,
      startTime: { gt: now },
    },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: serviceFeedSelect,
  });
  return items(userId, rows, now);
}
