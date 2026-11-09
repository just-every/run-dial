import { fixtureVite } from "../native-process/vite.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evidencePath } from "../../scripts/evidence-path.mjs";

export async function runAxe(t, journey) {
  const state = await mkdtemp(resolve(tmpdir(), "dial-booking-axe-"));
  // Independent journeys can share a CI partition. Give each runtime its own
  // native origin as well as its own persisted state.
  const reservation = createServer();
  await new Promise((done, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", done);
  });
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const config = resolve(state, "worker.wrangler.toml");
  const template = await readFile(new URL("./worker.wrangler.toml", import.meta.url), "utf8");
  await writeFile(config, template
    .replace('main = "../review/worker.ts"', `main = ${JSON.stringify(resolve("tests/review/worker.ts"))}`)
    .replace('directory = "../../public"', `directory = ${JSON.stringify(resolve("public"))}`)
    .replace('migrations_dir = "../../migrations/core"', `migrations_dir = ${JSON.stringify(resolve("migrations/core"))}`)
    .replace("http://127.0.0.1:15752", origin));
  const env = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: state, DIAL_DISABLE_INSPECTOR: "1", DIAL_REVIEW_ORIGIN: origin, DIAL_APPROVAL_SCREENS:evidencePath("approval-screens"), DIAL_MONEY_SCREENS:evidencePath("money-screens") };
  // This rig exercises the production Worker with provider adapters, not the
  // local dev identity entry. Inherited rer launch bindings would replace the
  // configured review entry in Vite and silently remove its calendar fixtures.
  delete env.RER_DEV_KEY;
  delete env.RER_DEV_IDENTITY;
  delete env.RER_DEV_ORIGIN;
  let server, output = "";
  t.after(async () => {
    if (server?.exitCode === null) {
      const stopped = new Promise(done => server.once("exit", done));
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
      await stopped;
    }
    await writeFile(evidencePath("booking-axe-worker.log"), output);
    await rm(state, { recursive: true, force: true });
  });
  const run = args => new Promise((done, reject) => {
    const child = spawn(args[0], args.slice(1), { env, stdio: "pipe" }); let log = "";
    child.stdout.on("data", chunk => { log += chunk; }); child.stderr.on("data", chunk => { log += chunk; });
    child.on("error", reject); child.on("exit", code => code === 0 ? done(log) : reject(new Error(log.replace(/\/manage\/(?:invite\/)?[^/?\s"'<>]+/gu, "/manage/[redacted]"))));
  });
  await run(["pnpm", "exec", "wrangler", "d1", "migrations", "apply", "dial-booking-axe-test", "--local", "--persist-to", state, "--config", config]);
  server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env, stdio: "pipe", detached: true });
  server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt > 480) throw new Error(output.slice(-15000));
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* starting */ }
    await new Promise(done => setTimeout(done, 125));
  }
  console.log((await run(["node", journey ?? (process.env.DIAL_ACCEPTANCE_CAPACITY ? "scripts/verify-acceptance-capacity.mjs" : process.env.DIAL_ACCEPTANCE_AUDIT ? "scripts/verify-acceptance-audit.mjs" : "scripts/verify-booking-axe.mjs")])).trim());
}

