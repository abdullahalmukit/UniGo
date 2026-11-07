import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { runActivitySweep } from "../../src/jobs/activity-timers.job.js";
import { acceptCarpoolBooking, agreeCarpoolBooking, createCarpoolPost, requestCarpoolBooking } from "../../src/modules/carpool/carpool.service.js";
import {
  runCarpoolContractEndJob,
  runCarpoolHoldReleaseJob,
  runCarpoolSessionTimersJob,
} from "../../src/modules/carpool/carpool.jobs.js";
import { contractEndDate, sessionDates, sessionStart } from "../../src/modules/carpool/carpool-dates.js";
import { userStats } from "../../src/modules/users/stats.service.js";
import { dhakaWallTime } from "../../src/utils/time.js";
import { createActivity, HOUR, outcomeCode, verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";
import { activeRider, postRequest, requestBody, subArea } from "./ride-helpers.js";
import { foodBody, postFood } from "./food-helpers.js";
import {
  acceptSeat,
  agree,
  contracted,
  getBooking,
  getPost,
  heldSeat,
  inDays,
  postBody,
  rejectSeat,
  requested,
  requestSeat,
  riderWithPost,
  today,
} from "./carpool-helpers.js";
import { channelsOf, settle, subscribeDevice } from "./notification-helpers.js";

const DAY = 24 * HOUR;
const cancel = (token: string, id: string) => api().post(`/api/activities/${id}/cancel`).set(bearer(token)).send({ reason: "Plans changed" });

describe("booking requests (B6a)", () => {
  it("asks for one seat with a duration and start date; the rider is notified", async () => {
    const { rider, post } = await riderWithPost();
    await subscribeDevice(rider.id);
    const { passenger, id } = await requested(post.id, { durationMonths: 2, startDate: inDays(3) });
    const booking = (await getBooking(passenger.accessToken, id)).body.booking;
    expect(booking).toMatchObject({
      status: "OPEN",
      durationMonths: 2,
      monthlyPrice: 1900,
      startDate: inDays(3),
      endDate: contractEndDate(inDays(3), 2),
      role: "PASSENGER",
      phone: null,
    });
    // The request takes no seat yet; it expires at its first ride if unanswered
    expect((await getPost(rider.accessToken, post.id)).body.post.seatsAvailable).toBe(2);
    expect([...scheduledJobs.values()].some((job) => job.name === "activity-expire" && job.data.id === id)).toBe(true);
    await settle();
    expect(await channelsOf(rider.id, "CARPOOL_BOOKING_REQUESTED")).toEqual(["IN_APP", "PUSH"]);
  });

  it("checks the post, the dates and the people", async () => {
    const { rider, post } = await riderWithPost({ daysOfWeek: 1 << 2 | 1 << 4, validUntil: inDays(45) });
    const passenger = await verifiedUser();
    const ask = (body: Record<string, unknown>) => requestSeat(passenger.accessToken, post.id, body);
    const nextRideDay = [...Array(14).keys()].map((i) => inDays(i + 1)).find((d) => [2, 4].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))!;
    const otherDay = [...Array(14).keys()].map((i) => inDays(i + 1)).find((d) => ![2, 4].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))!;

    expect((await requestSeat(rider.accessToken, post.id, { startDate: nextRideDay })).body.error.code).toBe("OWN_ITEM");
    expect((await ask({ startDate: today() })).body.error.code).toBe("START_DATE_TOO_SOON");
    expect((await ask({ startDate: otherDay })).body.error.code).toBe("START_DATE_NOT_A_RIDE_DAY");
    expect((await ask({ startDate: inDays(50) })).body.error.code).toBe("START_DATE_OUTSIDE_POST");
    expect((await ask({ startDate: nextRideDay, durationMonths: 2 })).body.error.code).toBe("CONTRACT_PAST_POST_END");
    expect((await ask({ startDate: nextRideDay, durationMonths: 5 })).status).toBe(400);
    expect((await ask({ startDate: nextRideDay })).status).toBe(201);
    expect((await ask({ startDate: nextRideDay })).body.error.code).toBe("ALREADY_BOOKED");

    const blocked = await verifiedUser();
    await prisma.block.create({ data: { blockerId: rider.id, blockedId: blocked.id } });
    expect((await requestSeat(blocked.accessToken, post.id, { startDate: nextRideDay })).body.error.code).toBe("NOT_AVAILABLE");
  });

  it("is left out of the open and daily limits for both the rider and the passenger", async () => {
    const { rider, post } = await riderWithPost();
    const area = await subArea();
    // A passenger with 4 carpool requests today (on 4 posts) can still create a food request
    const passenger = await verifiedUser();
    for (let i = 0; i < 4; i += 1) {
      const { post: other } = await riderWithPost();
      expect((await requestSeat(passenger.accessToken, other.id)).status).toBe(201);
    }
    expect((await postFood(passenger.accessToken, foodBody(area.id))).status).toBe(201);
    // The rider receives 3 pending requests and can still create 3 ride requests
    for (let i = 0; i < 3; i += 1) await requested(post.id);
    for (let i = 0; i < 3; i += 1) expect((await postRequest(rider.accessToken, requestBody(area.id))).status).toBe(201);
  });

  it("can be withdrawn by the passenger and declined by the rider with a reason", async () => {
    const { rider, post } = await riderWithPost();
    const first = await requested(post.id);
    const withdrawn = await api().post(`/api/carpool/bookings/${first.id}/withdraw`).set(bearer(first.passenger.accessToken));
    expect(withdrawn.body.booking.status).toBe("CANCELLED");

    const second = await requested(post.id);
    await subscribeDevice(second.passenger.id);
    const rejected = await rejectSeat(rider.accessToken, second.id, "Seat is for my classmate");
    expect(rejected.body.booking).toMatchObject({ status: "CANCELLED", closureReason: "BOOKING_REJECTED", rejectionReason: "Seat is for my classmate" });
    await settle();
    expect(await channelsOf(second.passenger.id, "CARPOOL_BOOKING_REJECTED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
  });
});

describe("the rider accepts: the seat is held (B6a)", () => {
  it("holds one seat, opens the chat and tells the passenger", async () => {
    const { rider, post } = await riderWithPost();
    const { passenger, id } = await requested(post.id);
    await subscribeDevice(passenger.id);
    const accepted = await acceptSeat(rider.accessToken, id);
    expect(accepted.status).toBe(200);
    const booking = accepted.body.booking;
    expect(booking).toMatchObject({ status: "ACCEPTED", subStatus: null, agreed: { me: false, other: false } });
    expect(booking.chatId).toEqual(expect.any(String));
    expect(booking.phone).toEqual(expect.any(String));
    // Start date is 3 days ahead, so the hold is 24 hours
    const hold = new Date(booking.holdExpiresAt).getTime() - Date.now();
    expect(hold).toBeGreaterThan(23.9 * HOUR);
    expect(hold).toBeLessThanOrEqual(24 * HOUR);
    expect((await getPost(rider.accessToken, post.id)).body.post.seatsAvailable).toBe(1);
    expect([...scheduledJobs.values()].some((job) => job.name === "carpool-hold-release" && job.data.id === id)).toBe(true);
    await settle();
    expect(await channelsOf(passenger.id, "CARPOOL_BOOKING_ACCEPTED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
  });

  it("FULL when every seat is held; a released hold reopens only that seat", async () => {
    const { rider, post } = await riderWithPost();
    const a = await requested(post.id);
    const b = await requested(post.id);
    await acceptSeat(rider.accessToken, a.id);
    await acceptSeat(rider.accessToken, b.id);
    expect((await getPost(rider.accessToken, post.id)).body.post).toMatchObject({ status: "FULL", seatsAvailable: 0 });
    // New requests on a FULL post are refused; pending ones stay
    const late = await verifiedUser();
    expect((await requestSeat(late.accessToken, post.id)).body.error.code).toBe("POST_FULL");

    expect((await cancel(a.passenger.accessToken, a.id)).status).toBe(200);
    expect((await getPost(rider.accessToken, post.id)).body.post).toMatchObject({ status: "OPEN", seatsAvailable: 1 });
  });

  it("two requests racing for the last seat: only one is accepted", async () => {
    const { rider, post } = await riderWithPost({ seats: 1 });
    const a = await requested(post.id);
    const b = await requested(post.id);
    const results = await Promise.all([acceptSeat(rider.accessToken, a.id), acceptSeat(rider.accessToken, b.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe("ALREADY_TAKEN");
    const stored = await prisma.carpoolPost.findUniqueOrThrow({ where: { id: post.id } });
    expect([stored.status, stored.seatsAvailable]).toEqual(["FULL", 0]);
    expect(await prisma.activity.count({ where: { type: "CARPOOL_BOOKING", status: "ACCEPTED" } })).toBe(1);
  });

  it("refuses a clash on any ride day and names the dates; nothing is held", async () => {
    const { rider, post } = await riderWithPost();
    const { passenger, id } = await requested(post.id, { startDate: inDays(3) });
    // The passenger already has an accepted activity 30 minutes after the 5th ride
    const clash = new Date(sessionStart(inDays(7), 8 * 60).getTime() + 30 * 60 * 1000);
    await createActivity({ type: "FOOD", creatorId: passenger.id, accepterId: (await verifiedUser()).id, status: "ACCEPTED", startTime: clash });
    const response = await acceptSeat(rider.accessToken, id);
    expect([response.status, response.body.error.code]).toEqual([409, "TIME_CONFLICT"]);
    expect(response.body.error.dates).toEqual([inDays(7)]);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
    expect((await prisma.carpoolPost.findUniqueOrThrow({ where: { id: post.id } })).seatsAvailable).toBe(2);
  });
});

describe("seat hold release (B6a Q1)", () => {
  // Service calls with a chosen clock: 20:00 in Dhaka today
  async function holdAt(now: Date, startDate: string) {
    const rider = await activeRider();
    const post = await createCarpoolPost(rider.id, postBody(rider.vehicle.id) as never, now);
    const passenger = await verifiedUser();
    const booking = await requestCarpoolBooking(passenger.id, post.id, { durationMonths: 1, startDate }, now);
    const held = await acceptCarpoolBooking(rider.id, booking.activityId, now);
    return { rider, passenger, post, id: booking.activityId, held };
  }

  it("ends 24 hours after acceptance; the job is idempotent and the seat returns", async () => {
    const now = dhakaWallTime(today(), 6, 0);
    const { id, post, held } = await holdAt(now, inDays(3));
    expect(new Date(held.holdExpiresAt!).getTime()).toBe(now.getTime() + DAY);
    expect(await runCarpoolHoldReleaseJob(id, new Date(now.getTime() + 23 * HOUR))).toBe(false);
    expect(await runCarpoolHoldReleaseJob(id, new Date(now.getTime() + DAY))).toBe(true);
    expect(await runCarpoolHoldReleaseJob(id, new Date(now.getTime() + DAY + HOUR))).toBe(false);
    const activity = await prisma.activity.findUniqueOrThrow({ where: { id } });
    expect([activity.status, activity.closureReason]).toEqual(["CANCELLED", "SEAT_HOLD_EXPIRED"]);
    expect((await prisma.carpoolPost.findUniqueOrThrow({ where: { id: post.id } })).seatsAvailable).toBe(2);
  });

  it("ends at the first ride when that is sooner; the sweeper releases it if the job was lost", async () => {
    const now = dhakaWallTime(today(), 20, 0);
    const { id, held } = await holdAt(now, inDays(1));
    // The first ride is tomorrow at 08:00, 12 hours away
    expect(new Date(held.holdExpiresAt!).toISOString()).toBe(sessionStart(inDays(1), 8 * 60).toISOString());
    scheduledJobs.clear();
    await runActivitySweep(new Date(now.getTime() + 13 * HOUR));
    expect((await prisma.activity.findUniqueOrThrow({ where: { id } })).closureReason).toBe("SEAT_HOLD_EXPIRED");
  });

  it("refuses Agree once the hold has ended", async () => {
    const now = dhakaWallTime(today(), 6, 0);
    const { rider, id } = await holdAt(now, inDays(3));
    expect(await outcomeCode(agreeCarpoolBooking(rider.id, id, new Date(now.getTime() + DAY + 1)))).toBe("HOLD_EXPIRED");
  });
});

describe("both must Agree: the contract (B6a)", () => {
  it("the first Agree waits and tells the other person; the second makes the contract", async () => {
    const { rider, passenger, id } = await heldSeat();
    await subscribeDevice(passenger.id);
    await subscribeDevice(rider.id);
    const first = await agree(rider.accessToken, id);
    expect(first.body.booking).toMatchObject({ status: "ACCEPTED", subStatus: null, agreed: { me: true, other: false }, contract: null });
    expect((await agree(rider.accessToken, id)).body.error.code).toBe("ALREADY_AGREED");
    await settle();
    expect(await channelsOf(passenger.id, "CARPOOL_AGREE_REQUESTED")).toEqual(["IN_APP", "PUSH"]);
    expect(await channelsOf(rider.id, "CARPOOL_AGREE_REQUESTED")).toEqual([]);

    const second = await agree(passenger.accessToken, id);
    expect(second.body.booking).toMatchObject({ status: "ACCEPTED", subStatus: "CONTRACT_ACTIVE", agreed: { me: true, other: true }, holdExpiresAt: null });
    expect(second.body.booking.contract).toMatchObject({ startDate: inDays(3), endDate: contractEndDate(inDays(3), 1), status: "ACTIVE" });
    expect(second.body.booking.sessions).toHaveLength(sessionDates(inDays(3), contractEndDate(inDays(3), 1), 127).length);
    await settle();
    expect(await channelsOf(passenger.id, "CARPOOL_CONTRACT_CREATED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
    expect(await channelsOf(rider.id, "CARPOOL_CONTRACT_CREATED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);

    const chat = await prisma.chat.findUniqueOrThrow({ where: { activityId: id } });
    const codes = (await prisma.message.findMany({ where: { chatId: chat.id }, orderBy: { createdAt: "asc" } })).map((m) => m.systemCode);
    expect(codes).toEqual(["ACCEPTED", "CONTRACT_AGREED", "CONTRACT_ACTIVE"]);
  });

  it("makes a session for every ride day, for each duration, on one post without clashing between passengers", async () => {
    const days = (1 << 0) | (1 << 2) | (1 << 4);
    const start = [...Array(14).keys()].map((i) => inDays(i + 1)).find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 2)!;
    const { rider, post } = await riderWithPost({ daysOfWeek: days, seats: 4 });
    for (const months of [1, 2, 3, 4]) {
      const { passenger, id } = await requested(post.id, { durationMonths: months, startDate: start });
      expect((await acceptSeat(rider.accessToken, id)).status).toBe(200);
      await agree(rider.accessToken, id);
      const done = await agree(passenger.accessToken, id);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const expected = sessionDates(start, contractEndDate(start, months), days);
      const sessions = await prisma.carpoolSession.findMany({ where: { contract: { booking: { activityId: id } } }, orderBy: { sessionDate: "asc" } });
      expect(sessions.map((s) => s.sessionDate.toISOString().slice(0, 10))).toEqual(expected);
      const activities = await prisma.activity.findMany({ where: { id: { in: sessions.map((s) => s.activityId) } } });
      expect(activities.every((a) => a.status === "ACCEPTED" && a.creatorId === rider.id && a.accepterId === passenger.id && a.conflictGroupId === post.id)).toBe(true);
    }
    expect((await getPost(rider.accessToken, post.id)).body.post).toMatchObject({ status: "FULL", seatsAvailable: 0 });
  });

  it("checks every ride day again at Agree and lists the clashing dates", async () => {
    const { rider, passenger, id } = await heldSeat();
    // Meanwhile the rider accepted something 60 minutes before two of the rides
    const other = await verifiedUser();
    for (const day of [5, 9]) {
      await createActivity({ type: "FOOD", creatorId: other.id, accepterId: rider.id, status: "ACCEPTED", startTime: new Date(sessionStart(inDays(day), 8 * 60).getTime() - HOUR) });
    }
    await agree(passenger.accessToken, id);
    const response = await agree(rider.accessToken, id);
    expect([response.status, response.body.error.code, response.body.error.dates]).toEqual([409, "TIME_CONFLICT", [inDays(5), inDays(9)]]);
    const stored = await prisma.activity.findUniqueOrThrow({ where: { id } });
    expect([stored.status, stored.subStatus]).toEqual(["ACCEPTED", null]);
    expect(await prisma.carpoolContract.count()).toBe(0);
    expect(await prisma.activity.count({ where: { type: "CARPOOL_SESSION" } })).toBe(0);
  });
});

describe("contract sessions: timers, Upcoming, Activity and the end (B6a)", () => {
  it("queues session timers only for the next 7 days; the daily job adds the following days once", async () => {
    const { id } = await contracted();
    const sessions = await prisma.activity.findMany({ where: { type: "CARPOOL_SESSION" }, orderBy: { startTime: "asc" } });
    const timerIds = () => new Set([...scheduledJobs.values()].filter((j) => j.name === "activity-not-marked").map((j) => j.data.id));
    const within = (now: Date) => sessions.filter((s) => s.startTime > now && s.startTime.getTime() <= now.getTime() + 7 * DAY).map((s) => s.id);
    const now = new Date();
    expect([...timerIds()].sort()).toEqual(within(now).sort());
    expect([...scheduledJobs.values()].filter((j) => j.name === "carpool-session-reminder").length).toBe(within(now).length);

    const later = new Date(now.getTime() + 5 * DAY);
    await runCarpoolSessionTimersJob(later);
    const after = timerIds();
    for (const sessionId of within(later)) expect(after.has(sessionId)).toBe(true);
    const size = scheduledJobs.size;
    await runCarpoolSessionTimersJob(later);
    expect(scheduledJobs.size).toBe(size);
    expect(id).toEqual(expect.any(String));
  });

  it("shows sessions of the next 7 days in Upcoming, and posts and contracts in Activity", async () => {
    const { rider, passenger, post, id } = await contracted();
    const upcoming = (token: string) => api().get("/api/upcoming").query({ feature: "carpool" }).set(bearer(token));
    const mine = (await upcoming(passenger.accessToken)).body.items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((item: { kind: string; time: string }) => item.kind === "CARPOOL_SESSION" && new Date(item.time).getTime() <= Date.now() + 7 * DAY)).toBe(true);
    expect(mine[0].carpool.bookingId).toBe(id);

    const riderCards = (await upcoming(rider.accessToken)).body.items;
    expect(riderCards[0]).toMatchObject({ kind: "CARPOOL_SESSION", role: "REQUESTED", carpool: { postId: post.id } });
    expect(riderCards[0].bookings).toHaveLength(1);

    const activity = (token: string, role: string) => api().get("/api/activity").query({ feature: "carpool", role }).set(bearer(token));
    const riderItems = (await activity(rider.accessToken, "requested")).body.items;
    expect(riderItems).toHaveLength(1);
    expect(riderItems[0]).toMatchObject({ kind: "CARPOOL_POST", id: post.id, activeBookings: 1 });
    const passengerItems = (await activity(passenger.accessToken, "accepted")).body.items;
    expect(passengerItems[0]).toMatchObject({ kind: "CARPOOL_BOOKING", id, subStatus: "CONTRACT_ACTIVE" });
  });

  it("ends the contract after its last day and reopens only that seat; idempotent", async () => {
    const { rider, post, id } = await contracted();
    const contract = await prisma.carpoolContract.findFirstOrThrow({ where: { booking: { activityId: id } } });
    const early = new Date(contract.endDate.getTime() - DAY);
    expect(await runCarpoolContractEndJob(contract.id, early)).toBe(false);
    const after = new Date(contract.endDate.getTime() + 2 * DAY);
    expect(await runCarpoolContractEndJob(contract.id, after)).toBe(true);
    expect(await runCarpoolContractEndJob(contract.id, after)).toBe(false);
    expect((await prisma.carpoolContract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("ENDED");
    expect((await prisma.activity.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
    expect((await getPost(rider.accessToken, post.id)).body.post).toMatchObject({ status: "OPEN", seatsAvailable: 2 });
  });

  it("profile stats count carpool sessions, never the booking or contract", async () => {
    const { rider, passenger, id } = await contracted();
    const contract = await prisma.carpoolContract.findFirstOrThrow({ where: { booking: { activityId: id } } });
    await runCarpoolContractEndJob(contract.id, new Date(contract.endDate.getTime() + 2 * DAY));
    // The booking is COMPLETED and was accepted, yet nothing counts
    expect((await userStats(passenger.id)).completed).toBe(0);
    const session = await prisma.activity.findFirstOrThrow({ where: { type: "CARPOOL_SESSION", accepterId: passenger.id } });
    await prisma.activity.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    expect((await userStats(passenger.id)).completed).toBe(1);
    expect((await userStats(rider.id)).completed).toBe(1);
  });
});
