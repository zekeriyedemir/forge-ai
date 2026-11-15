import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compose = ["compose", "-f", "docker-compose.local-ai.yml"];
const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { cwd: root, stdio: "ignore" });
if (docker.status !== 0) {
  console.error("Start Docker Desktop (or your Docker daemon), then run npm run ai:start again.");
  process.exit(1);
}

const started = spawnSync("docker", [...compose, "up", "--detach", "--wait", "--wait-timeout", "90"], { cwd: root, stdio: "inherit" });
if (started.status !== 0) process.exit(started.status ?? 1);

const pulled = spawnSync("docker", [...compose, "exec", "--no-TTY", "ollama", "ollama", "pull", "qwen3:4b"], { cwd: root, stdio: "inherit" });
if (pulled.status !== 0) process.exit(pulled.status ?? 1);

console.log("Local AI is ready at http://localhost:11434/v1 using qwen3:4b.");
console.log('Set OPENAI_API_KEY="ollama", OPENAI_BASE_URL="http://localhost:11434/v1", OPENAI_MODEL="qwen3:4b", and OPENAI_TOKEN_PARAMETER="max_tokens" in .env, then restart Forge.');
