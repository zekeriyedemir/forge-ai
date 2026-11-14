import { test, expect } from "./fixtures";

test("project workflow persists outputs and owner can safely delete it", async ({ page, signedInUser }) => {
  test.setTimeout(120_000);
  await page.goto("/dashboard/projects");
  await page.getByLabel("Project name").fill("Playwright Pilot");
  await page.getByLabel("Business goal").fill("Build a SaaS that can reach one thousand monthly customers");
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page.getByRole("heading", { name: "Playwright Pilot", level: 1 })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
  const project = await signedInUser.db.project.findUniqueOrThrow({ where: { id: projectId }, include: { workspace: { include: { members: true } } } });
  expect(project.workspace.members.some(member => member.userId === signedInUser.id && member.role === "OWNER")).toBe(true);
  const updatedGoal = "Reach one thousand customers by validating a focused SaaS workflow";
  await page.getByLabel("Refine goal").fill(updatedGoal);
  await page.getByRole("button", { name: /Save goal/ }).click();
  await expect(page.getByRole("heading", { name: updatedGoal })).toBeVisible();
  await page.getByRole("button", { name: /Run Forge workflow/ }).click();
  await expect(page.getByText("5 of 5 agents complete")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Interview five prospective customers" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Initial strategy" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Metrics", exact: true }).click();
  await expect(page.getByText("Discovery interviews")).toBeVisible();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByText(/agent:/).first()).toBeVisible();
  await page.goto(`/dashboard/projects/${projectId}/settings`);
  const deleteButton = page.getByRole("button", { name: "Delete project permanently" });
  await expect(deleteButton).toBeDisabled();
  await page.getByLabel(/Type.*Playwright Pilot/).fill("Playwright Pilot");
  await deleteButton.click();
  await expect(page).toHaveURL(/\/dashboard\/projects(?:\?.*)?$/);
  expect(await signedInUser.db.project.findUnique({ where: { id: projectId } })).toBeNull();
  expect(await signedInUser.db.agentRun.count({ where: { projectId } })).toBe(0);
});

test("another workspace's project stays inaccessible", async ({ page, signedInUser }) => {
  const otherWorkspace = await signedInUser.db.workspace.create({ data: { name: "Other owner's workspace", projects: { create: { name: "Private project" } } }, include: { projects: true } });
  try {
    const id = otherWorkspace.projects[0].id;
    await page.goto(`/dashboard/projects/${id}`);
    // A streamed page can send HTTP 200 before notFound() resolves; assert the boundary and no private content.
    await expect(page.getByRole("heading", { name: "This page is out of reach." })).toBeVisible();
    await expect(page.getByText("Private project", { exact: true })).toHaveCount(0);
    const workflow = await page.request.post(`/api/projects/${id}/workflow`);
    expect(workflow.status()).toBe(404);
    expect(await signedInUser.db.project.count({ where: { id } })).toBe(1);
  } finally {
    await signedInUser.db.workspace.delete({ where: { id: otherWorkspace.id } });
  }
});

test("workflow failures show a safe, actionable cause and allow a fresh retry", async ({ page, signedInUser }) => {
  const workspace = await signedInUser.db.workspace.create({ data: { name: "Workflow error regression", members: { create: { userId: signedInUser.id, role: "OWNER" } }, projects: { create: { name: "Workflow recovery", goals: { create: { statement: "Validate a focused workflow for independent developers" } } } } }, include: { projects: true } });
  const projectId = workspace.projects[0].id;
  let starts = 0;
  let advances = 0;
  await page.route(`**/api/projects/${projectId}/workflow`, async route => {
    if (route.request().method() === "POST") {
      starts++;
      await route.fulfill(starts === 1
        ? { status: 503, json: { code: "RESEARCH_NOT_CONFIGURED", error: "private-provider-diagnostic" } }
        : { status: 200, json: { workflowId: crypto.randomUUID() } });
      return;
    }
    advances++;
    await route.fulfill({ status: 200, json: {
      failure: { code: "RESEARCH_UNAVAILABLE", message: "private-provider-diagnostic" },
      runs: [
        { type: "FOUNDER", status: "COMPLETED", error: null },
        { type: "RESEARCH", status: "FAILED", errorCode: "RESEARCH_UNAVAILABLE", error: "private-provider-diagnostic" },
        ...["FOUNDER", "DEVELOPER", "ANALYST"].map(type => ({ type, status: "FAILED", error: "Skipped because an earlier agent failed" })),
      ],
    } });
  });
  await page.goto(`/dashboard/projects/${projectId}`);
  const runButton = page.getByRole("button", { name: "Run Forge workflow" });
  const workflowAlert = page.locator('.notice[role="alert"]');
  await runButton.click();
  await expect(workflowAlert).toContainText("Research is not configured.");
  await expect(workflowAlert).not.toContainText("private-provider-diagnostic");
  await runButton.click();
  await expect(workflowAlert).toContainText("npm run research:start");
  await expect(workflowAlert).not.toContainText("private-provider-diagnostic");
  await expect(workflowAlert).not.toContainText("lost the workflow connection");
  await expect(page.getByText("1 of 5 agents complete")).toBeVisible();
  await expect(page.getByRole("link", { name: "View agent history" })).toHaveAttribute("href", `/dashboard/projects/${projectId}/agents`);
  await expect(runButton).toBeEnabled();
  expect(starts).toBe(2);
  expect(advances).toBe(1);
});
