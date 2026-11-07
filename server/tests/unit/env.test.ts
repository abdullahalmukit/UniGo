import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

const base = {
  DATABASE_URL: "mysql://user:pass@localhost:3306/unigo",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  FILE_SIGNING_SECRET: "c".repeat(32),
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
};
const smtp = { SMTP_HOST: "smtp.example.com", SMTP_USER: "user", SMTP_PASSWORD: "pass", MAIL_FROM: "UniGo <a@b.c>" };
const vapid = { VAPID_PUBLIC_KEY: "public-key", VAPID_PRIVATE_KEY: "private-key", VAPID_SUBJECT: "mailto:admin@unigo.app" };

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
    expect(parseEnv({ ...base, NODE_ENV: "production", ...smtp, ...vapid }).data?.emailTransport).toBe("smtp");
    expect(failingKeys({ ...base, NODE_ENV: "production", ...vapid })).toEqual(["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"]);
    expect(failingKeys({ ...base, NODE_ENV: "production", ...smtp, ...vapid, EMAIL_TRANSPORT: "console" })).toEqual([
      "EMAIL_TRANSPORT",
    ]);
  });

  it("needs the SMTP settings when development opts in to SMTP", () => {
    expect(failingKeys({ ...base, NODE_ENV: "development", EMAIL_TRANSPORT: "smtp" })).toContain("SMTP_HOST");
  });
});

describe("web push (B2c)", () => {
  it("needs the three VAPID settings in production", () => {
    expect(failingKeys({ ...base, NODE_ENV: "production", ...smtp })).toEqual(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
    expect(parseEnv({ ...base, NODE_ENV: "production", ...smtp, ...vapid }).data?.pushTransport).toBe("webpush");
  });

  it("is off in development without keys, refuses half a key set, and uses memory in tests", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development" }).data?.pushTransport).toBe("off");
    expect(failingKeys({ ...base, NODE_ENV: "development", VAPID_PUBLIC_KEY: "x" })).toEqual(["VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
    expect(failingKeys({ ...base, NODE_ENV: "development", ...vapid, VAPID_SUBJECT: "admin@unigo.app" })).toContain("VAPID_SUBJECT");
    expect(parseEnv({ ...base, NODE_ENV: "test" }).data?.pushTransport).toBe("memory");
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

describe("FILE_SIGNING_SECRET", () => {
  it("is required, at least 32 characters and different from the JWT secrets", () => {
    const { FILE_SIGNING_SECRET: _omit, ...withoutSecret } = base;
    expect(failingKeys(withoutSecret)).toContain("FILE_SIGNING_SECRET");
    expect(failingKeys({ ...base, FILE_SIGNING_SECRET: "short" })).toContain("FILE_SIGNING_SECRET");
    expect(failingKeys({ ...base, FILE_SIGNING_SECRET: base.JWT_ACCESS_SECRET })).toEqual(["FILE_SIGNING_SECRET"]);
  });

  it("defaults the private storage folder", () => {
    expect(parseEnv(base).data?.PRIVATE_STORAGE_DIR).toBe("storage/private");
  });
});
