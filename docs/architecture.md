# Architecture

Forge is a Next.js App Router application with server components for reads, server actions for forms, and authenticated route handlers for workflow and GitHub operations. Prisma maps PostgreSQL to typed records. Neon works through its standard PostgreSQL connection string.

```mermaid
flowchart LR
  Browser --> Next[Next.js server]
  Next --> Auth[Auth.js GitHub OAuth]
  Next --> DB[(PostgreSQL)]
  Next --> Runtime[Agent runtime]
  Runtime --> Provider[OpenAI-compatible or demo provider]
  Runtime --> Tools[Validated tools]
  Tools --> DB
  Next --> GitHub[GitHub API]
```

Each workflow pre-creates five ordered runs in a serializable database transaction, so a failed setup cannot leave a partial queue. The browser advances one run per request, allowing the dashboard to refresh after each completed agent. Run records, events, tasks, reports, and metrics survive page reloads. This is a polling-based live update path; a background job worker and SSE fan-out are future scaling work.

The AI provider returns structured output. The runtime validates the complete result before any content write, then commits the run completion, tasks, reports, metrics, and completion events in one database transaction. A database claim (`PENDING` to `RUNNING`) prevents two requests from executing the same run; completion checks the claim again so a stale worker cannot write after being replaced. A stale run can be reclaimed after two minutes. Tasks and reports upsert by run and title; metrics upsert by project and normalized key, while preserving an existing key's label and unit. A failed step records a safe error and marks later steps skipped. New workflows can be started after failure.
