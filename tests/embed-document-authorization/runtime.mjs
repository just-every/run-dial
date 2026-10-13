import { fixtureVite } from "../native-process/vite.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export const origin = "http://127.0.0.1:15756";
const cwd = new URL("../../", import.meta.url);
const config = "tests/embed-document-authorization/worker.wrangler.toml";
let server, persist, clients = 0;
export async function call(path, body, expected = 200) {
  const client = clients++;
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "CF-Connecting-IP": `198.18.${Math.floor(client / 250)}.${client % 250 + 1}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Deliberately omit paths, response bodies and runtime output: they can carry capabilities.
  assert.equal(response.status, expected, "native request returned the expected status");
  return response;
}
export const data = async (...args) => (await call(...args)).json();
export const read = path => data("/__fixtures/embed-document", { path });
export async function stop() {
  if (server?.exitCode === null) {
    const stopped = new Promise(done => server.once("exit", done));
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    await stopped;
  }
  if (persist) await rm(persist, { recursive: true, force: true });
}
export async function start() {
  persist = await mkdtemp(resolve(tmpdir(), "dial-embed-document-"));
  const environment = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: resolve(cwd.pathname, config), DIAL_PERSIST_STATE_DIR: persist, DIAL_DISABLE_INSPECTOR: "1" };
  const migrated = await new Promise((done, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-embed-document-test", "--local", "--persist-to", persist, "--config", config], { cwd, stdio: "ignore", env: environment });
    child.once("error", reject); child.once("exit", done);
  });
  assert.equal(migrated, 0, "isolated D1 migrations applied");
  server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15756", "--strictPort"], { cwd, stdio: "ignore", detached: true, env: environment });
  for (let attempt = 0; attempt < 960; attempt++) {
    assert.equal(server.exitCode, null, "isolated native runtime remains running");
    try { if ((await fetch(origin + "/health")).ok) return; } catch { /* Native runtime is starting. */ }
    await new Promise(done => setTimeout(done, 125));
  }
  throw new Error("isolated embed document runtime did not become ready");
}
