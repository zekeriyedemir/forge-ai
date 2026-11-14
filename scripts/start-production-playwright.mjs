import { spawn } from "node:child_process";
import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = resolve(root, ".next/standalone");
await cp(resolve(root, ".next/static"), resolve(standalone, ".next/static"), { recursive: true, force: true });
await cp(resolve(root, "public"), resolve(standalone, "public"), { recursive: true, force: true });

const server = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "3100" },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("error", error => {
  console.error("Could not start the standalone production server.", error);
  process.exitCode = 1;
});
server.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
