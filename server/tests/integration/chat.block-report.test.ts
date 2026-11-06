import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { acceptActivity, transitionActivity } from "../../src/modules/activities/engine.js";
import { blockedUserIds } from "../../src/modules/users/blocks.service.js";
import { HOUR, MINUTE, acceptedWithChat, createActivity, fromNow, historyOf, outcomeCode, storedActivity, verifiedUser } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";

const chatPost = (path: string, token: string, body: object = {}) => api().post(`/api/chats${path}`).set(bearer(token)).send(body);
const chatGet = (path: string, token: string) => api().get(`/api/chats${path}`).set(bearer(token));

describe("blocking from a chat (B2b decision 8)", () => {
  it("cancels the shared activity as the blocker, keeps 'Blocked' private and makes the chat read-only for both", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat("FOOD", fromNow(30 * MINUTE));

    const impact = await chatGet(`/${chatId}/block-impact`, creator.accessToken);
    expect(impact.body).toMatchObject({ refusedForCarpoolContract: false, cancels: [{ id: activity.id, type: "FOOD" }] });

    const blocked = await chatPost(`/${chatId}/block`, creator.accessToken);
    expect(blocked.status).toBe(200);
    expect(blocked.body.cancelledActivityIds).toEqual([activity.id]);

    // Cancelled by the blocker, late flag as usual (start in 30 minutes), no reason on the activity
    expect(await storedActivity(activity.id)).toMatchObject({ status: "CANCELLED", cancelledById: creator.id, cancellationReason: null, isLateCancellation: true });
    expect((await historyOf(activity.id)).at(-1)).toMatchObject({ toStatus: "CANCELLED", reason: "Blocked", actorId: creator.id });
    // The chat says only "cancelled" (by the sender), never why
    const message = await prisma.message.findFirstOrThrow({ where: { chatId, systemCode: "CANCELLED" } });
    expect(message).toMatchObject({ senderId: creator.id, body: null });
    const otherView = await chatGet(`/${chatId}/messages`, accepter.accessToken);
    expect(JSON.stringify(otherView.body)).not.toContain("Blocked");

    for (const user of [creator, accepter]) {
      const chat = (await chatGet(`/${chatId}`, user.accessToken)).body.chat;
      expect(chat.otherUser.phone).toBeNull();
    }
    expect((await chatGet(`/${chatId}`, creator.accessToken)).body.chat.blockedByMe).toBe(true);
  });

  it("stops new messages both ways in a chat that is still active, and hides the phone at once", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat("SERVICE");
    // Completion requested: not cancelled by the block, the chat stays active otherwise
    await transitionActivity(activity.id, "START", { type: "USER", id: accepter.id });
    await transitionActivity(activity.id, "DELIVER_SERVICE", { type: "USER", id: accepter.id });

    await api().post("/api/me/blocks").set(bearer(accepter.accessToken)).send({ userId: creator.id });
    expect((await storedActivity(activity.id)).subStatus).toBe("COMPLETION_REQUESTED");

    for (const user of [creator, accepter]) {
      const response = await chatPost(`/${chatId}/messages`, user.accessToken, { body: "hello?" });
      expect([response.status, response.body.error.code]).toEqual([403, "CHAT_BLOCKED"]);
      const chat = (await chatGet(`/${chatId}`, user.accessToken)).body.chat;
      expect(chat).toMatchObject({ readOnly: "BLOCKED", otherUser: { phone: null } });
    }
    // The existing chat stays visible
    expect((await chatGet(`/${chatId}/messages`, creator.accessToken)).body.messages.length).toBeGreaterThan(0);

    // Unblocking reopens sending
    expect((await api().delete(`/api/me/blocks/${creator.id}`).set(bearer(accepter.accessToken))).status).toBe(204);
    expect((await chatPost(`/${chatId}/messages`, creator.accessToken, { body: "thanks" })).status).toBe(201);
  });

  it("is refused while the users share a carpool contract", async () => {
    const [rider, passenger] = await Promise.all([verifiedUser(), verifiedUser()]);
    await createActivity({ type: "CARPOOL_BOOKING", creatorId: rider.id, accepterId: passenger.id, status: "ACCEPTED", subStatus: "CONTRACT_ACTIVE", blocksTime: false });

    const impact = await api().get(`/api/me/blocks/${rider.id}/impact`).set(bearer(passenger.accessToken));
    expect(impact.body.refusedForCarpoolContract).toBe(true);
    const response = await api().post("/api/me/blocks").set(bearer(passenger.accessToken)).send({ userId: rider.id });
    expect([response.status, response.body.error.code]).toEqual([409, "BLOCK_CARPOOL_CONTRACT"]);
    expect(await prisma.block.count()).toBe(0);
  });

  it("lists blocked users, refuses blocking yourself, and keeps them apart in matching", async () => {
    const [user, other, third] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    expect((await api().post("/api/me/blocks").set(bearer(user.accessToken)).send({ userId: user.id })).body.error.code).toBe("CANNOT_BLOCK_SELF");
    expect((await api().post("/api/me/blocks").set(bearer(user.accessToken)).send({ userId: other.id })).status).toBe(200);
    // Blocking twice is harmless
    expect((await api().post("/api/me/blocks").set(bearer(user.accessToken)).send({ userId: other.id })).status).toBe(200);

    const list = await api().get("/api/me/blocks").set(bearer(user.accessToken));
    expect(list.body.users.map((u: { id: string }) => u.id)).toEqual([other.id]);
    expect(JSON.stringify(list.body)).not.toContain(other.email);

    expect(await blockedUserIds(prisma, user.id)).toEqual([other.id]);
    expect(await blockedUserIds(prisma, other.id)).toEqual([user.id]);
    expect(await blockedUserIds(prisma, third.id)).toEqual([]);

    const item = await createActivity({ creatorId: other.id, startTime: fromNow(2 * HOUR) });
    expect(await outcomeCode(acceptActivity(item.id, user.id))).toBe("NOT_AVAILABLE");
  });
});

describe("reports (B2b decision 11)", () => {
  const report = (token: string, body: object) => api().post("/api/reports").set(bearer(token)).send(body);

  it("stores a report from a chat against the other participant, with a message", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat();
    const sent = await chatPost(`/${chatId}/messages`, accepter.accessToken, { body: "rude words" });

    const response = await report(creator.accessToken, { reason: "HARASSMENT", description: "Rude", activityId: activity.id, messageId: sent.body.message.id });
    expect(response.status).toBe(201);
    expect(await prisma.report.findFirstOrThrow()).toMatchObject({
      reporterId: creator.id,
      reportedUserId: accepter.id,
      activityId: activity.id,
      messageId: sent.body.message.id,
      reason: "HARASSMENT",
      status: "OPEN",
    });
    expect((await report(creator.accessToken, { reason: "FAKE_PROFILE", activityId: activity.id })).status).toBe(201);
  });

  it("checks the reason, the participants and the message", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat();
    const stranger = await verifiedUser();
    const own = await chatPost(`/${chatId}/messages`, creator.accessToken, { body: "my own" });

    expect((await report(creator.accessToken, { reason: "NOT_A_REASON", activityId: activity.id })).status).toBe(400);
    expect((await report(creator.accessToken, { reason: "OTHER", activityId: activity.id })).body.error.fields.description).toBeDefined();
    expect((await report(stranger.accessToken, { reason: "SPAM", activityId: activity.id })).body.error.code).toBe("NOT_PARTICIPANT");
    expect((await report(creator.accessToken, { reason: "SPAM", activityId: activity.id, messageId: own.body.message.id })).status).toBe(400);
    expect((await report(creator.accessToken, { reason: "SPAM", reportedUserId: creator.id })).body.error.code).toBe("CANNOT_REPORT_SELF");
    expect((await report(creator.accessToken, { reason: "SPAM", reportedUserId: accepter.id })).status).toBe(201);
  });

  it("allows 5 reports an hour per user", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    for (let i = 0; i < 5; i += 1) expect((await report(user.accessToken, { reason: "SPAM", reportedUserId: other.id })).status).toBe(201);
    expect((await report(user.accessToken, { reason: "SPAM", reportedUserId: other.id })).status).toBe(429);
  });
});
