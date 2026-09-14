# Security

Auth.js stores sessions in PostgreSQL and GitHub OAuth credentials stay on the server. A GitHub access token is read from the Account table only inside server code. Repository association re-checks the repository against the authenticated user's GitHub API response; a client-supplied name or URL is never trusted.

Project access requires workspace membership on server actions, pages, and API routes. Forms and tool inputs use Zod. Workflow starts are limited to five per project per hour as a basic cost guard. Configure a unique `AUTH_SECRET`, HTTPS, and database credentials in the deployment environment. `DEMO_MODE=true` intentionally allows public access to a shared demo account; use it only with disposable data and a dedicated database. Disable it for private production workspaces.

V1 limitations: no distributed rate limiter, no token encryption beyond database and infrastructure controls, and no human approval UI for future external side-effecting tools. Current agent tools only write Forge-owned records. GitHub integration is read-only apart from associating a selected repository in Forge.
