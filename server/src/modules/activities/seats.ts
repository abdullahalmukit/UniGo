import { AppError } from "../../utils/app-error.js";
import { dateOnly, dhakaDateString } from "../../utils/time.js";
import type { Tx } from "./transaction.js";

// Seat counts of parent posts (ride offers, carpool posts). Every change is one
// conditional UPDATE, never read-then-write (CLAUDE.md 5.7, B2a decision 6).

// Takes `seats` seats of a ride offer that is OPEN, has enough seats left and
// has not departed. The offer becomes FULL when none are left.
export async function reserveRideOfferSeats(tx: Tx, offerId: string, seats: number, now = new Date()) {
  const taken = await tx.rideOffer.updateMany({
    where: { id: offerId, status: "OPEN", seatsAvailable: { gte: seats }, departureTime: { gt: now } },
    data: { seatsAvailable: { decrement: seats } },
  });
  if (taken.count === 0) {
    // Only to choose the message; nothing is written after this read.
    const offer = await tx.rideOffer.findUnique({ where: { id: offerId }, select: { status: true, seatsAvailable: true, departureTime: true } });
    if (offer && offer.status === "OPEN" && offer.departureTime > now && offer.seatsAvailable > 0) {
      throw new AppError(409, "NOT_ENOUGH_SEATS", "Not enough seats are left", { data: { seatsAvailable: offer.seatsAvailable } });
    }
    throw new AppError(409, "ALREADY_TAKEN", "Already taken");
  }
  await tx.rideOffer.updateMany({ where: { id: offerId, status: "OPEN", seatsAvailable: 0 }, data: { status: "FULL" } });
}

// Gives seats back (a booking was cancelled). A FULL offer becomes OPEN again
// only before its departure time; a CLOSED offer never reopens (B2a decision 7).
export async function releaseRideOfferSeats(tx: Tx, offerId: string, seats: number, now = new Date()) {
  await tx.$executeRaw`
    UPDATE ride_offers SET seats_available = seats_available + ${seats}, updated_at = NOW(3)
    WHERE id = ${offerId} AND seats_available + ${seats} <= total_seats`;
  await tx.rideOffer.updateMany({
    where: { id: offerId, status: "FULL", seatsAvailable: { gt: 0 }, departureTime: { gt: now } },
    data: { status: "OPEN" },
  });
}

// Today's date in Asia/Dhaka as a DATE column value.
const today = (now: Date) => dateOnly(dhakaDateString(now));
const postStillValid = (now: Date) => ({ OR: [{ validUntil: null }, { validUntil: { gte: today(now) } }] });

// One carpool booking holds exactly one seat (proposal 9.4). Used from B6.
export async function reserveCarpoolSeat(tx: Tx, postId: string, now = new Date()) {
  const taken = await tx.carpoolPost.updateMany({
    where: { id: postId, status: "OPEN", seatsAvailable: { gte: 1 }, ...postStillValid(now) },
    data: { seatsAvailable: { decrement: 1 } },
  });
  if (taken.count === 0) throw new AppError(409, "ALREADY_TAKEN", "Already taken");
  await tx.carpoolPost.updateMany({ where: { id: postId, status: "OPEN", seatsAvailable: 0 }, data: { status: "FULL" } });
}

// A carpool post reopens only while it is still valid; CLOSED stays closed.
export async function releaseCarpoolSeat(tx: Tx, postId: string, now = new Date()) {
  await tx.$executeRaw`
    UPDATE carpool_posts SET seats_available = seats_available + 1, updated_at = NOW(3)
    WHERE id = ${postId} AND seats_available + 1 <= total_seats`;
  await tx.carpoolPost.updateMany({
    where: { id: postId, status: "FULL", seatsAvailable: { gt: 0 }, ...postStillValid(now) },
    data: { status: "OPEN" },
  });
}
