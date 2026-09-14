# Database

Prisma schema and SQL migration live in `prisma/`. Core relationships are User → WorkspaceMember → Workspace → Project. Projects own goals, agents, runs, tasks, reports, metrics, activity events, and a linked repository. Auth.js uses Account and Session. Workspace and project records cascade on deletion; ownership is checked before every project read or write.

Apply migrations with `npm run db:migrate` in deployment or `npm run db:dev` locally. Use a pooled Neon URL for runtime and ensure the migration command can connect to the database. Seed data is optional and idempotent for the demo account.
