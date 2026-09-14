import { test, expect } from "@playwright/test";

test("demo project workflow creates tasks and reports", async ({ page }) => {
  await page.goto("/dashboard/projects");
  await page.getByLabel("Project name").fill("Playwright Pilot");
  await page.getByLabel("Business goal").fill("Build a SaaS that can reach one thousand monthly customers");
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page.getByText("Playwright Pilot")).toBeVisible();
  const updatedGoal = "Reach one thousand customers by validating a focused SaaS workflow";
  await page.getByLabel("Refine goal").fill(updatedGoal);
  await page.getByRole("button", { name: /Save goal/ }).click();
  await expect(page.getByRole("heading", { name: updatedGoal })).toBeVisible();
  await page.getByRole("button", { name: /Run Forge workflow/ }).click();
  await expect(page.getByText("5 of 5 agents complete")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByText("Interview five prospective customers")).toBeVisible();
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByText("Initial strategy")).toBeVisible();
  await page.getByRole("link", { name: "Metrics" }).click();
  await expect(page.getByText("Discovery interviews")).toBeVisible();
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByText(/agent:/).first()).toBeVisible();
});
