# Deployment

## Neon database

Create a Neon project and copy its **pooled** PostgreSQL connection string into `DATABASE_URL` and its **direct** connection string into `DIRECT_URL`. Keep Neon-provided SSL parameters such as `sslmode=require`. Prisma Client uses `DATABASE_URL` at runtime; Prisma Migrate uses `DIRECT_URL`. For local PostgreSQL both values can be the same. Do not commit either URL.

After setting both variables in your shell or private `.env`, run `npm ci`, `npm run db:migrate`, and optionally `npm run db:seed` for a disposable demo database. Run migrations against the target database before routing traffic to the new deployment. Do not point preview deployments at a production database. `prisma migrate dev` is for schema development, while `prisma migrate deploy` applies committed migrations.

## GitHub OAuth and Auth.js

Create a GitHub OAuth app with callback `https://YOUR_DOMAIN/api/auth/callback/github`. Set its client ID and secret as `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`. For local development use `http://localhost:3000/api/auth/callback/github`; GitHub supports multiple explicit callback URLs, or use separate OAuth apps for local and production. Auth.js v5 infers the normal host on Vercel, so do not set `AUTH_URL` to localhost in production. Only set `AUTH_URL` for a custom base path. Set a fresh, random `AUTH_SECRET` of at least 32 characters in every environment. Vercel host trust is detected automatically; set `AUTH_TRUST_HOST=true` only when self-hosting behind a trusted reverse proxy.

The GitHub OAuth scope includes `repo` so the app can list private repositories. Forge does not write to GitHub repositories. If GitHub issues expiring OAuth tokens, Forge rotates them using the stored refresh token. A revoked or expired refresh token requires signing out and signing in again.

## AI and demo behavior

Set `OPENAI_API_KEY` for a live provider, with `OPENAI_BASE_URL` (default `https://api.openai.com/v1`) and `OPENAI_MODEL` for a Chat Completions JSON-mode-capable model. These values are server-only. With no AI key, set `DEMO_MODE=true` for deterministic demo output. Demo mode grants anonymous visitors access to one shared account, so use only a dedicated disposable database. In private production deployments set `DEMO_MODE=false`; missing AI credentials then produce a clear workflow error.

## Vercel release steps

1. Import the GitHub repository into Vercel as a Next.js project. Use Node.js 22 or newer. `npm ci` runs `prisma generate` through `postinstall`, and `npm run build` builds with webpack.
2. In Vercel project settings, set `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `DEMO_MODE`, and, for live AI, `OPENAI_API_KEY`. Add `OPENAI_BASE_URL` and `OPENAI_MODEL` only when overriding the defaults. Configure environment-specific values separately for Production and Preview.
3. Configure the production GitHub OAuth callback for the actual Vercel domain or custom domain. Avoid enabling GitHub login on changing preview URLs unless their callbacks are explicitly registered.
4. Run `npm run db:migrate` against the production Neon database from a trusted shell or deployment job with `DIRECT_URL` set. Deploy the matching commit only after migration succeeds.
5. Verify `/login`, GitHub sign-in, project creation, a demo or live workflow, tasks, reports, and repository linking on the deployed domain.

The Dockerfile also supports self-hosting. Pass the same runtime variables, set `AUTH_TRUST_HOST=true` behind a trusted proxy, and run migrations before starting the container. CI runs lint, typecheck, unit tests, and a production build; Playwright remains a manual database/browser check.

References: [Neon connection pooling](https://neon.com/docs/connect/connection-pooling), [Prisma v6 connection URLs](https://www.prisma.io/docs/orm/v6/reference/connection-urls), [Auth.js deployment](https://authjs.dev/getting-started/deployment), [GitHub OAuth app setup](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [OpenAI Chat Completions JSON mode](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), and [Vercel Prisma build guidance](https://vercel.com/kb/guide/nextjs-prisma-postgres).
