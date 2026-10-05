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

test("Research evidence redirects anonymous visitors before project lookup", async ({ page }) => {
  await page.goto(`/dashboard/projects/${crypto.randomUUID()}/research`);
  await expect(page).toHaveURL(/\/login$/);
});

test("public sample is interactive without signing in", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Your next idea, organized." })).toBeVisible();
  await expect(page.getByText("Read-only sample.")).toBeVisible();
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build the repository overview" })).toBeVisible();
  await page.getByRole("tab", { name: "Tasks", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Reports", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Build one useful workflow first." })).toBeVisible();
});

test("public pages fit a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/login", "/demo"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
