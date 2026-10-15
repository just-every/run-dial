import { evidencePath } from "../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

contract("CAL-007", "untimestamped deletion inspection protects replacement events and survives process restart", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-deletion-ordering-"));
  const cwd = new URL("../", import.meta.url);
  const config = "tests/deletion-worker.wrangler.toml";
  const origin = "http://127.0.0.1:15717";
  let worker;
  let output = "";
  const run = (command, args, env = {}) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", env: { ...process.env, CI: "1", ...env } });
    let captured = "";
    child.stdout.on("data", (chunk) => { captured += chunk; });
    child.stderr.on("data", (chunk) => { captured += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done(captured) : reject(new Error(captured.slice(-12000))));
  });
  async function stop() {
    if (!worker || worker.exitCode !== null) return;
    const exited = new Promise((done) => worker.once("exit", done));
    try { process.kill(-worker.pid, "SIGTERM"); } catch { worker.kill("SIGTERM"); }
    await exited;
    worker = undefined;
  }
  context.after(async () => { await stop(); await writeFile(evidencePath("deletion-ordering-worker.log"), output); await rm(persist, { recursive: true, force: true }); });
  async function start() {
    worker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", config, "--ip", "127.0.0.1", "--port", "15717", "--inspector-port", "15727"], { cwd, stdio: "pipe", detached: true, env: { ...process.env, CI: "1" } });
    worker.stdout.on("data", (chunk) => { output += chunk; });
    worker.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; ; attempt++) {
      if (worker.exitCode !== null || attempt >= 480) throw new Error(output.slice(-10000));
      try { if ((await fetch(origin + "/health")).ok) break; } catch { /* isolated local runtime is starting */ }
      await new Promise((done) => setTimeout(done, 125));
    }
  }
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-deletion-ordering-test", "--local", "--persist-to", persist, "--config", config]);
  await start();
  try {
    const env = { DIAL_DELETION_ORIGIN: origin };
    await run("node", ["scripts/verify-deletion-ordering.mjs", "before-restart"], env);
    await stop();
    await start();
    await run("node", ["scripts/verify-deletion-ordering.mjs", "after-restart"], env);
    assert.doesNotMatch(output, /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/);
  } catch (error) {
    throw new Error(`${error.message}\nWorker output:\n${output.slice(-12000)}`);
  }
});
