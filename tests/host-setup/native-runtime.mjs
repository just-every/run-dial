import { fixtureVite } from "../native-process/vite.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnOwned } from "../native-process/lifecycle.mjs";

export async function coldHostRuntime(t) {
  const origin = "http://127.0.0.1:15802", config = resolve("tests/host-setup/signin-order.wrangler.toml");
  const state = await mkdtemp(resolve(tmpdir(), "dial-signin-order-"));
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: state, DIAL_INSPECTOR_PORT: "15803" };
  let server;
  t.after(async () => { try { await server?.stop(); } finally { await rm(state, { recursive: true, force: true }); } });
  const migration = spawnOwned("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-signin-order-test", "--local", "--persist-to", state, "--config", config], { env }, { label: "sign-in ordering migration" });
  try { await migration.waitForClose(120000); } finally { await migration.stop(); }
  server = spawnOwned("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15802", "--strictPort"], { env }, { label: "sign-in ordering worker" });
  for (let attempt = 0; attempt < 480; attempt++) {
    server.assertRunning();
    try { if ((await fetch(origin + "/health")).ok) return origin; } catch { /* native runtime startup */ }
    await new Promise(done => setTimeout(done, 125));
  }
  throw new Error("Sign-in ordering native runtime did not become ready");
}
