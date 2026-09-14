# Forge AI

Forge AI is a business-building command center. A founder enters a goal, and four coordinated agents create strategy, research outlines, an MVP plan, tasks, reports, and progress metrics. This V1 does not claim to autonomously create revenue.

## Screenshots

Screenshots can be captured from the running landing page and project dashboard. None are included yet.

## Stack and architecture

Next.js App Router, React, strict TypeScript, Tailwind CSS, PostgreSQL, Prisma, Auth.js with GitHub OAuth, Zod, Vitest, and Playwright. See [architecture](docs/architecture.md), [agents](docs/agents.md), and [database](docs/database.md).

## Local setup

1. Install Node.js 22 or newer and PostgreSQL 16 (or run `docker compose up -d db`).
2. Run `npm ci` and copy `.env.example` to `.env.local`. Set `DATABASE_URL` and a random `AUTH_SECRET` of at least 32 characters.
3. Run `npx prisma generate`, `npm run db:dev`, and optionally `npm run db:seed`.
4. Run `npm run dev` and open http://localhost:3000.

For a demo without paid AI credentials, leave `OPENAI_API_KEY` empty and set `DEMO_MODE=true`. Demo output is deterministic and labeled; it does not perform real market research. A real provider uses `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` through the OpenAI-compatible Chat Completions API.

GitHub OAuth needs `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and `AUTH_URL`. Set the GitHub OAuth callback to `http://localhost:3000/api/auth/callback/github` locally. Sign in with GitHub to list available repositories and link one to a project. Demo sessions cannot list repositories because they have no GitHub token.

## Validation and deployment

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Playwright (`npm run test:e2e`) requires a migrated local PostgreSQL database and a Chromium installation. GitHub Actions runs the unit and build checks. See [security](docs/security.md), [deployment](docs/deployment.md), and [roadmap](docs/roadmap.md).
