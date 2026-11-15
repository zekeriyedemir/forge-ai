# Free local AI

Forge can run live workflows without a paid AI API by using Ollama on your machine. Prompts are sent to the local Ollama server, not to an AI cloud provider. Live research still makes web requests through your configured SearXNG service, and project data remains in the database configured by `DATABASE_URL`.

## macOS (recommended)

Native Ollama uses Apple Silicon acceleration and is faster than running the model in Docker:

```bash
brew install ollama
brew services start ollama
ollama pull qwen2.5-coder:7b
```

The `qwen2.5-coder:7b` model is several gigabytes and is stored locally. Inference runs on your computer; no hosted AI account or billing is involved.

Configure `.env` for Ollama:

```dotenv
DEMO_MODE="false"
OPENAI_API_KEY="ollama"
OPENAI_BASE_URL="http://localhost:11434/v1"
OPENAI_MODEL="qwen2.5-coder:7b"
OPENAI_TOKEN_PARAMETER="max_tokens"
OPENAI_JSON_MODE="true"
```

Ollama ignores the placeholder API key. Keep `OPENAI_JSON_MODE=true`; Forge and Ollama both constrain and validate structured JSON. Leave `OPENAI_PROPOSAL_MODEL` unset to use the same local model for Developer proposals.
For loopback AI endpoints, Forge uses deterministic sampling and sends at most two goal-relevant research excerpts, capped at 600 characters each, with a bounded completion budget. All retrieved sources are still retained in the research report; citations must match the excerpts actually sent to the model.

For live research, also run `npm run research:start` and set:

```dotenv
RESEARCH_PROVIDER="searxng"
RESEARCH_SEARXNG_BASE_URL="http://localhost:8080"
```

Restart Forge after changing `.env`. Verify Ollama responds before starting a workflow:

```bash
curl --fail http://localhost:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ollama' \
  -d '{"model":"qwen2.5-coder:7b","messages":[{"role":"user","content":"Return {\"ok\":true} as JSON."}],"response_format":{"type":"json_object"}}'
```

To stop the native service while retaining the downloaded model, run:

```bash
brew services stop ollama
```

## Docker alternative

If you prefer not to install Ollama natively, start Docker Desktop and run `npm run ai:start`. It starts Ollama in a container, binds it to loopback, and downloads `qwen3:4b` into a persistent Docker volume. Use `OPENAI_MODEL="qwen3:4b"` for this option; inference may be slower because Docker Desktop on macOS does not pass through Apple GPU acceleration. Stop it with `docker compose -f docker-compose.local-ai.yml stop`.

The local Ollama setup is intended for a Forge server running on the same machine. A deployed app cannot reach your laptop's `localhost`; use an AI endpoint reachable from the deployed server if you later deploy live workflows.
