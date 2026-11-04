import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../../src/modules/auth/password.js";

describe("password hashing", () => {
  it("uses bcrypt cost 12 outside tests", () => {
    expect(rules.auth.bcryptCost).toBe(12);
  });

  it("hashes with bcrypt and verifies only the right password", async () => {
    const hash = await hashPassword("secret123");

    expect(bcrypt.getRounds(hash)).toBe(rules.auth.bcryptCostInTests);
    expect(await verifyPassword("secret123", hash)).toBe(true);
    expect(await verifyPassword("secret124", hash)).toBe(false);
  });

  it("can run a comparison when there is no account to check", async () => {
    await expect(burnPasswordCheck("anything1")).resolves.toBeUndefined();
  });
});
