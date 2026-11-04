import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

// Fixed secrets so tests never depend on server/.env.
const testEnv = {
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789",
  JWT_REFRESH_SECRET: "test-refresh-secret-0123456789abcdef012345678",
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  CLIENT_URL: "http://localhost:5173",
};

// Integration tests use the database in server/.env.test (gitignored).
const testDatabaseUrl = existsSync(".env.test") ? parse(readFileSync(".env.test")).DATABASE_URL ?? "" : "";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          // Unit tests never touch a database; this only satisfies env validation.
          env: {
            ...testEnv,
            DATABASE_URL: "mysql://test:test@localhost:3306/unigo_test",
            // Short, so the "database never answers" test finishes quickly.
            DATABASE_CONNECT_TIMEOUT_MS: "200",
          },
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          env: { ...testEnv, DATABASE_URL: testDatabaseUrl },
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          // One shared database, emptied before every test.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
