import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), auth: vi.fn(), account: vi.fn(), projects: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/access", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/db", () => ({ db: { account: { findFirst: mocks.account }, project: { findMany: mocks.projects } } }));
vi.mock("@/components/repository-picker", () => ({ RepositoryPicker: ({ projects }: { projects: unknown[] }) => React.createElement("div", { "data-project-count": projects.length }, "RepositoryPicker") }));
import Integrations from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue("signed-in-user"); mocks.auth.mockResolvedValue({ user: { id: "signed-in-user" } }); });

describe("GitHub integrations page", () => {
  it("shows the repository loader to a newly signed-in user with no projects", async () => {
    mocks.account.mockResolvedValue({ userId: "signed-in-user" });
    mocks.projects.mockResolvedValue([]);
    const markup = renderToStaticMarkup(await Integrations());
    expect(markup).toContain("RepositoryPicker");
    expect(markup).toContain('data-project-count="0"');
  });

  it("does not show the loader without a linked GitHub account", async () => {
    mocks.account.mockResolvedValue(null);
    mocks.projects.mockResolvedValue([]);
    const markup = renderToStaticMarkup(await Integrations());
    expect(markup).not.toContain("RepositoryPicker");
    expect(markup).toContain("Go to login");
  });
});
