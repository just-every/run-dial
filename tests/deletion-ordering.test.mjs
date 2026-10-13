import { evidencePath } from "../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

contract("CAL-007", "fresh Google event inspection distinguishes deletion, replacement, missing identity and ambiguous reads", async () => {
  const compiled = await build({ entryPoints: [new URL("../src/core/platform/calendar/google.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", write: false });
  const { GoogleCalendarAdapter } = await import(`data:text/javascript,${encodeURIComponent(compiled.outputFiles[0].text)}`);
  const active = (id = "old-event") => ({ id, status: "confirmed", updated: "2030-01-01T00:00:00.000Z", start: { dateTime: "2030-06-03T10:00:00.000Z" }, end: { dateTime: "2030-06-03T10:30:00.000Z" }, extendedProperties: { private: { "dial-booking-id": "booking-one", "dial-occurrence-id": "occurrence-current" } }, summary: "External title must not be retained", attendees: [{ email: "private@example.test" }] });
  async function inspect(event, list, status = 200) {
    const calls = [];
    const adapter = new GoogleCalendarAdapter(undefined, async (input, init) => {
      const url = new URL(input);
      calls.push(url);
      assert.equal(init.method ?? "GET", "GET", "inspection performs no provider mutation");
      return url.pathname.endsWith("/events") ? Response.json(list) : status === 200 ? Response.json(event) : new Response(null, { status });
    });
    const result = await adapter.inspectManagedEvent("synthetic", "calendar-one", { bookingId: "booking-one", providerEventId: "old-event" });
    return { result, calls };
  }
  let observed = await inspect(active());
  assert.equal(observed.result.kind, "present");
  assert.equal(observed.result.event.location, "");
  assert.equal(observed.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(observed.result), /External title|private@example/);
  const cancelled = { id: "old-event", status: "cancelled" };
  observed = await inspect(cancelled, { kind: "calendar#events", items: [active("replacement-event")] });
  assert.equal(observed.result.kind, "present");
  assert.equal(observed.result.event.providerEventId, "replacement-event");
  assert.equal(observed.calls[1].searchParams.get("privateExtendedProperty"), "dial-booking-id=booking-one");
  assert.equal(observed.calls[1].searchParams.get("showDeleted"), "false");
  observed = await inspect(cancelled, { kind: "calendar#events", items: [] });
  assert.deepEqual(observed.result, { kind: "deleted", providerEventId: "old-event" }, "deletion has no invented updatedAt");
  for (const status of [404, 410]) assert.equal((await inspect(undefined, undefined, status)).result.kind, "unresolved");
  assert.equal((await inspect({ ...active(), id: "wrong-event" })).result.kind, "unresolved");
  for (const list of [
    {},
    { kind: "calendar#events", items: "malformed" },
    { kind: "calendar#events", items: [], nextPageToken: "more" },
    { kind: "calendar#events", items: [active("replacement-one"), active("replacement-two")] },
    { kind: "calendar#events", items: [{ id: "unowned", status: "confirmed" }] },
  ]) assert.equal((await inspect(cancelled, list)).result.kind, "unresolved");
  await assert.rejects(inspect(undefined, undefined, 429), (error) => error.code === "quota_exhausted");
});

contract("CAL-007", "untimestamped deletion inspection protects replacement events and survives process restart", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-deletion-ordering-"));
  const cwd = new URL("../", import.meta.url);
  const config = "tests/deletion-worker.wrangler.toml";
  const origin = "http://127.0.0.1:15717";
  let worker;
  let output = "";
  const run = (command, args, env = {}) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", env: { ...process.env, CI: "1", ...env } });
    let captured = "";
    child.stdout.on("data", (chunk) => { captured += chunk; });
    child.stderr.on("data", (chunk) => { captured += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done(captured) : reject(new Error(captured.slice(-12000))));
  });
  async function stop() {
    if (!worker || worker.exitCode !== null) return;
    const exited = new Promise((done) => worker.once("exit", done));
    try { process.kill(-worker.pid, "SIGTERM"); } catch { worker.kill("SIGTERM"); }
    await exited;
    worker = undefined;
  }
  context.after(async () => { await stop(); await writeFile(evidencePath("deletion-ordering-worker.log"), output); await rm(persist, { recursive: true, force: true }); });
  async function start() {
    worker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", config, "--ip", "127.0.0.1", "--port", "15717", "--inspector-port", "15727"], { cwd, stdio: "pipe", detached: true, env: { ...process.env, CI: "1" } });
    worker.stdout.on("data", (chunk) => { output += chunk; });
    worker.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; ; attempt++) {
      if (worker.exitCode !== null || attempt >= 480) throw new Error(output.slice(-10000));
      try { if ((await fetch(origin + "/health")).ok) break; } catch { /* isolated local runtime is starting */ }
      await new Promise((done) => setTimeout(done, 125));
    }
  }
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-deletion-ordering-test", "--local", "--persist-to", persist, "--config", config]);
  await start();
  try {
    const env = { DIAL_DELETION_ORIGIN: origin };
    await run("node", ["scripts/verify-deletion-ordering.mjs", "before-restart"], env);
    await stop();
    await start();
    await run("node", ["scripts/verify-deletion-ordering.mjs", "after-restart"], env);
    assert.doesNotMatch(output, /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/);
  } catch (error) {
    throw new Error(`${error.message}\nWorker output:\n${output.slice(-12000)}`);
  }
});
