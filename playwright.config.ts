import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "demo.spec.ts",
  use: { baseURL: "http://localhost:3000", channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined },
  webServer: { command: "npm run dev -- --webpack", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 120_000, env: { DEMO_MODE: "true" } },
});
