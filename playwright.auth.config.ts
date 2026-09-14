import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "auth.spec.ts",
  use: { baseURL: "http://localhost:3001", channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined },
  webServer: { command: "npm run dev -- --webpack --port 3001", url: "http://localhost:3001", reuseExistingServer: false, timeout: 120_000, env: { DEMO_MODE: "false" } },
});
