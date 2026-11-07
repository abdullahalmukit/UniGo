import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { notify } from "../../src/modules/notifications/notify.service.js";
import { verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";
import { settle } from "./notification-helpers.js";

async function withNotifications(count: number) {
  const user = await verifiedUser();
  for (let i = 0; i < count; i += 1) {
    await notify({ type: "REPORT_UPDATE", userIds: [user.id], dedupeKey: `REPORT_UPDATE:${i}` });
  }
  await settle();
  return user;
}

const subscription = (n: string) => ({ endpoint: `https://push.example.test/${n}`, keys: { p256dh: "BPublicKey_-", auth: "authSecret" } });

describe("GET /api/notifications", () => {
  it("needs a login", async () => {
    expect((await api().get("/api/notifications")).status).toBe(401);
  });

  it("pages newest first, with the unread count, and only in-app rows", async () => {
    const user = await withNotifications(23);
    await notify({ type: "PASSWORD_CHANGED", userIds: [user.id], dedupeKey: "PASSWORD_CHANGED:x" });
    await settle();

    const first = await api().get("/api/notifications").set(bearer(user.accessToken));
    expect(first.status).toBe(200);
    expect(first.body.notifications).toHaveLength(20);
    expect(first.body.unreadCount).toBe(23);
    expect(first.body.notifications[0]).toEqual({
      id: expect.any(String),
      type: "REPORT_UPDATE",
      title: "Report update",
      body: "There is an update on your report.",
      link: "/account",
      read: false,
      createdAt: expect.any(String),
    });
    const second = await api().get(`/api/notifications?before=${first.body.nextCursor}`).set(bearer(user.accessToken));
    expect(second.body.notifications).toHaveLength(3);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.notifications, ...second.body.notifications].map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(23);
  });

  it("marks one or all read, and never someone else's", async () => {
    const user = await withNotifications(3);
    const stranger = await registerUser();
    const list = await api().get("/api/notifications").set(bearer(user.accessToken));
    const id = list.body.notifications[0].id;

    expect((await api().post(`/api/notifications/${id}/read`).set(bearer(stranger.accessToken))).status).toBe(404);
    const one = await api().post(`/api/notifications/${id}/read`).set(bearer(user.accessToken));
    expect(one.body).toEqual({ unreadCount: 2 });
    expect((await api().get("/api/notifications/unread-count").set(bearer(user.accessToken))).body).toEqual({ unreadCount: 2 });
    const all = await api().post("/api/notifications/read-all").set(bearer(user.accessToken));
    expect(all.body).toEqual({ unreadCount: 0 });
  });
});

describe("Web Push subscriptions", () => {
  it("gives the public key and saves one subscription per device", async () => {
    const user = await verifiedUser();
    const config = await api().get("/api/push/config").set(bearer(user.accessToken));
    expect(config.body).toEqual({ available: true, publicKey: "test-vapid-public-key" });

    for (let i = 0; i < 2; i += 1) {
      const saved = await api().put("/api/me/push-subscriptions").set(bearer(user.accessToken)).send(subscription("device-1"));
      expect(saved.body).toEqual({ pushEnabled: true });
    }
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pushEnabled).toBe(true);

    const removed = await api().delete("/api/me/push-subscriptions").set(bearer(user.accessToken)).send({ endpoint: subscription("device-1").endpoint });
    expect(removed.body).toEqual({ pushEnabled: false });
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("refuses a subscription that is not an https endpoint with keys", async () => {
    const user = await verifiedUser();
    const bad = await api().put("/api/me/push-subscriptions").set(bearer(user.accessToken)).send({ endpoint: "http://push.example.test/x", keys: { p256dh: "a", auth: "b" } });
    expect(bad.status).toBe(400);
    const noKeys = await api().put("/api/me/push-subscriptions").set(bearer(user.accessToken)).send({ endpoint: "https://push.example.test/x" });
    expect(noKeys.status).toBe(400);
  });

  it("moves a shared device to the account that subscribed last", async () => {
    const [first, second] = await Promise.all([verifiedUser(), verifiedUser()]);
    await api().put("/api/me/push-subscriptions").set(bearer(first.accessToken)).send(subscription("shared"));
    await api().put("/api/me/push-subscriptions").set(bearer(second.accessToken)).send(subscription("shared"));
    const rows = await prisma.pushSubscription.findMany();
    expect(rows.map((row) => row.userId)).toEqual([second.id]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).pushEnabled).toBe(false);
  });

  it("removes every device when the user logs out of all devices", async () => {
    const user = await verifiedUser();
    await api().put("/api/me/push-subscriptions").set(bearer(user.accessToken)).send(subscription("a"));
    await api().put("/api/me/push-subscriptions").set(bearer(user.accessToken)).send(subscription("b"));
    expect((await api().post("/api/auth/logout-all").set(bearer(user.accessToken))).status).toBeLessThan(300);
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pushEnabled).toBe(false);
  });
});
