import request from "supertest";
import { app } from "../../src/app.js";
import type { AccountStatus, StudentVerificationStatus, UserRole } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/lib/prisma.js";

export const api = () => request(app);

export const PASSWORD = "secret123";

let counter = 0;

export async function createUniversity(isActive = true) {
  counter += 1;
  return prisma.university.create({ data: { name: `University ${counter}`, isActive } });
}

export function registrationBody(universityId: string, overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    name: "Test Student",
    phone: `0171${String(counter).padStart(7, "0")}`,
    email: `student${counter}@example.com`,
    universityId,
    password: PASSWORD,
    ...overrides,
  };
}

// Registers a user through the API and optionally adjusts the account directly.
export async function registerUser(
  overrides: {
    role?: UserRole;
    accountStatus?: AccountStatus;
    suspendedUntil?: Date | null;
    studentVerificationStatus?: StudentVerificationStatus;
  } = {},
) {
  const university = await createUniversity();
  const body = registrationBody(university.id);
  const response = await api().post("/api/auth/register").send(body);
  if (response.status !== 201) throw new Error(`Register failed: ${JSON.stringify(response.body)}`);

  if (Object.keys(overrides).length > 0) {
    await prisma.user.update({ where: { id: response.body.user.id }, data: overrides });
  }

  return {
    id: response.body.user.id as string,
    email: body.email,
    accessToken: response.body.accessToken as string,
    refreshCookie: refreshCookie(response.headers["set-cookie"]),
  };
}

// The "unigo_refresh=..." pair from a Set-Cookie header, ready for a Cookie header.
export function refreshCookie(setCookie: string | string[] | undefined) {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies.find((value) => value.startsWith("unigo_refresh="));
  if (!cookie) throw new Error("No refresh cookie was set");
  return cookie.split(";")[0];
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
