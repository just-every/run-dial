import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fixtureVite } from "../native-process/vite.mjs";
import { parentPage } from "./parent-page.mjs";

export async function popupRuntime(t) {
  const state = await mkdtemp(resolve(tmpdir(), "dial-popup-"));
  let server, parent;
  t.after(async () => {
    if (server?.exitCode === null) {
      const stopped = new Promise(done => server.once("exit", done));
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
      await stopped;
    }
    if (parent) await new Promise(done => parent.close(done));
    await rm(state, { recursive: true, force: true });
  });
  const reservation = createServer();
  await new Promise(done => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const config = resolve(state, "worker.wrangler.toml");
  const template = await readFile(new URL("../embed-document-authorization/worker.wrangler.toml", import.meta.url), "utf8");
  await writeFile(config, template.replaceAll("dial-embed-document", "dial-popup")
    .replace('main = "./worker.ts"', `main = ${JSON.stringify(resolve("tests/embed-popup/worker.ts"))}`)
    .replace('directory = "../../public"', `directory = ${JSON.stringify(resolve("public"))}`)
    .replace('migrations_dir = "../../migrations/core"', `migrations_dir = ${JSON.stringify(resolve("migrations/core"))}`)
    .replace("http://127.0.0.1:15756", origin));
  const env = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: state, DIAL_DISABLE_INSPECTOR: "1" };
  delete env.RER_DEV_KEY; delete env.RER_DEV_IDENTITY; delete env.RER_DEV_ORIGIN;
  const migrated = await new Promise((done, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-popup-test", "--local", "--persist-to", state, "--config", config], { env, stdio: "ignore" });
    child.once("error", reject); child.once("exit", done);
  });
  assert.equal(migrated, 0, "isolated popup D1 migrations applied");
  server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env, stdio: "ignore", detached: true });
  for (let attempt = 0; ; attempt++) {
    assert.equal(server.exitCode, null, "popup production Worker remains running");
    if (attempt > 960) throw new Error("popup production Worker did not become ready");
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* Runtime is starting. */ }
    await new Promise(done => setTimeout(done, 125));
  }
  let client = 0;
  const call = async (path, body, expected = 200) => {
    const number = client++;
    const response = await fetch(origin + path, { method: body === undefined ? "GET" : "POST", headers: { origin, "cf-connecting-ip": `198.19.${Math.floor(number / 250)}.${number % 250 + 1}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, expected, "popup native door returned expected status");
    return response;
  };
  const data = async (...args) => (await call(...args)).json();
  await data("/__fixtures/setup", {});
  parent = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(parentPage(origin, new URL(request.url, "http://localhost").searchParams.get("duplicate") === "yes"));
  });
  await new Promise(done => parent.listen(0, "127.0.0.1", done));
  const parentOrigin = `http://localhost:${parent.address().port}`;
  await call("/__fixtures/embed-state", { allowedOrigins: [parentOrigin] }, 204);
  return { origin, parentOrigin, call, data };
}
