import { fixtureVite } from "../tests/native-process/vite.mjs";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Synthetic providers are confined to tests/review. This command preserves its local state.
const configDirectory = resolve(".wrangler/review-config");
const config = resolve(configDirectory, "wrangler.toml");
const persist = resolve(".wrangler/review-state");
await mkdir(configDirectory, { recursive: true });
const source = await readFile("wrangler.review.toml", "utf8");
await writeFile(config, source.replace('main = "tests/', 'main = "../../tests/').replace('migrations_dir = "migrations/', 'migrations_dir = "../../migrations/'));
const environment = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: persist, DIAL_INSPECTOR_PORT: "15737" };
await run(["exec", "wrangler", "d1", "migrations", "apply", "dial-local", "--local", "--persist-to", persist, "--config", config]);
const server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15702", "--strictPort"], { stdio: "inherit", env: environment });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
for (let attempt = 0; ; attempt++) {
  if (server.exitCode !== null || attempt >= 480) { server.kill("SIGTERM"); throw new Error("Dial review server did not become ready."); }
  try { if ((await fetch("http://127.0.0.1:15702/health")).ok) break; } catch { /* local workerd is starting */ }
  await new Promise((done) => setTimeout(done, 125));
}
const setup = await fetch("http://127.0.0.1:15702/__fixtures/setup", { method: "POST" });
if (!setup.ok) { server.kill("SIGTERM"); throw new Error("Synthetic review setup failed."); }
console.log("Dial review: http://127.0.0.1:15702/book/dial-host/intro — operator@dial.test at /signin. Providers are synthetic.");
process.exitCode = await new Promise((done) => server.once("exit", (code) => done(code ?? 1)));
function run(args) { return new Promise((done, reject) => { const child = spawn("pnpm", args, { stdio: "inherit", env: environment }); child.once("error", reject); child.once("exit", (code) => code === 0 ? done() : reject(new Error(`Local command exited ${code}`))); }); }
