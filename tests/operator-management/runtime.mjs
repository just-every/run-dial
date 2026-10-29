import { fixtureVite } from "../native-process/vite.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
export const root = new URL("../../", import.meta.url);
export const origin = "http://127.0.0.1:41868";
export async function startRuntime(context, { legacy = true, now } = {}) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-operators-"));
  const config = "tests/operator-management/worker.wrangler.toml";
  const env = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: resolve(root.pathname, config), DIAL_PERSIST_STATE_DIR: persist, DIAL_DISABLE_INSPECTOR: "1" };
  let server, output = "";
  const run = (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "pipe" }); let text = "", stdout = "";
    child.stdout.on("data", (chunk) => { text += chunk; stdout += chunk; }); child.stderr.on("data", (chunk) => { text += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done(stdout) : reject(new Error(text.slice(-10000))));
  });
  const sql = (command) => run("pnpm", ["exec", "wrangler", "d1", "execute", "dial-operator-management-test", "--local", "--persist-to", persist, "--config", config, "--command", command]);
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const stopped = new Promise((done) => server.once("exit", done));
    process.kill(-server.pid, "SIGTERM"); await stopped;
  }
  // Call only between settled request batches; never toggle time per request.
  async function setNow(value) {
    const response = await fetch(origin + "/__test/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ now: value }) });
    if (!response.ok) throw new Error(`Test clock rejected time (${response.status})`);
    const result = await response.json();
    if (result.now !== value) throw new Error("Test Worker did not acknowledge its clock");
    now = result.now;
    return now;
  }
  async function start() {
    server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "41868", "--strictPort"], { cwd: root, env, stdio: "pipe", detached: true });
    server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; attempt < 480; attempt++) {
      if (server.exitCode !== null) throw new Error(output.slice(-10000));
      let ready = false;
      try { ready = (await fetch(origin + "/health")).ok; } catch { /* local worker startup */ }
      if (ready) { if (now !== undefined) await setNow(now); return; }
      await new Promise((done) => setTimeout(done, 125));
    }
    throw new Error(output.slice(-10000));
  }
  context.after(async () => { await stop(); await rm(persist, { recursive: true, force: true }); });
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-operator-management-test", "--local", "--persist-to", persist, "--config", config]);
  if (legacy) await sql("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES ('01K00000000000000000000000','prior@example.test','prior@example.test','owner','active',1767225600000);");
  await start(); return { sql, setNow, query: async command => {
    const output = await run("pnpm", ["exec", "wrangler", "d1", "execute", "dial-operator-management-test", "--local", "--persist-to", persist, "--config", config, "--command", command, "--json"]);
    return JSON.parse(output)[0].results;
  }, restart: async () => { await stop(); await start(); } };
}
