import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "demo.spec.ts",
  use: { baseURL: "http://localhost:3100", channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined, trace: "retain-on-failure" },
  webServer: { command: "npm run dev -- --webpack --port 3100", url: "http://localhost:3100", reuseExistingServer: false, timeout: 120_000, env: { DEMO_MODE: "true", OPENAI_API_KEY: "", AUTH_GITHUB_ID: "", AUTH_GITHUB_SECRET: "" } },
});
