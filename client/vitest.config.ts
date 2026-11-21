import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Form tests type and click a lot; under a full parallel run (28 jsdom
    // files) 5 s was too tight and failed at random.
    testTimeout: 15_000,
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
