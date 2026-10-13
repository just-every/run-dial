import { evidencePath } from "../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

contract("NOTIFY-003", "real D1 and per-booking Durable Objects preserve booking, callback, reminder and erasure ordering through failure recovery", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-coordination-"));
  const cwd = new URL("../", import.meta.url);
  const config = "tests/coordination-worker.wrangler.toml";
  const origin = "http://127.0.0.1:15716";
  context.after(() => rm(persist, { recursive: true, force: true }));
  const run = (command, args, env = {}) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", env: { ...process.env, CI: "1", ...env } });
    let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done(output) : reject(new Error(output.slice(-12000))));
  });
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-coordination-test", "--local", "--persist-to", persist, "--config", config]);
  const worker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", config, "--ip", "127.0.0.1", "--port", "15716", "--inspector-port", "15726"], { cwd, stdio: "pipe", detached: true, env: { ...process.env, CI: "1" } });
  let output = ""; worker.stdout.on("data", (chunk) => { output += chunk; }); worker.stderr.on("data", (chunk) => { output += chunk; });
  context.after(() => { try { process.kill(-worker.pid, "SIGTERM"); } catch { worker.kill("SIGTERM"); } });
  for (let attempt = 0; ; attempt++) {
    if (worker.exitCode !== null || attempt >= 480) throw new Error(output.slice(-10000));
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* local workerd is starting */ }
    await new Promise((done) => setTimeout(done, 125));
  }
  try { await run("node", ["scripts/verify-booking-journey.mjs"], { DIAL_REVIEW_ORIGIN: origin, DIAL_EVIDENCE_FILE: evidencePath("coordination-test.json") }); assert.doesNotMatch(output, /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/, "forwarding must not outlive request streams"); } catch (error) { throw new Error(`${error.message}\nWorker output:\n${output.slice(-12000)}`); }
});
