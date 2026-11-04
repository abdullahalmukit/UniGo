import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { api, createUniversity, registerUser, registrationBody } from "./helpers.js";

const { login, register, refresh } = rules.auth.rateLimits;

describe("auth rate limits", () => {
  it(`allows ${login.max} login attempts per IP and email, then answers RATE_LIMITED`, async () => {
    const user = await registerUser();
    const attempt = (email: string) => api().post("/api/auth/login").send({ email, password: "wrong1234" });

    for (let i = 0; i < login.max; i++) {
      expect((await attempt(user.email)).status).toBe(401);
    }
    const blocked = await attempt(user.email.toUpperCase());

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    // Another email from the same IP has its own counter.
    expect((await attempt("someone.else@example.com")).status).toBe(401);
  });

  it(`allows ${register.max} registrations per IP, then answers RATE_LIMITED`, async () => {
    const university = await createUniversity();
    for (let i = 0; i < register.max; i++) {
      expect((await api().post("/api/auth/register").send(registrationBody(university.id))).status).toBe(201);
    }

    const blocked = await api().post("/api/auth/register").send(registrationBody(university.id));

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });

  it(`allows ${refresh.max} refresh calls per IP, then answers RATE_LIMITED`, async () => {
    for (let i = 0; i < refresh.max; i++) {
      expect((await api().post("/api/auth/refresh")).status).toBe(401);
    }

    const blocked = await api().post("/api/auth/refresh");

    expect(blocked.status).toBe(429);
  });
});
