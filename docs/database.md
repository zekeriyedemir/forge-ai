# Database

Prisma schema and SQL migration live in `prisma/`. Core relationships are User → WorkspaceMember → Workspace → Project. Projects own goals, agents, runs, tasks, reports, metrics, activity events, and a linked repository. Auth.js uses Account and Session. Workspace and project records cascade on deletion; ownership is checked before every project read or write.

Apply committed migrations with `npm run db:migrate` locally or in deployment. Use `npm run db:dev` only when developing a new migration. For Neon, set `DATABASE_URL` to the pooled URL for runtime and `DIRECT_URL` to the direct URL for migrations; local PostgreSQL may use the same value for both. Seed data is optional and idempotent for the demo account.

Migration `20260917190000_live_research` adds `ResearchSession`, `ResearchSource`, and `ResearchFinding`. A session belongs to one AgentRun and Project; sources and findings cascade with it. The Research run persists a completed session only with quote-checked findings and source records in the same transaction as its completed run/report. Failed live research records a failed session with a safe reason. The migration creates new tables and does not rewrite existing records; apply it before running this branch against a database.
