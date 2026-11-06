import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { assertCreationLimits } from "../../src/modules/activities/limits.js";
import { runActivityTransaction } from "../../src/modules/activities/transaction.js";
import { createActivity, createRideOffer, fromNow, HOUR, outcomeCode, verifiedUser } from "./activity-helpers.js";

const check = (userId: string, now?: Date) => outcomeCode(runActivityTransaction((tx) => assertCreationLimits(tx, userId, now)));

describe("open limit (max 3 OPEN items)", () => {
  it("counts OPEN requests and OPEN ride offers", async () => {
    const user = await verifiedUser();
    await createActivity({ type: "RIDE_REQUEST", creatorId: user.id, createdAt: fromNow(-48 * HOUR) });
    await createActivity({ type: "FOOD", creatorId: user.id, createdAt: fromNow(-48 * HOUR) });
    expect(await check(user.id)).toBe("OK");

    await createRideOffer(user.id, { createdAt: fromNow(-48 * HOUR) });
    expect(await check(user.id)).toBe("OPEN_LIMIT_REACHED");
  });

  it("does not count deleted items, FULL offers, carpool bookings or accepted items", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const old = fromNow(-48 * HOUR);
    await createActivity({ creatorId: user.id, status: "CANCELLED", deletedAt: old, createdAt: old });
    await createActivity({ creatorId: user.id, status: "ACCEPTED", accepterId: other.id, createdAt: old });
    await createActivity({ type: "CARPOOL_BOOKING", creatorId: user.id, accepterId: other.id, blocksTime: false, createdAt: old });
    await createRideOffer(user.id, { status: "FULL", seatsAvailable: 0, createdAt: old });
    await createActivity({ creatorId: user.id, createdAt: old });
    await createActivity({ creatorId: user.id, createdAt: old });

    expect(await check(user.id)).toBe("OK");
  });

  it("lets only one of two creations sent together pass at the limit", async () => {
    const user = await verifiedUser();
    const old = fromNow(-48 * HOUR);
    await createActivity({ creatorId: user.id, createdAt: old });
    await createActivity({ creatorId: user.id, createdAt: old });

    const create = () =>
      outcomeCode(
        runActivityTransaction(async (tx) => {
          await assertCreationLimits(tx, user.id);
          await tx.activity.create({ data: { type: "FOOD", creatorId: user.id, startTime: fromNow(2 * HOUR) } });
        }),
      );
    const results = await Promise.all([create(), create()]);

    expect(results.sort()).toEqual(["OK", "OPEN_LIMIT_REACHED"]);
    expect(await prisma.activity.count({ where: { creatorId: user.id, status: "OPEN" } })).toBe(3);
  });
});

describe("daily limit (max 4 new items per Dhaka day)", () => {
  it("counts deleted items and ride offers made since midnight Asia/Dhaka", async () => {
    const user = await verifiedUser();
    // 2026-11-07 12:00 in Dhaka; midnight was 2026-11-06T18:00Z
    const now = new Date("2026-11-07T06:00:00.000Z");
    const today = new Date("2026-11-06T18:00:00.000Z");
    const yesterday = new Date("2026-11-06T17:59:59.000Z");
    const start = new Date("2026-11-07T10:00:00.000Z");

    await createActivity({ creatorId: user.id, status: "CANCELLED", deletedAt: today, createdAt: today, startTime: start });
    await createActivity({ creatorId: user.id, status: "EXPIRED", createdAt: today, startTime: start });
    await createRideOffer(user.id, { status: "CLOSED", createdAt: today });
    await createActivity({ creatorId: user.id, status: "CANCELLED", deletedAt: yesterday, createdAt: yesterday, startTime: start });
    expect(await check(user.id, now)).toBe("OK");

    await createActivity({ type: "SERVICE", creatorId: user.id, status: "CANCELLED", deletedAt: today, createdAt: today, startTime: start });
    expect(await check(user.id, now)).toBe("DAILY_LIMIT_REACHED");
    // The next Dhaka day starts at 18:00 UTC
    expect(await check(user.id, new Date("2026-11-07T18:00:00.000Z"))).toBe("OK");
  });
});
