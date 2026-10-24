import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fixtureVite } from "../native-process/vite.mjs";
import { evidencePath } from "../../scripts/evidence-path.mjs";

const origin = "http://127.0.0.1:15790";

/**
 * A record's page through the product's own Vite build of the review Worker, on its own port so it never races another
 * rig, driven by autosave-journey.mjs: a private value saves as typed, survives leaving, and a failed save keeps it for Retry;
 * a slow or refused save never holds up Bookings' Search.
 */
export async function savesAsTyped(t) {
  const state = await mkdtemp(resolve(tmpdir(), "dial-custom-fields-browser-"));
  const config = resolve("tests/custom-fields/browser.wrangler.toml");
  const env = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: state, DIAL_INSPECTOR_PORT: "15791", DIAL_REVIEW_ORIGIN: origin };
  // The production Worker with fixture providers, not the local dev identity entry (as tests/booking-axe/run-axe.mjs).
  delete env.RER_DEV_KEY;
  delete env.RER_DEV_IDENTITY;
  delete env.RER_DEV_ORIGIN;
  let server, output = "";
  t.after(async () => {
    if (server?.exitCode === null) {
      const stopped = new Promise((done) => server.once("exit", done));
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
      await stopped;
    }
    await writeFile(evidencePath("custom-fields-browser-worker.log"), output);
    await rm(state, { recursive: true, force: true });
  });
  const run = (args) => new Promise((done, reject) => {
    const child = spawn(args[0], args.slice(1), { env, stdio: "pipe" });
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? done(log) : reject(new Error(log)));
  });
  await run(["pnpm", "exec", "wrangler", "d1", "migrations", "apply", "dial-custom-fields-browser-test", "--local", "--persist-to", state, "--config", config]);
  server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15790", "--strictPort"], { env, stdio: "pipe", detached: true });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt > 480) throw new Error(output.slice(-15000));
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* starting */ }
    await new Promise((done) => setTimeout(done, 125));
  }
  console.log((await run(["node", "tests/custom-fields/autosave-journey.mjs"])).trim());
}
