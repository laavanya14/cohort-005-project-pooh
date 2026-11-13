import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// `npm run test:knock`: the opt-in tests that call Knock's development
// environment for real. They skip unless KNOCK_SECRET_KEY (and the rest of
// the Knock config) is set, in the shell or in .env. They are not part of
// `npm run test`, whose setup file removes the keys.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["**/*.knock.test.ts"],
    testTimeout: 30_000,
  },
});
