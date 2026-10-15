import { readFile, writeFile } from "node:fs/promises";
import { fixtureVite } from "./native-process/vite.mjs";
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";

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
  const source = await readFile(wranglerConfig, "utf8");
  await writeFile(wranglerConfig, source.replace(/^main = .+$/m, `main = ${JSON.stringify(resolve("tests/mail-runtime.worker.ts"))}`));
}
const migrationArguments = ["exec", "wrangler", "d1", "migrations", "apply", "dial-local", "--local"];
if (process.env.DIAL_PERSIST_STATE_DIR) migrationArguments.push("--persist-to", process.env.DIAL_PERSIST_STATE_DIR);
migrationArguments.push("--config", requestedConfig);
await run("pnpm", migrationArguments);

const vite = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", port, "--strictPort"], { stdio: "inherit", env: childEnvironment });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => vite.kill(signal));
await waitForWorker(vite);
console.log("Local D1 is migrated and ready.");
const result = await new Promise((resolve) => vite.once("exit", (code) => resolve(code ?? 1)));
process.exitCode = result;

function run(command, args, env = childEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
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
