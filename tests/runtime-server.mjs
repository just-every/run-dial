import { readFile, writeFile } from "node:fs/promises";
import { fixtureVite } from "./native-process/vite.mjs";
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { projectViteBinary } from "@runeditrun/rer/internal/onboarding/project-vite.mjs";

let activeChild;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => activeChild?.kill(signal));

const port = process.env.DIAL_PORT ?? "8787";
const requestedConfig = process.env.DIAL_WRANGLER_CONFIG_PATH ?? "wrangler.toml";
// Wrangler resolves .dev.vars beside its config. Keep both inside an explicit
// isolated variables directory instead of silently reading the checkout's file.
const wranglerConfig = process.env.DIAL_DEV_VARS_DIR
  ? resolve(process.env.DIAL_DEV_VARS_DIR, basename(requestedConfig)) : requestedConfig;
const childEnvironment = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: wranglerConfig, ...(process.env.DIAL_DEV_ENV ? { CLOUDFLARE_ENV: process.env.DIAL_DEV_ENV } : {}) };

await run("pnpm", ["runtime:config"], { ...childEnvironment, DIAL_WRANGLER_CONFIG_PATH: requestedConfig });
if (wranglerConfig !== requestedConfig) await run("pnpm", ["runtime:config"]);
await run("node", ["tests/runtime-vars.mjs"]);
// Test mail lives at a paid-edge adapter, never in the product's dev runtime.
if (!process.env.RER_DEV_ORIGIN) {
  const source = (await readFile(wranglerConfig, "utf8")).replace(/^main = .+$/m, `main = ${JSON.stringify(resolve("tests/mail-runtime.worker.ts"))}`);
  // Producers stay so code that enqueues still works; the real queue consumer does not start unless
  // DIAL_TEST_QUEUE_CONSUMERS=1, because a job a test leaves on the queue is then delivered mid-test (gr-base-215).
  await writeFile(wranglerConfig, process.env.DIAL_TEST_QUEUE_CONSUMERS === "1" ? source : source.replace(/^\[\[queues\.consumers\]\]\n(?:(?!\[).*\n)*/gm, ""));
}
const migrationArguments = ["exec", "wrangler", "d1", "migrations", "apply", "dial-local", "--local"];
if (process.env.DIAL_PERSIST_STATE_DIR) migrationArguments.push("--persist-to", process.env.DIAL_PERSIST_STATE_DIR);
migrationArguments.push("--config", requestedConfig);
await run("pnpm", migrationArguments);

const vite = spawn(process.execPath, [projectViteBinary(process.cwd()), ...fixtureVite.slice(2), "--host", "127.0.0.1", "--port", port, "--strictPort"], { stdio: "inherit", env: childEnvironment });
activeChild = vite;
await waitForWorker(vite);
console.log("Local D1 is migrated and ready.");
const result = await new Promise((resolve) => vite.once("exit", (code) => resolve(code ?? 1)));
process.exitCode = result;

function run(command, args, env = childEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    activeChild = child;
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });
}

async function waitForWorker(child) {
  const healthUrl = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 480; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited before ${healthUrl} became available`);
    try {
      if ((await fetch(healthUrl)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for ${healthUrl}`);
}
