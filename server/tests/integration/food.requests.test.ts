import { describe, expect, it } from "vitest";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { prisma } from "../../src/lib/prisma.js";
import { dhakaDateString } from "../../src/utils/time.js";
import { applyAccountAction } from "../../src/modules/admin/moderation.service.js";
import { runSubAreaNotifyJob } from "../../src/modules/notifications/sub-area.service.js";
import { createActivity, fromNow, HOUR, MINUTE, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { acceptedFood, acceptFood, activityRow, foodBody, getFood, hall, openFood, paymentRow, postFood, restaurant } from "./food-helpers.js";
import { channelsOf, settle } from "./notification-helpers.js";
import { subArea } from "./ride-helpers.js";

describe("Food Delivery: creating a request (proposal 10.2)", () => {
  it("creates an OPEN request with every field and queues expiry and the sub-area notice", async () => {
    const area = await subArea();
    const requester = await verifiedUser();
    const body = foodBody(area.id);
    const response = await postFood(requester.accessToken, body);

    expect(response.status).toBe(201);
    const request = response.body.request;
    expect(request).toMatchObject({
      status: "OPEN",
      restaurantName: "Star Kabab",
      restaurant,
      delivery: hall,
      pickup: restaurant,
      quantity: 3,
      estimatedBudget: 600,
      deliveryCharge: 60,
      mine: true,
      role: "REQUESTER",
      order: null,
      receipts: [],
    });
    expect(JSON.stringify(request)).not.toContain(requester.email);
    const names = [...scheduledJobs.values()].map((job) => job.name);
    expect(names).toEqual(expect.arrayContaining(["activity-expire", "sub-area-notify"]));
    // The expected delivery time is the activity's start (7.6)
    expect((await activityRow(request.id)).startTime.toISOString()).toBe(body.expectedDeliveryTime);
  });

  it("stores no delivery charge for 0 or none", async () => {
    const area = await subArea();
    const requester = await verifiedUser();
    const none = await postFood(requester.accessToken, foodBody(area.id, { deliveryCharge: undefined }));
    const zero = await postFood(requester.accessToken, foodBody(area.id, { deliveryCharge: 0, expectedDeliveryTime: fromNow(5 * HOUR).toISOString() }));
    expect(none.body.request.deliveryCharge).toBe(0);
    expect(zero.body.request.deliveryCharge).toBe(0);
    expect((await prisma.foodRequest.findUniqueOrThrow({ where: { activityId: zero.body.request.id } })).deliveryServiceAmount).toBeNull();
  });

  it("refuses unverified and restricted users, bad times, budgets, charges and sub-areas", async () => {
    const area = await subArea();
    const unverified = await registerUser();
    const restricted = await verifiedUser();
    await prisma.user.update({ where: { id: restricted.id }, data: { accountStatus: "RESTRICTED" } });
    const user = await verifiedUser();
    const code = async (token: string, overrides: Record<string, unknown>) => (await postFood(token, foodBody(area.id, overrides))).body.error?.code;

    expect(await code(unverified.accessToken, {})).toBe("NOT_VERIFIED");
    expect(await code(restricted.accessToken, {})).toBe("ACCOUNT_RESTRICTED");
    expect(await code(user.accessToken, { expectedDeliveryTime: fromNow(10 * MINUTE).toISOString() })).toBe("START_TOO_SOON");
    expect(await code(user.accessToken, { expectedDeliveryTime: fromNow(25 * HOUR).toISOString() })).toBe("START_TOO_LATE");
    // Food budget 10-5000; delivery charge 0 or 10-1000 (rules.food)
    for (const bad of [{ estimatedBudget: 9 }, { estimatedBudget: 5001 }, { deliveryCharge: 5 }, { deliveryCharge: 1001 }, { quantity: 0 }, { quantity: 21 }, { items: "" }]) {
      expect(await code(user.accessToken, bad)).toBe("VALIDATION_ERROR");
    }
    expect((await postFood(user.accessToken, foodBody(area.id, { estimatedBudget: 5000, deliveryCharge: 1000 }))).status).toBe(201);
    expect((await postFood(user.accessToken, foodBody(area.id, { estimatedBudget: 10, deliveryCharge: 10 }))).status).toBe(201);
    await prisma.subArea.update({ where: { id: area.id }, data: { isActive: false } });
    expect(await code(user.accessToken, {})).toBe("SUB_AREA_NOT_FOUND");
  });

  it("applies the open limit (3) and the daily limit (4, deleted ones included)", async () => {
    const area = await subArea();
    const user = await verifiedUser();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await postFood(user.accessToken, foodBody(area.id, { expectedDeliveryTime: fromNow((2 + i) * HOUR).toISOString() }));
      expect(response.status).toBe(201);
      ids.push(response.body.request.id);
    }
    expect((await postFood(user.accessToken, foodBody(area.id))).body.error.code).toBe("OPEN_LIMIT_REACHED");

    // Deleting frees an open slot but still counts today
    expect((await api().delete(`/api/activities/${ids[0]}`).set(bearer(user.accessToken))).status).toBe(200);
    expect((await postFood(user.accessToken, foodBody(area.id))).status).toBe(201);
    expect((await api().delete(`/api/activities/${ids[1]}`).set(bearer(user.accessToken))).status).toBe(200);
    expect((await postFood(user.accessToken, foodBody(area.id))).body.error.code).toBe("DAILY_LIMIT_REACHED");
  });

  it("tells verified, active users who saved the sub-area, never the creator, blocked users, unverified or locked accounts", async () => {
    const area = await subArea();
    const requester = await verifiedUser();
    const saver = await verifiedUser();
    const blocker = await verifiedUser();
    const blockedByRequester = await verifiedUser();
    const unverified = await registerUser();
    const suspended = await verifiedUser();
    const otherArea = await verifiedUser();
    await prisma.user.update({ where: { id: suspended.id }, data: { accountStatus: "SUSPENDED", suspendedUntil: fromNow(48 * HOUR) } });
    await prisma.block.createMany({
      data: [
        { blockerId: blocker.id, blockedId: requester.id },
        { blockerId: requester.id, blockedId: blockedByRequester.id },
      ],
    });
    const saved = [requester, saver, blocker, blockedByRequester, unverified, suspended];
    await prisma.userSubArea.createMany({ data: saved.map((u) => ({ userId: u.id, subAreaId: area.id })) });
    await prisma.userSubArea.create({ data: { userId: otherArea.id, subAreaId: (await subArea()).id } });

    const created = await postFood(requester.accessToken, foodBody(area.id));
    await runSubAreaNotifyJob(created.body.request.id);
    await settle();
    expect(await channelsOf(saver.id, "SUB_AREA_NEW_REQUEST")).toEqual(["IN_APP", "PUSH"]);
    for (const user of [requester, blocker, blockedByRequester, unverified, suspended, otherArea]) {
      expect(await channelsOf(user.id, "SUB_AREA_NEW_REQUEST")).toEqual([]);
    }
    const list = await api().get("/api/notifications").set(bearer(saver.accessToken));
    expect(list.body.notifications[0].link).toBe(`/food/requests/${created.body.request.id}`);

    // An edit never notifies twice
    await runSubAreaNotifyJob(created.body.request.id);
    expect((await prisma.notification.count({ where: { userId: saver.id, type: "SUB_AREA_NEW_REQUEST" } }))).toBe(2);
  });
});

describe("editing, upgrading and deleting while OPEN (7.7)", () => {
  it("lets the creator edit everything and raise the delivery charge, nobody else", async () => {
    const { requester, request, area } = await openFood();
    const other = await verifiedUser();
    const later = fromNow(6 * HOUR).toISOString();

    expect((await api().patch(`/api/food/requests/${request.id}`).set(bearer(other.accessToken)).send({ items: "x" })).body.error.code).toBe("NOT_PARTICIPANT");
    const edited = await api()
      .patch(`/api/food/requests/${request.id}`)
      .set(bearer(requester.accessToken))
      .send({ items: "1 kacchi", estimatedBudget: 450, expectedDeliveryTime: later, pickup: hall });
    expect(edited.body.request).toMatchObject({ items: "1 kacchi", estimatedBudget: 450, pickup: hall, restaurant });
    expect(new Date(edited.body.request.expectedDeliveryTime).toISOString()).toBe(later);

    const lower = await api().post(`/api/food/requests/${request.id}/upgrade`).set(bearer(requester.accessToken)).send({ deliveryCharge: 50 });
    expect(lower.body.error.code).toBe("AMOUNT_NOT_HIGHER");
    const higher = await api().post(`/api/food/requests/${request.id}/upgrade`).set(bearer(requester.accessToken)).send({ deliveryCharge: 80 });
    expect(higher.body.request.deliveryCharge).toBe(80);
    expect(area.id).toBe(edited.body.request.subArea.id);
  });

  it("locks the details after acceptance and soft-deletes before it", async () => {
    const { requester, id } = await acceptedFood();
    expect((await api().patch(`/api/food/requests/${id}`).set(bearer(requester.accessToken)).send({ items: "x" })).body.error.code).toBe("NOT_EDITABLE");
    expect((await api().delete(`/api/activities/${id}`).set(bearer(requester.accessToken))).status).toBe(409);

    const open = await openFood();
    expect((await api().delete(`/api/activities/${open.request.id}`).set(bearer(open.requester.accessToken))).status).toBe(200);
    expect(await activityRow(open.request.id)).toMatchObject({ status: "CANCELLED", closureReason: "DELETED_BY_CREATOR" });
    expect((await getFood((await verifiedUser()).accessToken, open.request.id)).status).toBe(404);
  });
});

describe("accepting (proposal 10.3 step 2, CLAUDE.md 5.7)", () => {
  it("lets any verified student accept, opens the chat, shows both phones and creates the payment record", async () => {
    const { requester, request } = await openFood();
    const accepter = await verifiedUser();
    const response = await acceptFood(accepter.accessToken, request.id);
    expect(response.status).toBe(200);
    const phoneOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).phone;
    expect(response.body.request).toMatchObject({ status: "ACCEPTED", subStatus: null, role: "ACCEPTER", phone: await phoneOf(requester.id) });
    expect(response.body.request.chatId).toBeTruthy();
    expect((await getFood(requester.accessToken, request.id)).body.request.phone).toBe(await phoneOf(accepter.id));
    // Payee = accepter; food cost and delivery charge separately (16)
    expect(await paymentRow(request.id)).toMatchObject({ payeeId: accepter.id, status: "UNPAID" });
    const payment = await paymentRow(request.id);
    expect([Number(payment.foodCost), Number(payment.deliveryCharge), Number(payment.amount)]).toEqual([600, 60, 660]);
    await settle();
    expect(await channelsOf(requester.id, "REQUEST_ACCEPTED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
  });

  it("lets exactly one of two students accepting at the same moment succeed", async () => {
    const { request } = await openFood();
    const [a, b] = await Promise.all([verifiedUser(), verifiedUser()]);
    const results = await Promise.all([acceptFood(a.accessToken, request.id), acceptFood(b.accessToken, request.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe("ALREADY_TAKEN");
    expect(await prisma.paymentRecord.count({ where: { activityId: request.id } })).toBe(1);
    expect(await prisma.chat.count({ where: { activityId: request.id } })).toBe(1);
  });

  it("refuses the creator, restricted and unverified users, blocked users and time conflicts", async () => {
    const { requester, request } = await openFood();
    expect((await acceptFood(requester.accessToken, request.id)).body.error.code).toBe("OWN_ITEM");

    const restricted = await verifiedUser();
    await prisma.user.update({ where: { id: restricted.id }, data: { accountStatus: "RESTRICTED" } });
    expect((await acceptFood(restricted.accessToken, request.id)).body.error.code).toBe("ACCOUNT_RESTRICTED");
    expect((await acceptFood((await registerUser()).accessToken, request.id)).body.error.code).toBe("NOT_VERIFIED");

    const blocked = await verifiedUser();
    await prisma.block.create({ data: { blockerId: requester.id, blockedId: blocked.id } });
    expect((await acceptFood(blocked.accessToken, request.id)).body.error.code).toBe("NOT_AVAILABLE");

    // 90-minute conflict with an accepted activity of the accepter
    const busy = await verifiedUser();
    const start = (await activityRow(request.id)).startTime;
    await createActivity({ type: "SERVICE", creatorId: (await verifiedUser()).id, accepterId: busy.id, status: "ACCEPTED", startTime: new Date(start.getTime() + 60 * MINUTE) });
    expect((await acceptFood(busy.accessToken, request.id)).body.error.code).toBe("TIME_CONFLICT");
    expect((await activityRow(request.id)).status).toBe("OPEN");
  });

  it("hides other students' accepted requests and blocked creators", async () => {
    const { requester, id } = await acceptedFood();
    const stranger = await verifiedUser();
    expect((await getFood(stranger.accessToken, id)).status).toBe(404);
    const open = await openFood();
    await prisma.block.create({ data: { blockerId: stranger.id, blockedId: open.requester.id } });
    expect((await getFood(stranger.accessToken, open.request.id)).status).toBe(404);
    expect(requester.id).toBeTruthy();
  });
});

describe("All Available and Search (10.1, B4 Q4)", () => {
  it("lists open requests and filters by restaurant and delivery distance, Dhaka day and sub-area", async () => {
    const viewer = await verifiedUser();
    const near = await openFood();
    const far = await openFood({
      restaurant: { address: "Uttara", lat: 23.8759, lng: 90.3795 },
      pickup: { address: "Uttara", lat: 23.8759, lng: 90.3795 },
      delivery: { address: "Uttara hall", lat: 23.8759, lng: 90.3795 },
    });
    const ids = async (query: Record<string, unknown>) =>
      ((await api().get("/api/food").query(query).set(bearer(viewer.accessToken))).body.items as { id: string }[]).map((item) => item.id);

    expect(await ids({})).toEqual(expect.arrayContaining([near.request.id, far.request.id]));
    expect(await ids({ restaurantLat: restaurant.lat, restaurantLng: restaurant.lng })).toEqual([near.request.id]);
    expect(await ids({ deliveryLat: 23.8759, deliveryLng: 90.3795, radiusKm: 1 })).toEqual([far.request.id]);
    expect(await ids({ restaurantLat: restaurant.lat, restaurantLng: restaurant.lng, deliveryLat: 23.8759, deliveryLng: 90.3795 })).toEqual([]);
    expect(await ids({ subAreaId: far.area.id })).toEqual([far.request.id]);
    expect(await ids({ date: dhakaDateString(fromNow(72 * HOUR)) })).toEqual([]);
    expect(await ids({ date: dhakaDateString((await activityRow(near.request.id)).startTime), subAreaId: near.area.id })).toEqual([near.request.id]);
    expect((await api().get("/api/food").query({ radiusKm: 3 }).set(bearer(viewer.accessToken))).status).toBe(400);

    // Accepted ones leave the list; blocked creators are hidden
    await acceptFood((await verifiedUser()).accessToken, near.request.id);
    await prisma.block.create({ data: { blockerId: far.requester.id, blockedId: viewer.id } });
    expect(await ids({})).toEqual([]);
  });
});

describe("account lock and food (proposal 17.1)", () => {
  it("cancels the user's open requests and keeps accepted ones, telling the other participant", async () => {
    const admin = await registerUser({ role: "SUPER_ADMIN", studentVerificationStatus: "VERIFIED" });
    const area = await subArea();
    const user = await verifiedUser();
    const open = (await postFood(user.accessToken, foodBody(area.id))).body.request;
    const accepted = (await postFood(user.accessToken, foodBody(area.id, { expectedDeliveryTime: fromNow(8 * HOUR).toISOString() }))).body.request;
    const accepter = await verifiedUser();
    await acceptFood(accepter.accessToken, accepted.id);

    await applyAccountAction(admin.id, user.id, "restrict", { reason: "Spam posts" });
    await settle();
    expect(await activityRow(open.id)).toMatchObject({ status: "CANCELLED", closureReason: "ACCOUNT_MODERATED" });
    expect((await activityRow(accepted.id)).status).toBe("ACCEPTED");
    expect(await channelsOf(accepter.id, "PARTICIPANT_ACCOUNT_LOCKED")).toEqual(["EMAIL", "IN_APP", "PUSH"]);
  });
});
