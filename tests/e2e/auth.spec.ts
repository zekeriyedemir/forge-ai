import { test, expect } from "@playwright/test";

test("dashboard redirects anonymous visitors to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome to the forge" })).toBeVisible();
});

test("workflow API rejects an anonymous request", async ({ request }) => {
  const response = await request.post(`/api/projects/${crypto.randomUUID()}/workflow`);
  expect(response.status()).toBe(401);
});

test("Approval Center redirects anonymous visitors before project lookup", async ({ page }) => {
  await page.goto(`/dashboard/projects/${crypto.randomUUID()}/approvals`);
  await expect(page).toHaveURL(/\/login$/);
});
