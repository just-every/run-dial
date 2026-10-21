import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evidencePath } from "../scripts/evidence-path.mjs";

test("PAY-001 a paid booking confirms only after Stripe's signed event", async t => {
  const state = await mkdtemp(resolve(tmpdir(), "dial-payment-wire-"));
  const origin = "http://127.0.0.1:15758", config = "tests/booking-wire/worker.wrangler.toml";
  const env = { ...process.env, CI: "1", DIAL_REVIEW_ORIGIN: origin };
  let server, output = "";
  t.after(async () => {
    if (server?.exitCode === null) { const stopped = new Promise(done => server.once("exit", done)); try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); } await stopped; }
    // C.1 keeps captured Worker evidence free of generated manage capability URLs.
    await writeFile(evidencePath("payment-wire-worker.log"), output.replace(/\/manage\/(?:invite\/)?[^/?\s"'<>]+/gu, "/manage/[redacted]")); await rm(state, { recursive: true, force: true });
  });
  const run = args => new Promise((done, reject) => {
    const child = spawn(args[0], args.slice(1), { env, stdio: "pipe" }); let log = "";
    child.stdout.on("data", chunk => { log += chunk; }); child.stderr.on("data", chunk => { log += chunk; });
    child.on("error", reject); child.on("exit", code => code === 0 ? done(log) : reject(new Error(log)));
  });
  await run(["pnpm", "exec", "wrangler", "d1", "migrations", "apply", "dial-booking-wire-test", "--local", "--persist-to", state, "--config", config]);
  server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", state, "--config", config, "--ip", "127.0.0.1", "--port", "15758", "--inspector-port", "15759", "--var", `APP_URL:${origin}`], { env, stdio: "pipe", detached: true });
  server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) { if (server.exitCode !== null || attempt > 480) throw new Error(output.slice(-15000)); try { if ((await fetch(origin + "/health")).ok) break; } catch { /* starting */ } await new Promise(done => setTimeout(done, 125)); }
  assert.equal((await fetch(origin + "/wire/init", { method: "POST" })).status, 200);
  console.log((await run(["node", "tests/booking-wire/payment-journey.mjs"])).trim());
});
