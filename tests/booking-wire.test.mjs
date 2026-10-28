import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evidencePath } from "../scripts/evidence-path.mjs";

async function wireJourney(t, feature) {
  const state = await mkdtemp(resolve(tmpdir(), "dial-booking-wire-"));
  const origin = "http://127.0.0.1:15754", config = "tests/booking-wire/worker.wrangler.toml";
  const env = { ...process.env, CI: "1", DIAL_REVIEW_ORIGIN: origin };
  let server, output = "";
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (server?.exitCode === null) { const stopped = new Promise(done => server.once("exit", done)); try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); } await stopped; }
    // C.1 keeps captured Worker evidence free of generated manage capability URLs.
    await writeFile(evidencePath("booking-wire-worker.log"), output.replace(/\/manage\/(?:invite\/)?[^/?\s"'<>]+/gu, "/manage/[redacted]")); await rm(state, { recursive: true, force: true });
  };
  t.after(cleanup);
  const run = args => new Promise((done, reject) => {
    const child = spawn(args[0], args.slice(1), { env, stdio: "pipe" }); let log = "";
    child.stdout.on("data", chunk => { log += chunk; }); child.stderr.on("data", chunk => { log += chunk; });
    child.on("error", reject); child.on("exit", code => code === 0 ? done(log) : reject(new Error(log)));
  });
  await run(["pnpm", "exec", "wrangler", "d1", "migrations", "apply", "dial-booking-wire-test", "--local", "--persist-to", state, "--config", config]);
  const microsoft = feature === "microsoft" ? ["--var", "CALENDAR_PROVIDER:microsoft", "--var", "MICROSOFT_OAUTH_CLIENT_ID:synthetic-dial-801-client", "--var", "MICROSOFT_OAUTH_CLIENT_SECRET:synthetic-dial-802-secret"] : [];
  server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", state, "--config", config, "--ip", "127.0.0.1", "--port", "15754", "--inspector-port", "15755", ...microsoft], { env, stdio: "pipe", detached: true });
  server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) { if (server.exitCode !== null || attempt > 480) throw new Error(output.slice(-15000)); try { if ((await fetch(origin + "/health")).ok) break; } catch { /* starting */ } await new Promise(done => setTimeout(done, 125)); }
  assert.equal((await fetch(origin + "/wire/init", { method: "POST" })).status, 200);
  console.log((await run(feature === "microsoft" ? ["node", "tests/booking-wire/microsoft-journey.mjs"] : feature ? ["node", "tests/booking-wire/feature-journey.mjs", feature] : ["node", "tests/booking-wire/journey.mjs"])).trim());
  await cleanup();
}

test("Native Google and Microsoft calendar lifecycles and Base SendGrid outbox preserve request-only scheduling", async t => { await wireJourney(t); await wireJourney(t, "microsoft"); });
test("EVENT-009/POLL-001 invitee guests receive invitations and changes without booking authority", t => wireJourney(t, "guests"));
test("EVENT-008/PAY-007 approval requests authorize shown terms and confirm only after host approval and signed capture", t => wireJourney(t, "approval"));
test("an approved request link stops opening the booking once its manage link is replaced or expires", t => wireJourney(t, "approval-access"));

test("Routing forms guide qualified visitors through once-only submission, booking and erasure", t => wireJourney(t, "routing"));
