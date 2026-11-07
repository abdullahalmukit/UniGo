import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { transitionActivity } from "../../src/modules/activities/engine.js";
import { HOUR, MINUTE, acceptedWithChat, createActivity, fromNow, verifiedUser } from "./activity-helpers.js";
import { api, bearer, files } from "./helpers.js";

const get = (path: string, token: string) => api().get(`/api/chats${path}`).set(bearer(token));
const post = (path: string, token: string, body: object = {}) => api().post(`/api/chats${path}`).set(bearer(token)).send(body);
const send = (chatId: string, token: string, body: string) => post(`/${chatId}/messages`, token, { body });
const upload = (chatId: string, token: string) => api().post(`/api/chats/${chatId}/images`).set(bearer(token));

describe("chat creation and system messages", () => {
  it("opens one chat in the accept transaction, with an ACCEPTED message from the accepter", async () => {
    const { accepter, activity, chatId } = await acceptedWithChat("FOOD");
    expect(await prisma.chat.count({ where: { activityId: activity.id } })).toBe(1);
    const messages = await prisma.message.findMany({ where: { chatId } });
    expect(messages).toMatchObject([{ kind: "SYSTEM", systemCode: "ACCEPTED", senderId: accepter.id, body: null }]);
  });

  it("leaves no chat behind when the accept fails", async () => {
    const { acceptActivity } = await import("../../src/modules/activities/engine.js");
    const [creator, accepter, other] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    const start = fromNow(3 * HOUR);
    await createActivity({ creatorId: other.id, accepterId: accepter.id, status: "ACCEPTED", startTime: start });
    const clash = await createActivity({ creatorId: creator.id, startTime: start });

    await expect(acceptActivity(clash.id, accepter.id)).rejects.toMatchObject({ code: "TIME_CONFLICT" });
    expect(await prisma.chat.findUnique({ where: { activityId: clash.id } })).toBeNull();
    expect(await prisma.message.count()).toBe(0);
  });

  it("has no chat for an item nobody accepted", async () => {
    const creator = await verifiedUser();
    const item = await createActivity({ creatorId: creator.id });
    expect(await prisma.chat.findUnique({ where: { activityId: item.id } })).toBeNull();
  });

  it("writes a system message for each key event, with the cancellation reason", async () => {
    // Start Ride is allowed from 30 minutes before the start (B3a Q4)
    const { creator, accepter, activity, chatId } = await acceptedWithChat("RIDE_REQUEST", fromNow(20 * MINUTE));
    const as = (id: string) => ({ type: "USER" as const, id });
    await transitionActivity(activity.id, "START", as(accepter.id));
    await transitionActivity(activity.id, "REQUEST_COMPLETION", as(accepter.id));
    await transitionActivity(activity.id, "DISPUTE", as(creator.id), { reason: "Did not arrive" });

    const second = await acceptedWithChat("SERVICE");
    await transitionActivity(second.activity.id, "CANCEL", as(second.creator.id), { reason: "Exam moved" });

    const codes = (await prisma.message.findMany({ where: { chatId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((m) => m.systemCode);
    expect(codes).toEqual(["ACCEPTED", "STARTED", "COMPLETION_REQUESTED", "DISPUTED"]);
    const cancelled = await prisma.message.findFirstOrThrow({ where: { chatId: second.chatId, systemCode: "CANCELLED" } });
    expect(cancelled).toMatchObject({ body: "Exam moved", senderId: second.creator.id });
    // A dispute's reason is for the admin, not the chat
    expect((await prisma.message.findFirstOrThrow({ where: { chatId, systemCode: "DISPUTED" } })).body).toBeNull();
  });

  it("writes COMPLETED and NOT_MARKED messages from the system", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat("SERVICE");
    await transitionActivity(activity.id, "START", { type: "USER", id: accepter.id });
    await transitionActivity(activity.id, "DELIVER_SERVICE", { type: "USER", id: accepter.id });
    await transitionActivity(activity.id, "AUTO_COMPLETE", { type: "SYSTEM" });
    expect((await prisma.message.findFirstOrThrow({ where: { chatId, systemCode: "COMPLETED" } })).senderId).toBeNull();

    const late = await acceptedWithChat("FOOD");
    await prisma.activity.update({ where: { id: late.activity.id }, data: { startTime: fromNow(-7 * HOUR) } });
    await transitionActivity(late.activity.id, "MARK_NOT_MARKED", { type: "SYSTEM" });
    expect(await prisma.message.count({ where: { chatId: late.chatId, systemCode: "NOT_MARKED" } })).toBe(1);
    expect(creator.id).not.toBe(accepter.id);
  });
});

describe("who can read and write", () => {
  it("refuses a non-participant everywhere", async () => {
    const { chatId } = await acceptedWithChat();
    const stranger = await verifiedUser();
    for (const response of [
      await get(`/${chatId}`, stranger.accessToken),
      await get(`/${chatId}/messages`, stranger.accessToken),
      await send(chatId, stranger.accessToken, "hi"),
      await post(`/${chatId}/read`, stranger.accessToken),
      await post(`/${chatId}/images`, stranger.accessToken),
      await post(`/${chatId}/block`, stranger.accessToken),
    ]) {
      expect([response.status, response.body.error.code]).toEqual([403, "NOT_PARTICIPANT"]);
    }
    const missing = await get("/0190a000-0000-7000-8000-000000000000", stranger.accessToken);
    expect([missing.status, missing.body.error.code]).toEqual([404, "CHAT_NOT_FOUND"]);
  });

  it("sends, lists and cleans text messages", async () => {
    const { creator, accepter, chatId } = await acceptedWithChat();
    const sent = await send(chatId, creator.accessToken, "  Hello‮ there\u0007  ");
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ kind: "TEXT", body: "Hello there", senderId: creator.id });

    expect((await send(chatId, creator.accessToken, "   ")).body.error.code).toBe("MESSAGE_EMPTY");
    expect((await send(chatId, creator.accessToken, "x".repeat(1001))).body.error.code).toBe("MESSAGE_TOO_LONG");
    expect((await send(chatId, creator.accessToken, "<b>hi</b> <3")).body.message.body).toBe("<b>hi</b> <3");

    const list = await get(`/${chatId}/messages`, accepter.accessToken);
    expect(list.body.messages.map((m: { body: string | null }) => m.body)).toEqual([null, "Hello there", "<b>hi</b> <3"]);
  });

  it("becomes read-only at every terminal status", async () => {
    for (const status of ["COMPLETED", "CANCELLED", "NOT_MARKED"] as const) {
      const { creator, activity, chatId } = await acceptedWithChat();
      await prisma.activity.update({ where: { id: activity.id }, data: { status } });
      const response = await send(chatId, creator.accessToken, "still there?");
      expect([response.status, response.body.error.code]).toEqual([409, "CHAT_READ_ONLY"]);
      expect((await get(`/${chatId}`, creator.accessToken)).body.chat.readOnly).toBe("FINISHED");
    }
    // Still open while disputed
    const { creator, activity, chatId } = await acceptedWithChat();
    await prisma.activity.update({ where: { id: activity.id }, data: { status: "DISPUTED" } });
    expect((await send(chatId, creator.accessToken, "evidence follows")).status).toBe(201);
  });

  it("allows 10 messages a minute per user", async () => {
    const { creator, accepter, chatId } = await acceptedWithChat();
    for (let i = 0; i < 10; i += 1) expect((await send(chatId, creator.accessToken, `m${i}`)).status).toBe(201);
    const blocked = await send(chatId, creator.accessToken, "one too many");
    expect([blocked.status, blocked.body.error.code]).toEqual([429, "RATE_LIMITED"]);
    // Per user: the other participant can still write
    expect((await send(chatId, accepter.accessToken, "my turn")).status).toBe(201);
  });
});

describe("phone number and privacy", () => {
  it("shows the phone while the activity runs and hides it after", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat();
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: accepter.id } })).phone;

    expect((await get(`/${chatId}`, creator.accessToken)).body.chat.otherUser.phone).toBe(phone);
    await prisma.activity.update({ where: { id: activity.id }, data: { status: "COMPLETED" } });
    expect((await get(`/${chatId}`, creator.accessToken)).body.chat.otherUser.phone).toBeNull();
  });

  it("never returns an email address in any chat payload", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat("FOOD");
    await send(chatId, accepter.accessToken, "On my way");
    await upload(chatId, accepter.accessToken).attach("image", files.png, { filename: "r.png", contentType: "image/png" });
    await transitionActivity(activity.id, "CANCEL", { type: "USER", id: creator.id }, { reason: "Changed my mind" });

    const bodies = [
      (await get("", creator.accessToken)).body,
      (await get("/unread-count", creator.accessToken)).body,
      (await get(`/${chatId}`, creator.accessToken)).body,
      (await get(`/${chatId}`, accepter.accessToken)).body,
      (await get(`/${chatId}/messages`, creator.accessToken)).body,
      (await get(`/${chatId}/block-impact`, creator.accessToken)).body,
    ];
    for (const body of bodies) {
      const json = JSON.stringify(body);
      expect(json).not.toContain(creator.email);
      expect(json).not.toContain(accepter.email);
      expect(json).not.toMatch(/"email"/i);
    }
  });
});

describe("inbox and unread counts", () => {
  it("counts unread messages, including system messages, per user", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat();
    // The ACCEPTED message came from the accepter: unread for the creator only
    expect((await get("/unread-count", creator.accessToken)).body.unreadTotal).toBe(1);
    expect((await get("/unread-count", accepter.accessToken)).body.unreadTotal).toBe(0);

    await send(chatId, accepter.accessToken, "Hi");
    await send(chatId, accepter.accessToken, "Ordering now");
    await transitionActivity(activity.id, "CONFIRM_ORDER", { type: "USER", id: creator.id });
    await transitionActivity(activity.id, "COLLECT_FOOD", { type: "USER", id: accepter.id });
    expect((await get("/unread-count", creator.accessToken)).body.unreadTotal).toBe(4);

    const inbox = (await get("", creator.accessToken)).body.chats;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ chatId, unreadCount: 4, activity: { type: "FOOD", status: "IN_PROGRESS" }, lastMessage: { systemCode: "STARTED" } });

    const read = await post(`/${chatId}/read`, creator.accessToken);
    expect(read.body.unreadTotal).toBe(0);
    expect((await get("", creator.accessToken)).body.chats[0].unreadCount).toBe(0);

    // Reading up to an older message never moves the position back
    const first = (await get(`/${chatId}/messages`, creator.accessToken)).body.messages[0].id;
    await post(`/${chatId}/read`, creator.accessToken, { upTo: first });
    expect((await get("/unread-count", creator.accessToken)).body.unreadTotal).toBe(0);
  });

  it("lists the latest chat first", async () => {
    const [user, a, b] = await Promise.all([verifiedUser(), verifiedUser(), verifiedUser()]);
    const { acceptActivity } = await import("../../src/modules/activities/engine.js");
    const first = await createActivity({ creatorId: user.id, startTime: fromNow(2 * HOUR) });
    const second = await createActivity({ creatorId: user.id, startTime: fromNow(5 * HOUR) });
    await acceptActivity(first.id, a.id);
    await acceptActivity(second.id, b.id);
    const firstChat = await prisma.chat.findUniqueOrThrow({ where: { activityId: first.id } });
    await send(firstChat.id, user.accessToken, "newest");

    const ids = (await get("", user.accessToken)).body.chats.map((c: { activity: { id: string } }) => c.activity.id);
    expect(ids).toEqual([first.id, second.id]);
  });
});

describe("food chat images", () => {
  it("re-encodes a receipt without EXIF and serves it only through a short-lived link", async () => {
    const { creator, accepter, chatId } = await acceptedWithChat("FOOD");
    const withExif = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#336699" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "secret-gps-holder" } } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const response = await upload(chatId, accepter.accessToken).attach("image", withExif, { filename: "r.jpg", contentType: "image/jpeg" });
    expect(response.status).toBe(201);
    expect(response.body.message.kind).toBe("IMAGE");
    const link = response.body.message.image.url as string;
    expect(new Date(response.body.message.image.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 1000);

    const file = await api().get(link).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect((await sharp(file.body as Buffer).metadata()).exif).toBeUndefined();

    const listed = await get(`/${chatId}/messages`, creator.accessToken);
    expect(listed.body.messages.at(-1).image.url).toMatch(/^\/api\/files\//);
  });

  it("refuses images outside food chats, and files that are not JPG or PNG", async () => {
    const service = await acceptedWithChat("SERVICE");
    const notFood = await upload(service.chatId, service.accepter.accessToken).attach("image", files.png, { filename: "a.png", contentType: "image/png" });
    expect([notFood.status, notFood.body.error.code]).toEqual([403, "CHAT_IMAGES_NOT_ALLOWED"]);

    const food = await acceptedWithChat("FOOD");
    const pdf = await upload(food.chatId, food.accepter.accessToken).attach("image", files.pdf, { filename: "a.pdf", contentType: "application/pdf" });
    expect([pdf.status, pdf.body.error.code]).toEqual([415, "IMAGE_TYPE_NOT_ALLOWED"]);
    const fake = await upload(food.chatId, food.accepter.accessToken).attach("image", files.text, { filename: "a.png", contentType: "image/png" });
    expect(fake.status).toBe(415);
  });
});
