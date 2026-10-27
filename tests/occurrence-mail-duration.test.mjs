import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";
import { evidencePath } from "../scripts/evidence-path.mjs";
import { occurrenceDurationJourney } from "./booking-wire/occurrence-duration-journey.mjs";

contract(["BOOK-004", "NOTIFY-001", "NOTIFY-002", "NOTIFY-003", "NOTIFY-004"], "occurrence-specific mail facts survive an actual 30-to-60-minute reschedule on migrated native D1", async t => {
  const state = await mkdtemp(resolve(tmpdir(), "dial-occurrence-mail-"));
  const origin = "http://127.0.0.1:15764";
  const config = resolve(state, "worker.wrangler.toml");
  const source = await readFile(new URL("./booking-wire/worker.wrangler.toml", import.meta.url), "utf8");
  await writeFile(config, source.replace('main = "worker.ts"', `main = ${JSON.stringify(new URL("./booking-wire/worker.ts", import.meta.url).pathname)}`).replace('migrations_dir = "../../migrations/core"', `migrations_dir = ${JSON.stringify(new URL("../migrations/core", import.meta.url).pathname)}`).replaceAll("15754", "15764"));
  const env = { ...process.env, CI: "1" };
  let server;
  let output = "";
  t.after(async () => {
    if (server?.exitCode === null) {
      const stopped = new Promise(done => server.once("exit", done));
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
      await stopped;
    }
    await writeFile(evidencePath("occurrence-mail-worker.log"), output.replace(/\/manage\/[^/?\s"'<>]+/gu, "/manage/[redacted]"));
    await rm(state, { recursive: true, force: true });
  });
  await run(["pnpm", "exec", "wrangler", "d1", "migrations", "apply", "dial-booking-wire-test", "--local", "--persist-to", state, "--config", config], env);
  server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", state, "--config", config, "--ip", "127.0.0.1", "--port", "15764", "--inspector-port", "15765"], { env, stdio: "pipe", detached: true });
  server.stdout.on("data", chunk => { output += chunk; });
  server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt > 480) throw new Error("Occurrence mail native Worker did not become ready; see redacted evidence log");
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* Native runtime is starting. */ }
    await new Promise(done => setTimeout(done, 125));
  }
  assert.equal((await fetch(origin + "/wire/init", { method: "POST" })).status, 200);
  const result = await occurrenceDurationJourney(origin);
  await writeFile(evidencePath("occurrence-mail-duration.json"), JSON.stringify(result, null, 2));
});

async function run(args, env) {
  await new Promise((done, reject) => {
    const child = spawn(args[0], args.slice(1), { env, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? done() : reject(new Error(output)));
  });
}
