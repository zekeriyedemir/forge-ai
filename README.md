# Forge AI

Forge AI is a business-building command center. A founder enters a goal, and four coordinated agents create strategy, research outlines, an MVP plan, tasks, reports, and progress metrics. This V1 does not claim to autonomously create revenue.

## Screenshots

Screenshots can be captured from the running landing page and project dashboard. None are included yet.

## Stack and architecture

Next.js App Router, React, strict TypeScript, Tailwind CSS, PostgreSQL, Prisma, Auth.js with GitHub OAuth, Zod, Vitest, and Playwright. See [architecture](docs/architecture.md), [agents](docs/agents.md), and [database](docs/database.md).

## Local setup

1. Install Node.js 22+ (`.nvmrc`) and PostgreSQL 16. If Docker is available, `docker compose up -d db` starts a disposable local database.
2. Run `cp .env.example .env`. Replace `AUTH_SECRET` with a random value of at least 32 characters (for example, `openssl rand -base64 33`). Keep `.env` private. Prisma CLI and the seed script read `.env`; Next.js reads it too.
3. Set both `DATABASE_URL` and `DIRECT_URL` in `.env` to the local PostgreSQL URL. They may be identical locally. Run `npm ci` (which generates Prisma Client), then `npm run db:migrate`. Optional: `npm run db:seed` adds an example project.
4. Run `npm run dev` and open http://localhost:3000.

For a credential-free demo, set `DEMO_MODE=true` and leave `OPENAI_API_KEY` empty. Demo mode uses a shared, disposable account and deterministic, labeled output; it does not perform live market research. Keep it off for private production data. If `DEMO_MODE=false` and no AI key is set, workflows fail with a configuration message instead of silently using mock output.

For live AI, set `OPENAI_API_KEY` and choose an OpenAI-compatible `OPENAI_BASE_URL` and `OPENAI_MODEL` that support Chat Completions JSON mode. The key stays on the server. Forge validates each complete result with Zod, retries malformed structured output once, and records a failed run if it remains invalid. No real AI call is needed to run tests. To smoke-test your own provider, use a disposable project, start a workflow, and inspect its run status, events, tasks, reports, and metric keys; automated tests use fake responses.

GitHub login requires `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` from a GitHub OAuth app. Add `http://localhost:3000/api/auth/callback/github` as its local callback. Auth.js v5 infers the normal host, so `AUTH_URL` is usually unnecessary. After signing in, open **Dashboard → Integrations** to see your authorized public and private repositories even before creating a project. Create a project to link one. A demo-only session cannot access GitHub repositories. Signed-in project owners can permanently delete a project under **Project → Settings** by typing its exact name; deletion also removes its goals, workflows, tasks, reports, metrics, activity, and repository link. See [deployment](docs/deployment.md) for production callback setup.

To let the Developer Agent work on a linked repository, configure a live AI provider, a GitHub OAuth login with `repo` access, and at least one GitHub CI check. Run the existing workflow to create tasks, then open **Project → Approval Center** and select a task. Review the exact proposed files and risks before approving implementation. Forge opens a real feature branch, commit, and PR; after CI passes, approve the separate merge request if you want Forge to merge. Forge never executes model-generated shell commands. See [Developer execution](docs/agents.md#developer-repository-execution) for limits, recovery, and the manual test.

## Validation and deployment

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Playwright demo tests (`npm run test:e2e`) require a migrated local database and Chromium (`npx playwright install chromium`); anonymous protection checks (`npm run test:e2e:auth`) need a browser but no database queries. To use an installed Chrome instead of Playwright's Chromium, set `PLAYWRIGHT_BROWSER_CHANNEL=chrome`. GitHub Actions runs lint, typecheck, unit tests, and the production build. See [security](docs/security.md), [deployment](docs/deployment.md), and [roadmap](docs/roadmap.md).

The opt-in agent output integration test uses a fake AI provider and temporary database records: `RUN_DB_INTEGRATION=true node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration/agent-output.test.ts`. It makes no paid AI request; run it only against a database where creating and deleting a temporary project is acceptable.

The optional cascade integration test creates and removes temporary records in the configured database. Run it only against a database where that is acceptable: `RUN_DB_INTEGRATION=true node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration/project-delete.test.ts`.
