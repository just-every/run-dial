import { fixtureVite } from "./native-process/vite.mjs";
import { evidencePath } from "../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

contract("BOOK-009", "operator rescheduling and conflict controls preserve canonical claims through browser reload", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-operator-change-"));
  const cwd = new URL("../", import.meta.url);
  const config = "tests/operator-change/worker.wrangler.toml";
  const origin = "http://127.0.0.1:15718";
  let server, output = "";
  const environment = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: resolve(cwd.pathname, config), DIAL_PERSIST_STATE_DIR: persist, DIAL_INSPECTOR_PORT: "15728", DIAL_OPERATOR_CHANGE_ORIGIN: origin };
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
    await writeFile(evidencePath("operator-change-worker.log"), output);
    await rm(persist, { recursive: true, force: true });
  });
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-operator-change-test", "--local", "--persist-to", persist, "--config", config]);
  server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15718", "--strictPort"], { cwd, stdio: "pipe", detached: true, env: environment });
  server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt >= 480) throw new Error(output.slice(-12000));
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* isolated SSR runtime is starting */ }
    await new Promise((done) => setTimeout(done, 125));
  }
  try {
    const browserOutput = await run("node", ["scripts/verify-operator-change.mjs"]);
    console.log(browserOutput.trim());
    assert.doesNotMatch(output, /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/);
  } catch (error) { throw new Error(`${error.message}\nRuntime output:\n${output.slice(-14000)}`); }
});
