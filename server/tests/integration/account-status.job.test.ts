import { describe, expect, it } from "vitest";
import { runAccountStatusJob } from "../../src/jobs/account-status.job.js";
import { prisma } from "../../src/lib/prisma.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";
import { registerUser } from "./helpers.js";

const HOUR = 60 * 60 * 1000;
const at = (ms: number) => new Date(Date.now() + ms);
const stored = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

describe("account status job", () => {
  it("ends a suspension at its end date and emails the user, once", async () => {
    const user = await registerUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: "SUSPENDED", suspendedFrom: at(-2 * HOUR), suspendedUntil: at(-1000) },
    });

    const first = await runAccountStatusJob();
    const second = await runAccountStatusJob();
    await settleBackgroundTasks();

    expect(first.suspensionsEnded).toBe(1);
    expect(second.suspensionsEnded).toBe(0);
    expect(await stored(user.id)).toMatchObject({ accountStatus: "ACTIVE", suspendedFrom: null, suspendedUntil: null });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toBe("Your UniGo suspension has ended");
  });

  it("leaves a suspension that has not ended", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { accountStatus: "SUSPENDED", suspendedUntil: at(HOUR) } });

    await runAccountStatusJob();

    expect((await stored(user.id)).accountStatus).toBe("SUSPENDED");
  });

  it("starts a booked suspension at its start date, without an email", async () => {
    const user = await registerUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: "RESTRICTED", suspendedFrom: at(-1000), suspendedUntil: at(HOUR) },
    });
    const notYet = await registerUser();
    await prisma.user.update({ where: { id: notYet.id }, data: { suspendedFrom: at(HOUR), suspendedUntil: at(2 * HOUR) } });

    const result = await runAccountStatusJob();
    await settleBackgroundTasks();

    expect(result.started).toBe(1);
    expect(await stored(user.id)).toMatchObject({ accountStatus: "SUSPENDED", restrictedUntil: null });
    expect((await stored(notYet.id)).accountStatus).toBe("ACTIVE");
    expect(sentEmails).toHaveLength(0);
  });

  it("ends a restriction with an end date, and keeps one without", async () => {
    const timed = await registerUser();
    const open = await registerUser();
    await prisma.user.update({ where: { id: timed.id }, data: { accountStatus: "RESTRICTED", restrictedUntil: at(-1000) } });
    await prisma.user.update({ where: { id: open.id }, data: { accountStatus: "RESTRICTED" } });

    const result = await runAccountStatusJob();
    await settleBackgroundTasks();

    expect(result.restrictionsEnded).toBe(1);
    expect(await stored(timed.id)).toMatchObject({ accountStatus: "ACTIVE", restrictedUntil: null });
    expect((await stored(open.id)).accountStatus).toBe("RESTRICTED");
    expect(sentEmails.map((email) => email.subject)).toEqual(["Your UniGo restriction has ended"]);
  });

  it("never touches a banned account", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { accountStatus: "BANNED", restrictedUntil: at(-1000) } });

    await runAccountStatusJob();

    expect((await stored(user.id)).accountStatus).toBe("BANNED");
  });
});
