import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import { rules } from "../../config/rules.js";

const cost = env.NODE_ENV === "test" ? rules.auth.bcryptCostInTests : rules.auth.bcryptCost;

export function hashPassword(password: string) {
  return bcrypt.hash(password, cost);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | undefined;

// Runs a full bcrypt comparison when there is no account (or no password) to
// check, so login takes the same time whether or not the email exists.
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword("unigo-no-account-1");
  await bcrypt.compare(password, await dummyHash);
}
