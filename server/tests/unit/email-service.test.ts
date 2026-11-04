import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmailInBackground, sentEmails } from "../../src/modules/email/email.service.js";
import { runInBackground, settleBackgroundTasks } from "../../src/utils/background.js";

afterEach(() => {
  sentEmails.length = 0;
  vi.restoreAllMocks();
});

describe("email service under NODE_ENV=test", () => {
  it("puts emails in the in-memory outbox and prints nothing", async () => {
    const log = vi.spyOn(console, "log");

    sendEmailInBackground("test", { to: "a@example.com", subject: "Hello", text: "Body", html: "<p>Body</p>" });
    await settleBackgroundTasks();

    expect(sentEmails).toEqual([{ to: "a@example.com", subject: "Hello", text: "Body", html: "<p>Body</p>" }]);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("runInBackground", () => {
  it("logs a failure by label and error message only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    runInBackground("send reset", async () => {
      throw new Error("SMTP connection refused");
    });
    await settleBackgroundTasks();

    expect(error).toHaveBeenCalledWith('Background task "send reset" failed: SMTP connection refused');
  });

  it("waits for work started by other background work", async () => {
    const done: string[] = [];

    runInBackground("outer", async () => {
      runInBackground("inner", async () => {
        done.push("inner");
      });
      done.push("outer");
    });
    await settleBackgroundTasks();

    expect(done).toEqual(["outer", "inner"]);
  });
});
