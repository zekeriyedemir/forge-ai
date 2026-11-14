import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { cwd: root, stdio: "ignore" });
if (docker.status !== 0) {
  console.error("Start Docker Desktop (or your Docker daemon), then run npm run research:start again.");
  process.exit(1);
}

const directory = resolve(root, ".local/searxng");
const settingsPath = resolve(directory, "settings.yml");
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (!existsSync(settingsPath)) {
  const template = readFileSync(resolve(root, "config/searxng/settings.yml"), "utf8");
  const settings = template.replace("__FORGE_SEARXNG_SECRET__", randomBytes(32).toString("hex"));
  // The private parent directory protects the file on the host; read permission
  // lets the container's unprivileged process access the single-file bind mount.
  writeFileSync(settingsPath, settings, { flag: "wx", mode: 0o644 });
}

const started = spawnSync("docker", ["compose", "--profile", "research", "up", "--detach", "--wait", "--wait-timeout", "90", "searxng"], { cwd: root, stdio: "inherit" });
if (started.status !== 0) process.exit(started.status ?? 1);
console.log("Research search is running at http://localhost:8080.");
console.log('Set RESEARCH_PROVIDER="searxng" and RESEARCH_SEARXNG_BASE_URL="http://localhost:8080" in .env, then restart Forge.');
