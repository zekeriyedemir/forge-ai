# Live Research Agent

Forge does not require a paid search provider for local development. The recommended zero-cost option is a self-hosted or privately configured SearXNG instance. Brave Search remains optional for users who choose to configure `BRAVE_SEARCH_API_KEY`, but it is not required for Milestone 1 verification or developer setup.

Set `DEMO_MODE=false` and `OPENAI_API_KEY` as private server environment variables. For a zero-cost local setup, set `RESEARCH_PROVIDER=searxng` and `RESEARCH_SEARXNG_BASE_URL=https://your-searxng-instance.example` (or the base URL of your internal deployment). For Brave, configure `BRAVE_SEARCH_API_KEY` and optionally set `RESEARCH_PROVIDER=brave`. Forge will prefer SearXNG when `RESEARCH_PROVIDER=auto` and a SearXNG base URL is configured; otherwise it will use Brave if a key is set. Neither provider is used in automated tests; the suite exercises mocked or invalid responses only.

## Start local search

Start Docker Desktop (or a Docker daemon with Compose), then run:

```bash
npm run research:start
```

This starts only the research container, so it also works when Forge uses Neon. The script creates a random SearXNG secret in ignored `.local/searxng/settings.yml`, retains that configuration on later starts, and waits for the container to become healthy. The pinned official image is bound to `127.0.0.1:8080`; JSON search is enabled in the supplied configuration. No search API key is required.

Set these values in `.env`, retaining your existing database, auth, and AI configuration:

```dotenv
DEMO_MODE="false"
RESEARCH_PROVIDER="searxng"
RESEARCH_SEARXNG_BASE_URL="http://localhost:8080"
```

Restart Forge after changing environment variables. Check that the search API returns a JSON object with a `results` array:

```bash
curl --fail --get 'http://localhost:8080/search' --data-urlencode 'q=customer support software' --data 'format=json'
```

Use `docker compose --profile research logs --tail 50 searxng` to diagnose startup, and `docker compose --profile research stop searxng` to stop it without removing data. Start it again with `npm run research:start`. The local configuration disables the public-instance limiter; use the [official SearXNG deployment guidance](https://docs.searxng.org/admin/installation-docker.html) for a hosted service. Forge must reach the configured endpoint from its own server; a local laptop's `localhost` is not reachable from a deployed application.

The Brave key uses the [Web Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get) `X-Subscription-Token` header; Forge calls the fixed `https://api.search.brave.com/res/v1/web/search` endpoint. SearXNG is expected to be served from a self-hosted endpoint you control under your own domain or private network. Do not hard-code a third-party public SearXNG instance or assume a shared public instance is production-safe or always available.

## Failures and recovery

Before queuing a live workflow, Forge checks the configured search endpoint with one bounded search request. This checks access and valid JSON, not the future quality of results. An unavailable service stops the request before AI calls or workflow-attempt consumption. Later outages still fail the affected step safely; downstream steps are shown as skipped and can be retried in a new workflow after fixing the cause.

| Error | Recovery |
| --- | --- |
| Search is not configured | Set the provider and its URL or API key, then restart Forge. |
| Search is unavailable | Start Docker and run `npm run research:start`; check the configured URL and container logs. |
| Search access was denied | For SearXNG, enable `json` in [`search.formats`](https://docs.searxng.org/admin/settings/settings_search.html). For Brave, check the server-side key and account access. |
| Search rate limit reached | Wait for the provider's limit to reset before retrying. |
| Invalid search response | Confirm the URL serves the JSON search API rather than a login or HTML page. |
| No safe results or readable sources | Refine the goal and retry. Some websites block retrieval or provide no readable HTML; Forge never substitutes invented evidence. |

## Evidence handling

When configured, the existing workflow's Research step issues five goal-related search queries covering market demand, competitors/pricing, customer pain and segments, positioning/opportunities, and distribution. It considers at most two hits per query and retrieves at most six distinct pages, sampling each query before taking additional hits. Each page must be public HTTPS HTML. DNS answers are restricted to public IPv4, the validated address is pinned for the connection, and each redirect is checked anew. Page transfers stop at 64 KiB; saved visible excerpts stop at 12,000 characters, with at most 6,000 characters per source sent to the model. Search responses stop at 96 KiB. Search requests time out after eight seconds, DNS after three seconds, page requests after five seconds, and each AI synthesis request times out after 35 seconds. Synthesis has one shared retry for a temporary provider failure, invalid JSON or quotes, or truncated output. A truncated first response is discarded and regenerated with an 8,192-token completion budget instead of the initial 4,096; there are never more than two requests. Failed pages are excluded and noted as a limitation; no retrievable pages means no findings.

The model receives only bounded, untrusted excerpts and returns a structured summary, limitations, and at most eight findings. Each finding identifies one saved source index and an exact 15–300 character quote that must appear in that source's excerpt. Unsupported citations, malformed output, and invented quote text are rejected. Quotes demonstrate where a statement came from; they do not independently prove that the source or model interpretation is correct. Confidence is restricted to low or medium. The report contains numbered source URLs and retrieval timestamps. Users can inspect every finding, quote, source URL, and saved excerpt in **Project → Research**. The second Founder pass receives only the completed session's findings from the same workflow.

The UI labels live sessions **COMPLETED** or **FAILED**. A completed session means the provider returned pages and Forge validated its source quotes; it is not a claim that every market conclusion is true. With `DEMO_MODE=true`, the deterministic research outline is **MOCKED** and no live evidence session is made. With `DEMO_MODE=false` and no valid live search provider or AI key, the workflow is blocked with a configuration error. Server credentials, raw model completions, and full page bodies are never exposed to the browser or logs.

To verify with your own provider, apply migration `20260917190000_live_research` using `npm run db:migrate` against the intended database, configure a self-hosted SearXNG endpoint or a Brave key privately, start a workflow for a disposable project with a specific goal, and open **Project → Research**. Confirm a completed session has actual external URLs, retrieval times, excerpts, quote-backed findings, and stated limitations; inspect the source pages yourself. Then inspect the second Founder run/report for use of those findings. If search or AI is not configured, confirm the start request shows the expected configuration message without queuing runs or creating live findings. No production deployment or provider call is performed as part of the automated tests.
