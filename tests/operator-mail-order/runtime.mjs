import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
export const origin = "http://127.0.0.1:42000";
export async function startRuntime(context) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-operator-order-"));
  const cwd = new URL("../../", import.meta.url);
  const config = "tests/operator-mail-order/worker.wrangler.toml";
  let server, output = "";
  const run = (args) => new Promise((done, reject) => {
    const child = spawn("pnpm", args, { cwd, env: process.env, stdio: "pipe" });
    let text = ""; child.stdout.on("data", (chunk) => { text += chunk; }); child.stderr.on("data", (chunk) => { text += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done(text) : reject(new Error(text)));
  });
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const done = new Promise((resolve) => server.once("exit", resolve));
    process.kill(-server.pid, "SIGTERM"); await done;
  }
  async function start() {
    server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", config, "--ip", "127.0.0.1", "--port", "42000", "--inspector-port", "42001"], { cwd, env: process.env, stdio: "pipe", detached: true });
    server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; attempt < 480; attempt++) {
      if (server.exitCode !== null) throw new Error(output);
      try { if ((await fetch(origin + "/health")).ok) return; } catch { /* Native workerd startup. */ }
      await new Promise((done) => setTimeout(done, 125));
    }
    throw new Error(output);
  }
  context.after(async () => { await stop(); if (process.env.DIAL_MAIL_ORDER_LOG) await writeFile(process.env.DIAL_MAIL_ORDER_LOG, output); await rm(persist, { recursive: true, force: true }); });
  await run(["exec", "wrangler", "d1", "migrations", "apply", "dial-operator-mail-order-test", "--local", "--persist-to", persist, "--config", config]);
  await start();
  return { restart: async () => { await stop(); await start(); } };
}
