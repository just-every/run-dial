import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

contract("BOOK-002", "one of fifty real Worker/D1 callers claims an overlap and records its calendar command atomically", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-booking-d1-"));
  const port = String(15715);
  const origin = `http://127.0.0.1:${port}`;
  context.after(() => rm(persist, { recursive: true, force: true }));
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-booking-transaction-test", "--local", "--persist-to", persist, "--config", "tests/booking-worker.wrangler.toml"]);
  const worker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", "tests/booking-worker.wrangler.toml", "--ip", "127.0.0.1", "--port", port, "--inspector-port", "15725"], { cwd: new URL("../", import.meta.url), stdio: "pipe", detached: true });
  const workerOutput = captureOutput(worker);
  context.after(() => stop(worker));
  await waitForHealth(origin, worker, workerOutput);

  const claims = await Promise.all(Array.from({ length: 50 }, (_, index) => fetch(`${origin}/claim`, {
    method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ nonce: `nonce-${index}`, bookingId: `booking-${index}` }),
  }).then(async (response) => readWorkerJson(response, "claim", workerOutput))));
  assert.equal(claims.filter((claim) => claim.result === "claimed").length, 1, "only one transaction may claim the overlap");
  assert.equal(claims.filter((claim) => claim.result === "slot_taken").length, 49, "every losing claim reports the occupied slot");
  assert.deepEqual(await (await fetch(`${origin}/status`)).json(), { confirmed: 1, calendarCommands: 1 }, "the winning transaction atomically stored exactly one calendar command");

  const replay = await fetch(`${origin}/claim`, { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ nonce: "nonce-0", bookingId: "another-booking" }) });
  assert.equal((await readWorkerJson(replay, "duplicate nonce replay", workerOutput)).result, "duplicate_nonce", "a nonce row cannot be issued twice");

  const winningIndex = claims.findIndex((claim) => claim.result === "claimed");
  const bookingId = `booking-${winningIndex}`;
  const rescheduled = await readWorkerJson(await fetch(`${origin}/reschedule?bookingId=${bookingId}`, { method: "POST" }), "reschedule", workerOutput);
  assert.equal(rescheduled.result, "rescheduled", "repository lifecycle coverage: a claimed booking can advance its current occurrence");
  assert.equal(rescheduled.booking.occurrence.startAt, "2030-06-03T12:00:00.000Z", "reschedule advances the current occurrence atomically");

  const cancelled = await readWorkerJson(await fetch(`${origin}/cancel?bookingId=${bookingId}`, { method: "POST" }), "cancel", workerOutput);
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.currentStart, "2030-06-03T12:00:00.000Z");
  assert.equal(cancelled.claims, 0, "cancellation releases occupancy before the next availability read");
  assert.deepEqual(cancelled.current, [{ id: cancelled.cancellationOccurrenceId, state: "cancelled" }], "a cancelled booking retains exactly one current occurrence and its cancellation command addresses that occurrence");
  assert.equal(cancelled.pendingUpserts, 0, "a cancellation tombstones obsolete pending calendar upserts before its cancellation command is delivered");
  const distinctClaims = await Promise.all(Array.from({ length: 20 }, (_, index) => fetch(`${origin}/claim`, {
    method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ nonce: `cap-nonce-${index}`, bookingId: `cap-booking-${index}`, startAt: new Date(Date.parse("2030-06-04T00:00:00.000Z") + index * 40 * 60000).toISOString(), dayLimit: 3 }),
  }).then((response) => readWorkerJson(response, "host-day cap claim", workerOutput))));
  assert.equal(distinctClaims.filter((claim) => claim.result === "claimed").length, 3, "distinct non-overlapping concurrent claims still enforce the host-day cap atomically");
  assert.equal(distinctClaims.filter((claim) => claim.result === "slot_taken").length, 17);

});

async function readWorkerJson(response, action, workerOutput) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${action} returned ${response.status}, expected JSON: ${body.slice(0, 1_000)}\nWorker output: ${workerOutput.text}`);
  }
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

async function waitForHealth(origin, worker, workerOutput) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (worker.exitCode !== null) throw new Error(`booking test Worker exited before serving requests: ${workerOutput.text}`);
    try {
      const response = await fetch(`${origin}/status`);
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const status = await response.json();
        if (typeof status.confirmed === "number" && typeof status.calendarCommands === "number") return;
      }
    } catch {
      // Worker startup is expected to take several seconds on a cold Vite/Miniflare process.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 125));
  }
  throw new Error(`booking test Worker did not become ready within 10 seconds: ${workerOutput.text}`);
}

function captureOutput(worker) {
  const output = { text: "" };
  worker.stdout?.on("data", (chunk) => { output.text = `${output.text}${chunk}`.slice(-8_000); });
  worker.stderr?.on("data", (chunk) => { output.text = `${output.text}${chunk}`.slice(-8_000); });
  return output;
}

function stop(worker) {
  if (worker.exitCode !== null) return;
  try {
    process.kill(-worker.pid, "SIGTERM");
  } catch {
    worker.kill("SIGTERM");
  }
}
