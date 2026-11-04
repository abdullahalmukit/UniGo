import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { prisma } from "../../src/lib/prisma.js";
import { api, bearer, registerUser } from "./helpers.js";

const place = (overrides: Record<string, unknown> = {}) => ({
  label: "HOME",
  address: "Road 27, Dhanmondi, Dhaka",
  lat: 23.7465,
  lng: 90.3762,
  ...overrides,
});

describe("saved addresses", () => {
  it("creates, lists (Home, Hall, Work first), edits and deletes the user's own addresses", async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);

    const custom = await api().post("/api/me/addresses").set(auth).send(place({ label: "CUSTOM", customLabel: "Gym" }));
    const home = await api().post("/api/me/addresses").set(auth).send(place());
    expect(custom.status).toBe(201);
    expect(home.status).toBe(201);
    expect(home.body.address).toMatchObject({ label: "HOME", customLabel: null, lat: 23.7465, lng: 90.3762 });

    const list = await api().get("/api/me/addresses").set(auth);
    expect(list.body.addresses.map((a: { label: string }) => a.label)).toEqual(["HOME", "CUSTOM"]);

    const edited = await api()
      .patch(`/api/me/addresses/${custom.body.address.id}`)
      .set(auth)
      .send({ customLabel: "Library", address: "Central Library" });
    expect(edited.status).toBe(200);
    expect(edited.body.address).toMatchObject({ label: "CUSTOM", customLabel: "Library", address: "Central Library" });

    expect((await api().delete(`/api/me/addresses/${home.body.address.id}`).set(auth)).status).toBe(204);
    expect((await api().get("/api/me/addresses").set(auth)).body.addresses).toHaveLength(1);
  });

  it("allows one each of Home, Hall and Work, and a Custom place needs a name", async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    await api().post("/api/me/addresses").set(auth).send(place()).expect(201);
    const hall = await api().post("/api/me/addresses").set(auth).send(place({ label: "HALL" })).expect(201);

    const secondHome = await api().post("/api/me/addresses").set(auth).send(place());
    expect(secondHome.status).toBe(409);
    expect(secondHome.body.error.code).toBe("ADDRESS_LABEL_TAKEN");

    const hallToHome = await api().patch(`/api/me/addresses/${hall.body.address.id}`).set(auth).send({ label: "HOME" });
    expect(hallToHome.status).toBe(409);

    const unnamed = await api().post("/api/me/addresses").set(auth).send(place({ label: "CUSTOM" }));
    expect(unnamed.status).toBe(400);
    expect(unnamed.body.error.fields).toHaveProperty("customLabel");

    const hallToCustom = await api().patch(`/api/me/addresses/${hall.body.address.id}`).set(auth).send({ label: "CUSTOM" });
    expect(hallToCustom.status).toBe(400);

    // A name sent with Home is ignored.
    const work = await api().post("/api/me/addresses").set(auth).send(place({ label: "WORK", customLabel: "Office" }));
    expect(work.body.address.customLabel).toBeNull();
  });

  it(`stops at ${rules.savedAddresses.maxPerUser} addresses, also when requests arrive together`, async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    const max = rules.savedAddresses.maxPerUser;

    const responses = await Promise.all(
      Array.from({ length: max + 3 }, (_, i) =>
        api().post("/api/me/addresses").set(auth).send(place({ label: "CUSTOM", customLabel: `Place ${i}` })),
      ),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(max);
    expect(responses.filter((r) => r.status === 409).every((r) => r.body.error.code === "ADDRESS_LIMIT_REACHED")).toBe(true);
    expect(await prisma.savedAddress.count({ where: { userId: user.id } })).toBe(max);
  });

  it("only two requests for Home at the same moment: one succeeds", async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    const [a, b] = await Promise.all([
      api().post("/api/me/addresses").set(auth).send(place()),
      api().post("/api/me/addresses").set(auth).send(place()),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it("never shows or changes another user's address, and checks coordinates", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const created = await api().post("/api/me/addresses").set(bearer(owner.accessToken)).send(place());
    const id = created.body.address.id;

    expect((await api().get("/api/me/addresses").set(bearer(other.accessToken))).body.addresses).toEqual([]);
    expect((await api().patch(`/api/me/addresses/${id}`).set(bearer(other.accessToken)).send({ address: "x" })).status).toBe(404);
    expect((await api().delete(`/api/me/addresses/${id}`).set(bearer(other.accessToken))).status).toBe(404);
    expect((await api().delete("/api/me/addresses/not-a-uuid").set(bearer(other.accessToken))).status).toBe(400);

    const badLat = await api().post("/api/me/addresses").set(bearer(owner.accessToken)).send(place({ label: "WORK", lat: 91 }));
    expect(badLat.status).toBe(400);
  });
});

describe("my sub-areas", () => {
  async function subAreas(names: string[], isActive = true) {
    return Promise.all(names.map((name) => prisma.subArea.create({ data: { name, isActive } })));
  }

  it("searches the active master list only", async () => {
    const user = await registerUser();
    await subAreas(["Dhanmondi", "Mirpur 10", "Mirpur 2"]);
    await subAreas(["Mirpur DOHS"], false);

    const all = await api().get("/api/sub-areas").set(bearer(user.accessToken));
    const mirpur = await api().get("/api/sub-areas?q=mirpur").set(bearer(user.accessToken));

    expect(all.body.subAreas.map((s: { name: string }) => s.name)).toEqual(["Dhanmondi", "Mirpur 10", "Mirpur 2"]);
    expect(mirpur.body.subAreas.map((s: { name: string }) => s.name)).toEqual(["Mirpur 10", "Mirpur 2"]);
    expect((await api().get("/api/sub-areas")).status).toBe(401);
  });

  it("replaces the selection, ignores repeats and hides sub-areas an admin turned off", async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    const [a, b, c] = await subAreas(["Banani", "Gulshan", "Uttara"]);

    const first = await api().put("/api/me/sub-areas").set(auth).send({ subAreaIds: [a.id, b.id, a.id] });
    expect(first.status).toBe(200);
    expect(first.body.subAreas.map((s: { name: string }) => s.name)).toEqual(["Banani", "Gulshan"]);

    const second = await api().put("/api/me/sub-areas").set(auth).send({ subAreaIds: [b.id, c.id] });
    expect(second.body.subAreas.map((s: { name: string }) => s.name)).toEqual(["Gulshan", "Uttara"]);

    await prisma.subArea.update({ where: { id: c.id }, data: { isActive: false } });
    const mine = await api().get("/api/me/sub-areas").set(auth);
    expect(mine.body.subAreas.map((s: { name: string }) => s.name)).toEqual(["Gulshan"]);

    // Cannot pick an inactive or unknown sub-area.
    const inactive = await api().put("/api/me/sub-areas").set(auth).send({ subAreaIds: [c.id] });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.code).toBe("SUB_AREA_NOT_FOUND");
  });

  it(`allows at most ${rules.subAreas.maxPerUser}`, async () => {
    const user = await registerUser();
    const many = await subAreas(Array.from({ length: rules.subAreas.maxPerUser + 1 }, (_, i) => `Area ${i}`));

    const tooMany = await api()
      .put("/api/me/sub-areas")
      .set(bearer(user.accessToken))
      .send({ subAreaIds: many.map((s) => s.id) });
    expect(tooMany.status).toBe(400);

    const max = await api()
      .put("/api/me/sub-areas")
      .set(bearer(user.accessToken))
      .send({ subAreaIds: many.slice(0, rules.subAreas.maxPerUser).map((s) => s.id) });
    expect(max.status).toBe(200);
    expect(max.body.subAreas).toHaveLength(rules.subAreas.maxPerUser);
  });
});

describe("blocked users", () => {
  it("lists the users I blocked without email or phone, and unblocks them", async () => {
    const me = await registerUser();
    const blocked = await registerUser();
    const blockedMe = await registerUser();
    await prisma.block.createMany({
      data: [
        { blockerId: me.id, blockedId: blocked.id },
        { blockerId: blockedMe.id, blockedId: me.id },
      ],
    });

    const list = await api().get("/api/me/blocks").set(bearer(me.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.users).toEqual([
      expect.objectContaining({ id: blocked.id, name: "Test Student", photo: null, university: expect.any(Object) }),
    ]);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain(blocked.email);
    expect(text).not.toContain("+880");

    expect((await api().delete(`/api/me/blocks/${blocked.id}`).set(bearer(me.accessToken))).status).toBe(204);
    expect((await api().delete(`/api/me/blocks/${blocked.id}`).set(bearer(me.accessToken))).status).toBe(404);
    // A block someone else made is not mine to remove.
    expect((await api().delete(`/api/me/blocks/${blockedMe.id}`).set(bearer(me.accessToken))).status).toBe(404);
    expect(await prisma.block.count()).toBe(1);
  });
});
