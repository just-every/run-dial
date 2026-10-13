import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

const port = String(15711);
const origin = `http://127.0.0.1:${port}`;

contract("AUTH-004", "a forged OAuth callback changes nothing and returns 400 from the Worker", async (context) => {
  const persistState = await mkdtemp(resolve(tmpdir(), "dial-provider-runtime-"));
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-provider-app-runtime-test", "--local", "--persist-to", persistState, "--config", "tests/providers-app-worker.wrangler.toml"]);
  const server = spawn("pnpm", [
    "exec", "wrangler", "dev", "--local", "--persist-to", persistState, "--config", "tests/providers-app-worker.wrangler.toml",
    "--ip", "127.0.0.1", "--port", port, "--inspector-port", "15721",
    "--var", "OWNER_EMAIL:operator@dial.test", "--var", "ENVIRONMENT:development", "--var", `APP_URL:${origin}`, "--var", "SESSION_SECRET:provider-runtime-test-secret-that-is-at-least-thirty-two-bytes",
  ], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, CI: "1" },
    stdio: "pipe",
    detached: true,
  });
  const output = capture(server);
  context.after(() => stopServer(server));
  context.after(() => rm(persistState, { recursive: true, force: true }));
  await waitForHealth(server, output);

  const callback = await fetch(`${origin}/api/calendar/oauth/callback?state=forged&code=forged`);
  assert.equal(callback.status, 400);
  const googleWebhook = await fetch(`${origin}/api/webhooks/google-calendar`, { method: "POST", headers: { "x-goog-channel-id": "forged" } });
  assert.equal(googleWebhook.status, 401);
  const resendWebhook = await fetch(`${origin}/api/webhooks/resend`, { method: "POST", body: "{}" });
  assert.equal(resendWebhook.status, 401);
});

async function waitForHealth(server, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`provider runtime Worker exited before serving requests: ${output.text.slice(-4_000)}`);
    try {
      if ((await fetch(`${origin}/health`)).ok) return;
    } catch {
      // Local Worker startup is asynchronous.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 125));
  }
  throw new Error(`provider runtime test Worker did not become healthy: ${output.text.slice(-4_000)}`);
}

function capture(server) {
  const output = { text: "" };
  server.stdout?.on("data", (chunk) => { output.text = `${output.text}${chunk}`.slice(-8_000); });
  server.stderr?.on("data", (chunk) => { output.text = `${output.text}${chunk}`.slice(-8_000); });
  return output;
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: new URL("../", import.meta.url), stdio: "pipe", env: { ...process.env, CI: "1" } });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} failed: ${output}`)));
  });
}

function stopServer(server) {
  if (server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}
