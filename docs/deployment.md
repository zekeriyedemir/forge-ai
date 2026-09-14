# Deployment

Provision PostgreSQL (including Neon), set variables from `.env.example`, and run `npm ci`, `npx prisma generate`, and `npm run db:migrate`. Start with `npm run build && npm run start` or build the Dockerfile. Configure a GitHub OAuth app callback URL as `https://YOUR_DOMAIN/api/auth/callback/github`. Use a dedicated database and `DEMO_MODE=true` only for a public demo.

The Docker image expects `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and optionally `OPENAI_API_KEY` at runtime. Run migrations before starting the web container. CI runs lint, typecheck, unit tests, and a production build; Playwright is manual because it needs a running PostgreSQL database.
