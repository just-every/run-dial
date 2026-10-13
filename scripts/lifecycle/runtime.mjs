import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredCrons, runScheduled } from "../base-cli/cli/scheduled.mjs";

// The lifecycle runtime: Dial's production services, Google adapter and Base SendGrid sender on native D1, Durable Objects
// and Queues, with only provider HTTP synthetic (tests/booking-wire). rer's own scheduler drives it from the Cron schedule
// declared for `rer dev`, exactly as `rer dev` does, so no reminder, retry, alert or sync pass is ever triggered by hand.
const root = fileURLToPath(new URL("../../", import.meta.url));
const config = "tests/booking-wire/lifecycle.wrangler.toml";
export const origin = "http://127.0.0.1:15770";

export async function startLifecycleRuntime() {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-lifecycle-"));
  const env = { ...process.env, CI: "1" };
  let output = "";
  await new Promise((done, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-lifecycle-test", "--local", "--persist-to", persist, "--config", config], { cwd: root, env, stdio: "pipe" });
    let log = ""; child.stdout.on("data", chunk => { log += chunk; }); child.stderr.on("data", chunk => { log += chunk; });
    child.once("error", reject); child.once("exit", code => code === 0 ? done() : reject(new Error(log.slice(-8000))));
  });
  const server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", config, "--ip", "127.0.0.1", "--port", "15770", "--inspector-port", "15771", "--test-scheduled"], { cwd: root, env, stdio: "pipe", detached: true });
  server.stdout.on("data", chunk => { output = (output + chunk).slice(-20000); }); server.stderr.on("data", chunk => { output = (output + chunk).slice(-20000); });
  const scheduler = new AbortController(), passes = [];
  let schedule;
  const stop = async () => {
    scheduler.abort(); await schedule;
    if (server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(done => server.once("exit", done));
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
      await exited;
    }
    await rm(persist, { recursive: true, force: true });
  };
  try {
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null || attempt > 480) throw new Error(`lifecycle runtime did not start:\n${output}`);
      try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* workerd is starting */ }
      await new Promise(done => setTimeout(done, 125));
    }
    if (!(await fetch(`${origin}/wire/init`, { method: "POST" })).ok) throw new Error("wire provider state did not initialise");
    const crons = await declaredCrons(root);
    if (crons.length === 0) throw new Error("The deployment template declares no Cron Triggers for rer dev to run");
    schedule = runScheduled({ crons, url: origin, signal: scheduler.signal, report: run => {
      passes.push({ at: new Date().toISOString(), ...run });
      console.log(`RER_SCHEDULED ${new Date().toISOString().slice(0, 19)}Z "${run.cron}" ${run.ok ? "ok" : run.error ?? `status ${run.status}`} ${run.ms ?? 0}ms`);
    } });
    return { crons, passes, stop, alive: () => server.exitCode === null, output: () => output };
  } catch (error) { await stop(); throw error; }
}
