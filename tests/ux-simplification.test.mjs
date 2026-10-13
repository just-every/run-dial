import { fixtureVite } from "./native-process/vite.mjs";
import { evidencePath } from "../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

contract("PUBLIC-003", "native SSR and HTTP preserve honest booking steps, receipts and retry", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-ux-simplification-"));
  const cwd = new URL("../", import.meta.url);
  const config = "tests/ux-simplification/worker.wrangler.toml";
  const origin = "http://127.0.0.1:15707";
  let server, output = "";
  const environment = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: resolve(cwd.pathname, config), DIAL_PERSIST_STATE_DIR: persist, DIAL_INSPECTOR_PORT: "15731", DIAL_UX_SIMPLIFICATION_ORIGIN: origin };
  const run = (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", env: environment });
    let captured = "";
    child.stdout.on("data", (chunk) => { captured += chunk; }); child.stderr.on("data", (chunk) => { captured += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done(captured) : reject(new Error(captured.slice(-18000))));
  });
  context.after(async () => {
    if (server?.exitCode === null) {
      const stopped = new Promise((done) => server.once("exit", done));
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
      await stopped;
    }
    await writeFile(evidencePath("ux-simplification-worker.log"), output);
    await rm(persist, { recursive: true, force: true });
  });
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-ux-simplification-test", "--local", "--persist-to", persist, "--config", config]);
  server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15707", "--strictPort"], { cwd, stdio: "pipe", detached: true, env: environment });
  server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
  const startupAt = Date.now();
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt >= 960) {
      const failure = { observedAt: new Date().toISOString(), phase: "isolated SSR startup before native assertions", elapsedMs: Date.now() - startupAt, exitCode: server.exitCode, attempts: attempt, output };
      await writeFile(evidencePath("ux-simplification-startup-failure.json"), JSON.stringify(failure, null, 2) + "\n");
      throw new Error(`Isolated SSR runtime failed readiness after ${failure.elapsedMs}ms; exit ${server.exitCode ?? "still running"}.\n${output.slice(-12000)}`);
    }
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* isolated SSR runtime is starting */ }
    await new Promise((done) => setTimeout(done, 125));
  }
  try {
    const nativeOutput = await run("node", ["scripts/verify-ux-simplification.mjs"]);
    console.log(nativeOutput.trim());
    assert.doesNotMatch(output, /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/);
  } catch (error) { throw new Error(`${error.message}\nRuntime output:\n${output.slice(-14000)}`); }
});
