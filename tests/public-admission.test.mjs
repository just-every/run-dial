import { fixtureVite } from "./native-process/vite.mjs";
import { evidencePath } from "../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

contract("PUBLIC-006", "native admission boundaries, callback authentication and rolling state survive process restart (browser retry pending)", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-public-admission-"));
  const cwd = new URL("../", import.meta.url), config = "tests/public-admission/worker.wrangler.toml", origin = "http://127.0.0.1:15704";
  let server, output = "";
  const environment = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: resolve(cwd.pathname, config), DIAL_PERSIST_STATE_DIR: persist, DIAL_INSPECTOR_PORT: "15734", DIAL_PUBLIC_ADMISSION_ORIGIN: origin };
  const run = (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", env: environment });
    let captured = "";
    child.stdout.on("data", (chunk) => { captured += chunk; }); child.stderr.on("data", (chunk) => { captured += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done(captured) : reject(new Error(captured.slice(-18000))));
  });
  async function stop() {
    if (server?.exitCode !== null) return;
    const stopped = new Promise((done) => server.once("exit", done));
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    await stopped;
  }
  async function start() {
    server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15704", "--strictPort"], { cwd, stdio: "pipe", detached: true, env: environment });
    server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null || attempt >= 480) throw new Error(output.slice(-12000));
      try { if ((await fetch(origin + "/health")).ok) break; } catch { /* isolated runtime is starting */ }
      await new Promise((done) => setTimeout(done, 125));
    }
  }
  context.after(async () => { await stop(); await writeFile(evidencePath("public-admission-worker.log"), output); await rm(persist, { recursive: true, force: true }); });
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-public-admission-test", "--local", "--persist-to", persist, "--config", config]);
  try {
    await start(); console.log((await run("node", ["scripts/verify-public-admission.mjs", "--before-restart"])).trim());
    await stop(); await start(); console.log((await run("node", ["scripts/verify-public-admission.mjs", "--after-restart"])).trim());
    assert.doesNotMatch(output, /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/);
  } catch (error) { throw new Error(`${error.message}\nRuntime output:\n${output.slice(-14000)}`); }
});
