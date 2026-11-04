import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";
import { api, bearer, PASSWORD, registerUser } from "./helpers.js";

const HOUR = 60 * 60 * 1000;
const superAdmin = () => registerUser({ role: "SUPER_ADMIN" });

const act = (token: string, userId: string, action: string, body: Record<string, unknown> = { reason: "Broke the rules" }) =>
  api().post(`/api/admin/users/${userId}/${action}`).set(bearer(token)).send(body);

const statusOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).accountStatus;

describe("admin users: access", () => {
  it("lets moderators read users but not act on them", async () => {
    const moderator = await registerUser({ role: "MODERATOR" });
    const target = await registerUser();

    expect((await api().get("/api/admin/users").set(bearer(moderator.accessToken))).status).toBe(200);
    expect((await api().get(`/api/admin/users/${target.id}`).set(bearer(moderator.accessToken))).status).toBe(200);
    for (const action of ["warn", "restrict", "ban", "unban", "reactivate"]) {
      const response = await act(moderator.accessToken, target.id, action);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }
    expect(await prisma.moderationAction.count()).toBe(0);
  });

  it("refuses normal users everywhere in the admin API", async () => {
    const user = await registerUser();
    for (const path of ["/api/admin/dashboard", "/api/admin/users", "/api/admin/sub-areas", "/api/admin/audit-logs"]) {
      expect((await api().get(path).set(bearer(user.accessToken))).status).toBe(403);
    }
    expect((await api().get("/api/admin/dashboard")).status).toBe(401);
  });
});

describe("admin users: list and detail", () => {
  it("searches by name, email, phone or student ID, and filters", async () => {
    const admin = await superAdmin();
    const rahim = await registerUser();
    await prisma.profile.update({ where: { userId: rahim.id }, data: { fullName: "Rahim Uddin", studentIdNumber: "221-15-999" } });
    const banned = await registerUser({ accountStatus: "BANNED" });

    const search = async (query: string) =>
      (await api().get(`/api/admin/users?${query}`).set(bearer(admin.accessToken))).body;

    expect((await search("q=rahim")).items.map((u: { id: string }) => u.id)).toEqual([rahim.id]);
    expect((await search("q=221-15-999")).items[0].id).toBe(rahim.id);
    expect((await search(`q=${encodeURIComponent(rahim.email)}`)).items[0].id).toBe(rahim.id);
    expect((await search("accountStatus=BANNED")).items.map((u: { id: string }) => u.id)).toEqual([banned.id]);
    expect((await search("role=SUPER_ADMIN")).total).toBe(1);
    expect((await search(`universityId=${rahim.universityId}`)).total).toBe(1);
    expect((await api().get("/api/admin/users?accountStatus=NOPE").set(bearer(admin.accessToken))).body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("shows a user's profile, verifications and moderation history, newest first", async () => {
    const admin = await superAdmin();
    const target = await registerUser();
    await act(admin.accessToken, target.id, "warn", { reason: "First warning" });
    await act(admin.accessToken, target.id, "warn", { reason: "Second warning" });

    const response = await api().get(`/api/admin/users/${target.id}`).set(bearer(admin.accessToken));

    expect(response.status).toBe(200);
    const { user } = response.body;
    expect(user).toMatchObject({ id: target.id, email: target.email, accountStatus: "ACTIVE", profile: { fullName: "Test Student" } });
    expect(user.moderationHistory.map((m: { reason: string }) => m.reason)).toEqual(["Second warning", "First warning"]);
    expect(user.moderationHistory[0].admin.id).toBe(admin.id);
    expect(user).not.toHaveProperty("passwordHash");
    expect((await api().get("/api/admin/users/00000000-0000-7000-8000-000000000000").set(bearer(admin.accessToken))).body.error.code).toBe(
      "USER_NOT_FOUND",
    );
  });
});

describe("admin users: actions", () => {
  it("warns: history, audit and email, without changing the status", async () => {
    const admin = await superAdmin();
    const target = await registerUser({ language: "BN" });

    const response = await act(admin.accessToken, target.id, "warn", { reason: "Rude in chat" });
    await settleBackgroundTasks();

    expect(response.status).toBe(200);
    expect(await statusOf(target.id)).toBe("ACTIVE");
    const history = await prisma.moderationAction.findFirstOrThrow({ where: { userId: target.id } });
    expect(history).toMatchObject({ type: "WARN", reason: "Rude in chat", adminId: admin.id, previousStatus: "ACTIVE", newStatus: "ACTIVE" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetUserId: target.id } });
    expect(audit).toMatchObject({ action: "USER_WARN", targetType: "user", adminId: admin.id });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(target.email);
    expect(sentEmails[0].subject).toBe("আপনার UniGo অ্যাকাউন্টে একটি সতর্কতা");
    expect(sentEmails[0].text).toContain("Rude in chat");
  });

  it("needs a reason for every action", async () => {
    const admin = await superAdmin();
    const target = await registerUser();
    for (const action of ["warn", "restrict", "suspend", "ban", "unban", "reactivate"]) {
      const response = await act(admin.accessToken, target.id, action, {});
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("restricts with an optional end date; a restricted user cannot create but can still log in", async () => {
    const admin = await superAdmin();
    const forever = await registerUser();
    const forADay = await registerUser();
    const endsAt = new Date(Date.now() + 24 * HOUR);

    expect((await act(admin.accessToken, forever.id, "restrict")).body.accountStatus).toBe("RESTRICTED");
    const timed = await act(admin.accessToken, forADay.id, "restrict", { reason: "Spam", endsAt: endsAt.toISOString() });

    expect(timed.body).toMatchObject({ accountStatus: "RESTRICTED", endsAt: endsAt.toISOString() });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: forADay.id } })).restrictedUntil?.toISOString()).toBe(endsAt.toISOString());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: forever.id } })).restrictedUntil).toBeNull();
    const login = await api().post("/api/auth/login").send({ email: forever.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.accountStatus).toBe("RESTRICTED");

    const past = await act(admin.accessToken, forever.id, "restrict", { reason: "Spam", endsAt: new Date(Date.now() - HOUR).toISOString() });
    expect(past.body.error.code).toBe("INVALID_DATES");
  });

  it("suspends now: the user is locked out of the API, refresh and login", async () => {
    const admin = await superAdmin();
    const target = await registerUser();
    const endsAt = new Date(Date.now() + 48 * HOUR);

    const response = await act(admin.accessToken, target.id, "suspend", { reason: "Harassment", endsAt: endsAt.toISOString() });
    await settleBackgroundTasks();

    expect(response.body.accountStatus).toBe("SUSPENDED");
    expect(await statusOf(target.id)).toBe("SUSPENDED");
    const history = await prisma.moderationAction.findFirstOrThrow({ where: { userId: target.id } });
    expect(history.endsAt?.toISOString()).toBe(endsAt.toISOString());
    expect(history.startsAt).not.toBeNull();

    expect((await api().get("/api/auth/me").set(bearer(target.accessToken))).body.error.code).toBe("ACCOUNT_SUSPENDED");
    expect((await api().post("/api/auth/refresh").set("Cookie", target.refreshCookie)).body.error.code).toBe("ACCOUNT_SUSPENDED");
    expect((await api().post("/api/auth/login").send({ email: target.email, password: PASSWORD })).body.error.code).toBe(
      "ACCOUNT_SUSPENDED",
    );
    expect(sentEmails.at(-1)!.subject).toBe("Your UniGo account is suspended");
  });

  it("books a suspension for later, which applies only from its start date", async () => {
    const admin = await superAdmin();
    const target = await registerUser();
    const startsAt = new Date(Date.now() + 2 * HOUR);
    const endsAt = new Date(Date.now() + 26 * HOUR);

    const response = await act(admin.accessToken, target.id, "suspend", {
      reason: "Repeated no-shows",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });

    expect(response.body).toMatchObject({ accountStatus: "SUSPENDED", startsAt: startsAt.toISOString() });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored).toMatchObject({ accountStatus: "ACTIVE", suspendedFrom: startsAt, suspendedUntil: endsAt });
    expect((await api().get("/api/auth/me").set(bearer(target.accessToken))).status).toBe(200);

    // Once the start date has passed, the stored dates already lock the user out.
    await prisma.user.update({ where: { id: target.id }, data: { suspendedFrom: new Date(Date.now() - 1000) } });
    expect((await api().get("/api/auth/me").set(bearer(target.accessToken))).body.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("refuses suspension dates in the past or an end before the start", async () => {
    const admin = await superAdmin();
    const target = await registerUser();
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();

    const pastStart = await act(admin.accessToken, target.id, "suspend", { reason: "x".repeat(5), startsAt: at(-2 * HOUR), endsAt: at(HOUR) });
    const endFirst = await act(admin.accessToken, target.id, "suspend", { reason: "x".repeat(5), startsAt: at(2 * HOUR), endsAt: at(HOUR) });

    expect(pastStart.body.error.code).toBe("INVALID_DATES");
    expect(endFirst.body.error.code).toBe("INVALID_DATES");
    expect(await statusOf(target.id)).toBe("ACTIVE");
  });

  it("bans and unbans", async () => {
    const admin = await superAdmin();
    const target = await registerUser();

    expect((await act(admin.accessToken, target.id, "ban")).body.accountStatus).toBe("BANNED");
    expect((await api().get("/api/auth/me").set(bearer(target.accessToken))).body.error.code).toBe("ACCOUNT_BANNED");
    expect((await act(admin.accessToken, target.id, "ban")).body.error.code).toBe("INVALID_STATUS_CHANGE");
    expect((await act(admin.accessToken, target.id, "reactivate")).body.error.code).toBe("INVALID_STATUS_CHANGE");

    expect((await act(admin.accessToken, target.id, "unban", { reason: "Appeal accepted" })).body.accountStatus).toBe("ACTIVE");
    expect((await api().get("/api/auth/me").set(bearer(target.accessToken))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { targetUserId: target.id, action: { in: ["USER_BAN", "USER_UNBAN"] } } })).toBe(2);
  });

  it("reactivates early: lifts a restriction, a suspension, or a booked suspension", async () => {
    const admin = await superAdmin();
    const restricted = await registerUser();
    const suspended = await registerUser();
    const booked = await registerUser();
    const active = await registerUser();
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();

    await act(admin.accessToken, restricted.id, "restrict");
    await act(admin.accessToken, suspended.id, "suspend", { reason: "Abuse", endsAt: at(HOUR) });
    await act(admin.accessToken, booked.id, "suspend", { reason: "Abuse", startsAt: at(HOUR), endsAt: at(2 * HOUR) });

    for (const user of [restricted, suspended, booked]) {
      expect((await act(admin.accessToken, user.id, "reactivate", { reason: "Lifted early" })).body.accountStatus).toBe("ACTIVE");
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored).toMatchObject({ accountStatus: "ACTIVE", suspendedFrom: null, suspendedUntil: null, restrictedUntil: null });
    }
    expect((await act(admin.accessToken, active.id, "reactivate")).body.error.code).toBe("INVALID_STATUS_CHANGE");
    expect((await act(admin.accessToken, active.id, "unban")).body.error.code).toBe("INVALID_STATUS_CHANGE");
  });

  it("never acts on the admin's own account or on a Super Admin", async () => {
    const admin = await superAdmin();
    const other = await superAdmin();
    const moderator = await registerUser({ role: "MODERATOR" });

    expect((await act(admin.accessToken, admin.id, "warn")).body.error.code).toBe("CANNOT_MODERATE_SELF");
    expect((await act(admin.accessToken, other.id, "ban")).body.error.code).toBe("CANNOT_MODERATE_ADMIN");
    expect((await act(admin.accessToken, moderator.id, "restrict")).status).toBe(200);
  });

  it("lets only one of two admins change the same account at the same moment", async () => {
    const [first, second] = [await superAdmin(), await superAdmin()];
    const target = await registerUser();

    const responses = await Promise.all([
      act(first.accessToken, target.id, "ban", { reason: "Fraud" }),
      act(second.accessToken, target.id, "restrict", { reason: "Spam" }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.moderationAction.count({ where: { userId: target.id } })).toBe(1);
  });
});
