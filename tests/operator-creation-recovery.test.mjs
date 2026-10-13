import { fixtureVite } from "./native-process/vite.mjs";
import { evidencePath } from "../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

contract("BOOK-012", "native operator creation retries recover one committed booking across restart and erasure", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-operator-creation-recovery-"));
  const cwd = new URL("../", import.meta.url), config = "tests/operator-creation-recovery/worker.wrangler.toml", origin = "http://127.0.0.1:15708";
  let server, output = "";
  const evidence = evidencePath("operator-creation-recovery.json"), log = evidencePath("operator-creation-recovery.log");
  let previousAttempts = [];
  try { const previous = JSON.parse(await readFile(evidence, "utf8")); previousAttempts = previous.previousAttempts ?? []; if (previous.status === "failed") previousAttempts.push({ observedAt: previous.observedAt, failure: previous.failure }); output = await readFile(log, "utf8"); } catch { /* first owned fixture attempt */ }
  const retainedOutputLength = output.length;
  const environment = { ...process.env, CI: "1", WRANGLER_LOG_PATH: resolve(persist, "wrangler.log"), WRANGLER_SEND_METRICS: "false", DIAL_WRANGLER_CONFIG_PATH: resolve(cwd.pathname, config), DIAL_PERSIST_STATE_DIR: persist, DIAL_INSPECTOR_PORT: "15736", DIAL_OPERATOR_CREATION_RECOVERY_ORIGIN: origin };
  const run = (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", env: environment }); let captured = "";
    child.stdout.on("data", (chunk) => { captured += chunk; }); child.stderr.on("data", (chunk) => { captured += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done(captured) : reject(new Error(captured.slice(-18000))));
  });
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const stopped = new Promise((done) => server.once("exit", done));
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); } await stopped;
  }
  async function start() {
    server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15708", "--strictPort"], { cwd, stdio: "pipe", detached: true, env: environment });
    server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null || attempt >= 960) throw new Error(`Recovery fixture readiness failed after${Date.now() - started}ms; exit${server.exitCode ?? "still running"}; polls${attempt}.\n${output.slice(-12000)}`);
      try { if ((await fetch(origin + "/health")).ok) break; } catch { /* isolated SSR runtime is starting */ }
      await new Promise((done) => setTimeout(done, 125));
    }
  }
  context.after(async () => { await stop(); await writeFile(log, output); await rm(persist, { recursive: true, force: true }); });
  try {
    output += await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-operator-creation-recovery-test", "--local", "--persist-to", persist, "--config", config]);
    await start(); const before = await run("node", ["scripts/verify-operator-creation-recovery.mjs", "--before-restart"]); output += before; console.log(before.trim());
    await stop(); await start(); const after = await run("node", ["scripts/verify-operator-creation-recovery.mjs", "--after-restart"]); output += after; console.log(after.trim());
    assert.doesNotMatch(output.slice(retainedOutputLength), /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/);
    const verified = JSON.parse(await readFile(evidence, "utf8")); await writeFile(evidence, JSON.stringify({ ...verified, previousAttempts }, null, 2) + "\n");
  } catch (error) {
    output += error.message;
    await writeFile(evidence, JSON.stringify({ status: "failed", observedAt: new Date().toISOString(), origin, previousAttempts, failure: error.message }, null, 2) + "\n");
    throw new Error(`${error.message}\nRuntime output:\n${output.slice(-14000)}`);
  }
});
