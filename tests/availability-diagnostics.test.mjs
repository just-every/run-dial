import { fixtureVite } from "./native-process/vite.mjs";
import { evidencePath } from "../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

async function runFixture(context, runner, name) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-availability-diagnostics-"));
  const cwd = new URL("../", import.meta.url), config = name === "profile-authoring" ? "tests/availability-diagnostics/profile-worker.wrangler.toml" : "tests/availability-diagnostics/worker.wrangler.toml", origin = "http://127.0.0.1:15701";
  const evidence = evidencePath(`${name}-native.json`), log = evidencePath(`${name}-native.log`);
  let server, output = "", previousAttempts = [];
  try { const previous = JSON.parse(await readFile(evidence, "utf8")); previousAttempts = previous.previousAttempts ?? []; if (previous.status === "failed") previousAttempts.push({ observedAt: previous.observedAt, failure: previous.failure }); output = await readFile(log, "utf8"); } catch { /* first owned fixture attempt */ }
  const retainedOutputLength = output.length;
  const environment = { ...process.env, CI: "1", WRANGLER_LOG_PATH: resolve(persist, "wrangler.log"), WRANGLER_SEND_METRICS: "false", DIAL_WRANGLER_CONFIG_PATH: resolve(cwd.pathname, config), DIAL_PERSIST_STATE_DIR: persist, DIAL_INSPECTOR_PORT: "15730", DIAL_AVAILABILITY_DIAGNOSTICS_ORIGIN: origin };
  const run = (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", env: environment }); let captured = "";
    child.stdout.on("data", (chunk) => { captured += chunk; }); child.stderr.on("data", (chunk) => { captured += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done(captured) : reject(new Error(captured.slice(-18000))));
  });
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const stopped = new Promise((done) => server.once("exit", done));
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); } await stopped;
  }
  context.after(async () => { await stop(); await writeFile(log, output); await rm(persist, { recursive: true, force: true }); });
  try {
    output += await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-availability-diagnostics-test", "--local", "--persist-to", persist, "--config", config]);
    server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15701", "--strictPort"], { cwd, stdio: "pipe", detached: true, env: environment });
    server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null || server.signalCode !== null || attempt >= 960) throw new Error(`Diagnostics fixture readiness failed after ${Date.now() - started}ms; exit ${server.exitCode ?? server.signalCode ?? "still running"}; polls ${attempt}.\n${output.slice(-12000)}`);
      try { if ((await fetch(origin + "/health")).ok) break; } catch { /* isolated SSR runtime is starting */ }
      await new Promise((done) => setTimeout(done, 125));
    }
    const verifiedOutput = await run("node", [`scripts/${runner}.mjs`]); output += verifiedOutput; console.log(verifiedOutput.trim());
    assert.doesNotMatch(output.slice(retainedOutputLength), /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/);
    const verified = JSON.parse(await readFile(evidence, "utf8")); await writeFile(evidence, JSON.stringify({ ...verified, previousAttempts }, null, 2) + "\n");
  } catch (error) {
    output += error.message;
    let partial = {}; try { partial = JSON.parse(await readFile(evidence, "utf8")); } catch { /* startup precedes script evidence */ }
    await writeFile(evidence, JSON.stringify({ ...partial, status: "failed", observedAt: new Date().toISOString(), origin, previousAttempts, failure: error.message }, null, 2) + "\n");
    throw new Error(`${error.message}\nRuntime output:\n${output.slice(-14000)}`);
  }
}

contract("AVAIL-009", "native private diagnostics name exclusion rules while claims and public privacy stay enforced", (context) => runFixture(context, "verify-availability-diagnostics", "availability-diagnostics"));
contract("EVENT-006", "native host authoring preserves independently edited data and freshly guards publication", (context) => runFixture(context, "verify-host-authoring", "host-authoring"));
contract("PROFILE-001", "native profile authoring creates one coherent identity and preserves booking snapshots", (context) => runFixture(context, "verify-profile-authoring", "profile-authoring"));
contract("EVENT-003", "native question defaults preserve explicit configuration and validate final answers before claims", (context) => runFixture(context, "verify-question-defaults", "question-defaults"));
contract("BOOK-001", "native selection refresh supplies current questions while preserving capability and final validation", (context) => runFixture(context, "verify-selection-refresh", "selection-refresh"));
