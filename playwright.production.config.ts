import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "demo.spec.ts",
  use: { baseURL: "http://localhost:3100", channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined, trace: "retain-on-failure" },
  webServer: { command: "node scripts/start-production-playwright.mjs", url: "http://localhost:3100", reuseExistingServer: false, timeout: 120_000, env: { PORT: "3100", HOSTNAME: "127.0.0.1", AUTH_TRUST_HOST: "true", DEMO_MODE: "true", OPENAI_API_KEY: "", AUTH_GITHUB_ID: "", AUTH_GITHUB_SECRET: "" } },
});
