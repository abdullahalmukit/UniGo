import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

const base = {
  DATABASE_URL: "mysql://user:pass@localhost:3306/unigo",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
};
const smtp = { SMTP_HOST: "smtp.example.com", SMTP_USER: "user", SMTP_PASSWORD: "pass", MAIL_FROM: "UniGo <a@b.c>" };

const failingKeys = (source: Record<string, string>) => {
  const result = parseEnv(source);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("email transport", () => {
  it("prints to the console in development unless EMAIL_TRANSPORT=smtp", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development" }).data?.emailTransport).toBe("console");
    expect(parseEnv({ ...base, NODE_ENV: "development", EMAIL_TRANSPORT: "smtp", ...smtp }).data?.emailTransport).toBe(
      "smtp",
    );
  });

  it("always uses the in-memory outbox in tests", () => {
    expect(parseEnv({ ...base, NODE_ENV: "test", EMAIL_TRANSPORT: "smtp" }).data?.emailTransport).toBe("memory");
  });

  it("always uses SMTP in production and refuses to start without the SMTP settings", () => {
    expect(parseEnv({ ...base, NODE_ENV: "production", ...smtp }).data?.emailTransport).toBe("smtp");
    expect(failingKeys({ ...base, NODE_ENV: "production" })).toEqual(["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"]);
    expect(failingKeys({ ...base, NODE_ENV: "production", ...smtp, EMAIL_TRANSPORT: "console" })).toEqual([
      "EMAIL_TRANSPORT",
    ]);
  });

  it("needs the SMTP settings when development opts in to SMTP", () => {
    expect(failingKeys({ ...base, NODE_ENV: "development", EMAIL_TRANSPORT: "smtp" })).toContain("SMTP_HOST");
  });
});

describe("other settings", () => {
  it("requires GOOGLE_CLIENT_ID and two different JWT secrets", () => {
    const { GOOGLE_CLIENT_ID: _omit, ...withoutGoogle } = base;

    expect(failingKeys(withoutGoogle)).toContain("GOOGLE_CLIENT_ID");
    expect(failingKeys({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toEqual(["JWT_REFRESH_SECRET"]);
  });

  it("turns token lifetimes into milliseconds", () => {
    const parsed = parseEnv({ ...base, JWT_ACCESS_EXPIRES_IN: "10m", JWT_REFRESH_EXPIRES_IN: "7d" }).data;

    expect(parsed?.JWT_ACCESS_EXPIRES_IN).toBe(10 * 60 * 1000);
    expect(parsed?.JWT_REFRESH_EXPIRES_IN).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
