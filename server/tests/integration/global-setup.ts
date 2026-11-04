import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

// Runs once before the integration tests: checks the test database URL in
// server/.env.test and applies every migration to that database.
export default function setup() {
  const url = existsSync(".env.test") ? parse(readFileSync(".env.test")).DATABASE_URL : undefined;
  if (!url) {
    throw new Error("Integration tests need server/.env.test with DATABASE_URL (see README, Running tests).");
  }
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("The integration test database name must end in _test, because every test empties it.");
  }

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
