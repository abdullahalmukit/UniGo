import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";
import { api, bearer, createUniversity, registerUser } from "./helpers.js";
import { subArea } from "./ride-helpers.js";

// Admin › Notifications (proposal 17) and Rate Us (proposal 5).

const announce = (token: string, body: Record<string, unknown>) => api().post("/api/admin/announcements").set(bearer(token)).send(body);

describe("announcements", () => {
  it("send to everyone, one university or one sub-area; banned accounts and outsiders get nothing", async () => {
    const moderator = await registerUser({ role: "MODERATOR" });
    const university = await createUniversity();
    const [inUni, other, banned] = await Promise.all([
      registerUser({ universityId: university.id }),
      registerUser(),
      registerUser({ accountStatus: "BANNED" }),
    ]);
    const area = await subArea();
    await prisma.userSubArea.create({ data: { userId: other.id, subAreaId: area.id } });

    const toUni = await announce(moderator.accessToken, { title: "Exam week", body: "Fewer rides this week.", audience: { kind: "UNIVERSITY", universityId: university.id } });
    expect(toUni.status, JSON.stringify(toUni.body)).toBe(201);
    expect(toUni.body.recipients).toBe(1);
    await settleBackgroundTasks();
    const rows = await prisma.notification.findMany({ where: { type: "ANNOUNCEMENT" }, select: { userId: true, channel: true } });
    expect(rows.filter((r) => r.channel === "IN_APP").map((r) => r.userId)).toEqual([inUni.id]);

    const toArea = await announce(moderator.accessToken, { title: "Road closed", body: "Use the north gate.", audience: { kind: "SUB_AREA", subAreaId: area.id } });
    expect(toArea.body.recipients).toBe(1);

    const count = await api().post("/api/admin/announcements/count").set(bearer(moderator.accessToken)).send({ audience: { kind: "ALL" } });
    const notBanned = await prisma.user.count({ where: { accountStatus: { in: ["ACTIVE", "RESTRICTED"] } } });
    expect(count.body.recipients).toBe(notBanned);

    const toAll = await announce(moderator.accessToken, { title: "Welcome", body: "UniGo is live.", audience: { kind: "ALL" } });
    await settleBackgroundTasks();
    const allRows = await prisma.notification.findMany({ where: { type: "ANNOUNCEMENT", channel: "IN_APP", dedupeKey: `ANNOUNCEMENT:${toAll.body.id}` } });
    expect(allRows.map((r) => r.userId)).not.toContain(banned.id);
    expect(allRows).toHaveLength(notBanned);

    // The user sees the title and text in the app
    const list = await api().get("/api/notifications").set(bearer(inUni.accessToken));
    expect(list.body.notifications.some((n: { title: string; body: string }) => n.title === "Exam week" && n.body === "Fewer rides this week.")).toBe(true);

    // Audited and listed for admins; refused for normal users
    expect(await prisma.auditLog.count({ where: { action: "ANNOUNCEMENT_SENT" } })).toBe(3);
    const history = await api().get("/api/admin/announcements").set(bearer(moderator.accessToken));
    expect(history.body.announcements.map((a: { title: string }) => a.title)).toEqual(["Welcome", "Road closed", "Exam week"]);
    expect((await announce(inUni.accessToken, { title: "Hi there", body: "Hello all", audience: { kind: "ALL" } })).status).toBe(403);
    expect((await announce(moderator.accessToken, { title: "x", body: "", audience: { kind: "ALL" } })).status).toBe(400);
    expect(
      (await announce(moderator.accessToken, { title: "Missing", body: "No such area", audience: { kind: "SUB_AREA", subAreaId: "01a00000-0000-7000-8000-000000000000" } })).body
        .error.code,
    ).toBe("SUB_AREA_NOT_FOUND");
  });
});

describe("Rate Us", () => {
  it("stores 1-5 stars with an optional comment as App Feedback, at most 3 a day", async () => {
    const user = await registerUser();
    const rate = (body: Record<string, unknown>) => api().post("/api/support/rate").set(bearer(user.accessToken)).send(body);

    const first = await rate({ rating: 5 });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await rate({ rating: 6 })).status).toBe(400);
    expect((await rate({ rating: 4, comment: "Great app, add more sub-areas" })).status).toBe(201);
    const rows = await prisma.supportRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.category, r.rating, r.message])).toEqual([
      ["APP_FEEDBACK", 5, ""],
      ["APP_FEEDBACK", 4, "Great app, add more sub-areas"],
    ]);
    expect((await rate({ rating: 3 })).status).toBe(201);
    expect((await rate({ rating: 3 })).status).toBe(429);
  });
});
