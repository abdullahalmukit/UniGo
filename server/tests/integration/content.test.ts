import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { api, bearer, registerUser } from "./helpers.js";

// B8 — Content: Spotlight, Promos, Banners
// Public endpoints return only active + in-window items.
// Admin CRUD requires MODERATOR or SUPER_ADMIN.

const moderator = () => registerUser({ role: "MODERATOR" });
const user = () => registerUser();

const NOW = new Date();
const past = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const future = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const H = 60 * 60 * 1000; // one hour in ms

// ---- Public: GET /api/content/spotlight ----------------------------------------

describe("GET /api/content/spotlight", () => {
  it("returns only active, started, non-expired items ordered by sortOrder asc", async () => {
    // Active, started, never expires → should appear
    const visible = await prisma.spotlightItem.create({
      data: { mediaType: "IMAGE", mediaUrl: "https://example.com/a.jpg", isActive: true, startsAt: new Date(past(H)), sortOrder: 2 },
    });
    // Active, started, expires in future → should appear
    const alsoVisible = await prisma.spotlightItem.create({
      data: { mediaType: "VIDEO", mediaUrl: "https://example.com/b.mp4", isActive: true, startsAt: new Date(past(H)), expiresAt: new Date(future(H)), sortOrder: 1 },
    });
    // Inactive → should NOT appear
    await prisma.spotlightItem.create({
      data: { mediaType: "IMAGE", mediaUrl: "https://example.com/c.jpg", isActive: false, startsAt: new Date(past(H)) },
    });
    // Not yet started → should NOT appear
    await prisma.spotlightItem.create({
      data: { mediaType: "IMAGE", mediaUrl: "https://example.com/d.jpg", isActive: true, startsAt: new Date(future(H)) },
    });
    // Expired → should NOT appear
    await prisma.spotlightItem.create({
      data: { mediaType: "IMAGE", mediaUrl: "https://example.com/e.jpg", isActive: true, startsAt: new Date(past(2 * H)), expiresAt: new Date(past(H)) },
    });

    const res = await api().get("/api/content/spotlight");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map((item: { id: string }) => item.id);
    expect(ids).toContain(visible.id);
    expect(ids).toContain(alsoVisible.id);
    expect(res.body.length).toBe(2);
    // sortOrder 1 before 2
    expect(res.body[0].id).toBe(alsoVisible.id);
    expect(res.body[1].id).toBe(visible.id);
  });

  it("requires no authentication", async () => {
    const res = await api().get("/api/content/spotlight");
    expect(res.status).toBe(200);
  });
});

// ---- Public: GET /api/content/promos -------------------------------------------

describe("GET /api/content/promos", () => {
  it("returns only active promos within their window", async () => {
    const active = await prisma.promo.create({
      data: { title: "50% off", startsAt: new Date(past(H)), endsAt: new Date(future(H)), isActive: true },
    });
    // Inactive
    await prisma.promo.create({
      data: { title: "inactive", startsAt: new Date(past(H)), endsAt: new Date(future(H)), isActive: false },
    });
    // Ended
    await prisma.promo.create({
      data: { title: "ended", startsAt: new Date(past(2 * H)), endsAt: new Date(past(H)), isActive: true },
    });
    // Not started
    await prisma.promo.create({
      data: { title: "future", startsAt: new Date(future(H)), endsAt: new Date(future(2 * H)), isActive: true },
    });

    const res = await api().get("/api/content/promos");
    expect(res.status).toBe(200);
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids).toEqual([active.id]);
  });
});

// ---- Public: GET /api/content/banners ------------------------------------------

describe("GET /api/content/banners", () => {
  it("returns only active banners within window, ordered by sortOrder", async () => {
    const b1 = await prisma.banner.create({
      data: { title: "Banner A", imageUrl: "https://cdn.example.com/a.jpg", startsAt: new Date(past(H)), endsAt: new Date(future(H)), isActive: true, sortOrder: 2 },
    });
    const b2 = await prisma.banner.create({
      data: { title: "Banner B", imageUrl: "https://cdn.example.com/b.jpg", startsAt: new Date(past(H)), endsAt: new Date(future(H)), isActive: true, sortOrder: 1 },
    });
    // Inactive
    await prisma.banner.create({
      data: { title: "hidden", imageUrl: "https://cdn.example.com/h.jpg", startsAt: new Date(past(H)), endsAt: new Date(future(H)), isActive: false, sortOrder: 0 },
    });

    const res = await api().get("/api/content/banners");
    expect(res.status).toBe(200);
    const ids = res.body.map((b: { id: string }) => b.id);
    expect(ids).toContain(b1.id);
    expect(ids).toContain(b2.id);
    expect(ids[0]).toBe(b2.id); // sortOrder 1 first
    expect(ids).not.toContain(expect.objectContaining({ title: "hidden" }));
  });
});

// ---- Admin CRUD: Spotlight -----------------------------------------------------

describe("admin content — spotlight", () => {
  it("rejects unauthenticated and plain user requests", async () => {
    const u = await user();
    expect((await api().get("/api/admin/content/spotlight")).status).toBe(401);
    expect((await api().get("/api/admin/content/spotlight").set(bearer(u.accessToken))).status).toBe(403);
  });

  it("moderator can list, create, update and delete a spotlight item", async () => {
    const mod = await moderator();

    // List (empty)
    const list0 = await api().get("/api/admin/content/spotlight").set(bearer(mod.accessToken));
    expect(list0.status).toBe(200);
    expect(Array.isArray(list0.body)).toBe(true);

    // Create
    const created = await api()
      .post("/api/admin/content/spotlight")
      .set(bearer(mod.accessToken))
      .send({ mediaType: "IMAGE", mediaUrl: "https://cdn.example.com/x.jpg", sortOrder: 5, isActive: false });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ mediaType: "IMAGE", mediaUrl: "https://cdn.example.com/x.jpg", sortOrder: 5, isActive: false });
    const itemId = created.body.id as string;

    // Update
    const updated = await api()
      .patch(`/api/admin/content/spotlight/${itemId}`)
      .set(bearer(mod.accessToken))
      .send({ title: "New banner", isActive: true });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: itemId, title: "New banner", isActive: true });

    // Delete
    const deleted = await api().delete(`/api/admin/content/spotlight/${itemId}`).set(bearer(mod.accessToken));
    expect(deleted.status).toBe(204);

    // 404 on second delete
    const gone = await api().delete(`/api/admin/content/spotlight/${itemId}`).set(bearer(mod.accessToken));
    expect(gone.body.error.code).toBe("SPOTLIGHT_NOT_FOUND");
  });

  it("validates required fields on create", async () => {
    const mod = await moderator();
    const bad = await api()
      .post("/api/admin/content/spotlight")
      .set(bearer(mod.accessToken))
      .send({ mediaUrl: "not-a-url" }); // missing mediaType, bad url
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ---- Admin CRUD: Promos --------------------------------------------------------

describe("admin content — promos", () => {
  it("moderator can create, update and delete a promo", async () => {
    const mod = await moderator();

    const body = {
      title: "Campus Deal",
      promoCode: "UNIGO10",
      startsAt: past(H),
      endsAt: future(H),
    };

    const created = await api().post("/api/admin/content/promos").set(bearer(mod.accessToken)).send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "Campus Deal", promoCode: "UNIGO10", isActive: true });
    const id = created.body.id as string;

    const updated = await api()
      .patch(`/api/admin/content/promos/${id}`)
      .set(bearer(mod.accessToken))
      .send({ isActive: false });
    expect(updated.body).toMatchObject({ id, isActive: false });

    expect((await api().delete(`/api/admin/content/promos/${id}`).set(bearer(mod.accessToken))).status).toBe(204);
    expect((await api().delete(`/api/admin/content/promos/${id}`).set(bearer(mod.accessToken))).body.error.code).toBe("PROMO_NOT_FOUND");
  });

  it("validates required fields", async () => {
    const mod = await moderator();
    const bad = await api().post("/api/admin/content/promos").set(bearer(mod.accessToken)).send({ promoCode: "X" }); // missing title, startsAt, endsAt
    expect(bad.status).toBe(400);
  });
});

// ---- Admin CRUD: Banners -------------------------------------------------------

describe("admin content — banners", () => {
  it("moderator can create, update and delete a banner", async () => {
    const mod = await moderator();

    const body = {
      title: "Welcome Banner",
      imageUrl: "https://cdn.example.com/banner.jpg",
      startsAt: past(H),
      endsAt: future(2 * H),
      sortOrder: 3,
    };

    const created = await api().post("/api/admin/content/banners").set(bearer(mod.accessToken)).send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "Welcome Banner", sortOrder: 3, isActive: true });
    const id = created.body.id as string;

    const updated = await api()
      .patch(`/api/admin/content/banners/${id}`)
      .set(bearer(mod.accessToken))
      .send({ sortOrder: 1, linkUrl: "https://example.com" });
    expect(updated.body).toMatchObject({ id, sortOrder: 1, linkUrl: "https://example.com" });

    expect((await api().delete(`/api/admin/content/banners/${id}`).set(bearer(mod.accessToken))).status).toBe(204);
    expect((await api().delete(`/api/admin/content/banners/${id}`).set(bearer(mod.accessToken))).body.error.code).toBe("BANNER_NOT_FOUND");
  });

  it("requires imageUrl to be a valid URL", async () => {
    const mod = await moderator();
    const bad = await api()
      .post("/api/admin/content/banners")
      .set(bearer(mod.accessToken))
      .send({ title: "X", imageUrl: "not-url", startsAt: past(H), endsAt: future(H) });
    expect(bad.status).toBe(400);
  });
});

