import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";
import { hasHref } from "./html-text.mjs";

function assertExactKeys(value, expected, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} is an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} has its complete field set`);
}

contract("AUTH-004", "the Worker persists a session-bound OAuth state once, consumes it once, and seals provider credentials", async (context) => {
  const worker = await startWorker(context);
  const result = await readJson(await fetch(`${worker.origin}/oauth`));
  assert.equal(result.connected, "connected");
  assert.equal(result.replay, "invalid_state", "a consumed state cannot exchange a second provider code");
  assert.equal(result.status, "unhealthy", "credentials alone never make public scheduling healthy");
  assert.equal(result.storesPlainToken, false, "provider tokens are stored sealed in D1");
});

contract("AVAIL-004", "the Worker uses a bounded cache, forces a range read after unhealthy recovery, and invalidates after an authenticated callback", async (context) => {
  const worker = await startWorker(context);
  const result = await readJson(await fetch(`${worker.origin}/cache`));
  assert.deepEqual(result, { freshReads: 1, cachedReads: 0, recoveryReads: 2, webhook: "accepted", callbackFreshReads: 1 });
});

contract("CAL-007", "the Worker renews only expiring selected destination and conflict watches and stops superseded channels", async (context) => {
  const worker = await startWorker(context);
  const result = await readJson(await fetch(`${worker.origin}/channels`));
  assert.deepEqual(result, { current: "current", renewed: "renewed", watchesAdded: 1, stopped: 2 });
});

contract("CAL-003", "a durable calendar command persists Meet readiness and the link-ready delivery before sending it", async (context) => {
  const worker = await startWorker(context);
  await readJson(await fetch(`${worker.origin}/cache`));
  const result = await readJson(await fetch(`${worker.origin}/delivery`));
  assertExactKeys(result, ["booking", "link", "selectedCurrentCapability", "selectedCapabilityActive", "managedEventIcalUid", "sent"], "link-ready result");
  assertExactKeys(result.booking, ["calendarState", "meetingState", "meetingUrl"], "link-ready booking state");
  assertExactKeys(result.link, ["state", "payload"], "link-ready delivery");
  assertExactKeys(result.link.payload, ["to", "recipientRole", "subject", "text", "html"], "safe link-ready payload");
  assert.deepEqual(result.booking, { calendarState: "succeeded", meetingState: "succeeded", meetingUrl: "https://meet.google.com/provider-test" });
  assert.equal(result.link.state, "pending");
  assert.equal(result.link.payload.to, "invitee@dial.test");
  assert.equal(result.link.payload.subject, "Your meeting link is ready");
  assert.ok(result.link.payload.text.startsWith("Your meeting link is ready: https://meet.google.com/provider-test\n"));
  const text = result.link.payload.text;
  const html = result.link.payload.html;
  assert.doesNotMatch(text, /Calendar (?:setup|state):/);
  for (const fact of ["Provider host", "Provider event", "UTC", "Australia/Brisbane", "30 minutes", "Google Meet: https://meet.google.com/provider-test", "Join session: https://meet.google.com/provider-test", "Manage this booking:", "Add to calendar:", "/api/public/manage/"]) {
    assert.ok(result.link.payload.text.includes(fact), `link-ready plain text includes ${fact}`);
  }
  assert.match(result.link.payload.html, /<table\b/);
  assert.ok(result.link.payload.html.includes("Provider host"));
  assert.ok(result.link.payload.html.includes("Provider event"));
  assert.ok(result.link.payload.html.includes("UTC"));
  assert.ok(result.link.payload.html.includes("Australia/Brisbane"));
  assert.ok(result.link.payload.html.includes("30 minutes"));
  assert.ok(hasHref(result.link.payload.html, "https://meet.google.com/provider-test"));
  assert.ok(result.link.payload.html.includes("Join session"));
  assert.ok(result.link.payload.html.includes("Manage booking"));
  assert.ok(result.link.payload.html.includes("Add to calendar"));
  for (const prefix of ["Event: ", "Host: ", "Invitee time: ", "Host time: ", "Duration: ", "Location: "]) {
    const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
    assert.ok(line, `link-ready plain text has ${prefix.trimEnd()} fact`);
    const value = line.slice(prefix.length).replace(/\.$/, "");
    assert.ok(html.includes(value), `link-ready HTML preserves the ${prefix.trimEnd()} fact`);
  }
  const htmlWithDecodedSeparators = html.replaceAll("&amp;", "&");
  for (const prefix of ["Join session: ", "Manage this booking: ", "Add to calendar: "]) {
    const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
    assert.ok(line, `link-ready plain text has the ${prefix.trimEnd()} action`);
    assert.ok(htmlWithDecodedSeparators.includes(line.slice(prefix.length)), `link-ready HTML preserves the ${prefix.trimEnd()} URL`);
  }
  for (const label of ["Join session", "Manage booking", "Add to calendar"]) assert.ok(html.includes(label));
  assert.equal(result.selectedCurrentCapability, true, "link-ready uses the invitee capability for its own occurrence despite a later-updated old occurrence mail");
  assert.equal(result.selectedCapabilityActive, true, "the selected current-occurrence manage URL remains an active booking capability");
  assert.equal(result.managedEventIcalUid, "dial-provider-booking@dial", "Google and ICS retain the same stable UID");
  assert.equal(result.sent, 1, "the queued link-ready notification is processed on the next durable delivery pass");
});

contract("CAL-003", "a stale in-flight calendar completion succeeds once without changing the replacement occurrence", async (context) => {
  const worker = await startWorker(context);
  const result = await readJson(await fetch(`${worker.origin}/stale-calendar-finish`));
  assertExactKeys(result, ["interleavingOccurred", "first", "second", "providerCalls", "command", "attempt", "booking", "linkReadyCount"], "stale calendar result");
  assert.equal(result.interleavingOccurred, true, "the fixture reschedules after the coherent mail snapshot but before guarded writes");
  assert.equal(result.first, "succeeded");
  assert.equal(result.second, "not_due");
  assert.equal(result.providerCalls, 1, "a completed provider effect is never replayed");
  assert.deepEqual(result.command, { state: "succeeded", attempts: 1, lastErrorCode: null });
  assert.deepEqual(result.attempt, { outcome: "succeeded", errorCode: null });
  assert.deepEqual(result.booking, { calendarState: "pending", meetingState: "pending" }, "the stale provider result does not overwrite replacement-occurrence state");
  assert.equal(result.linkReadyCount, 0, "a stale completion does not queue a link-ready message");
});

// C.1 requires one invitee notice even when token authority changes after the coherent snapshot.
contract("NOTIFY-002", "a manage-token rotation between link-ready snapshot and insert preserves one notice with the active capability", async (context) => {
  const worker = await startWorker(context);
  const result = await readJson(await fetch(`${worker.origin}/rotated-capability-finish`));
  assertExactKeys(result, ["interleavingOccurred", "currentCapabilityUpdated", "activeCapability", "first", "second", "providerCalls", "command", "booking", "linkReadyCount", "linkReadyState", "linkReadyQueuedOldCapability", "linkReadyDelivery", "linkReadySentCurrentCapability", "linkReadySentNoRevokedCapability", "linkReadyFrozenCapability", "linkReadyFrozenWireMatchesSend"], "rotated-capability result");
  assert.equal(result.interleavingOccurred, true, "the fixture rotates after the coherent mail snapshot but before guarded writes");
  assert.equal(result.currentCapabilityUpdated, true, "production token rotation updates the current invitee capability");
  assert.equal(result.activeCapability, true, "the rotated capability remains active in the booking token table");
  assert.equal(result.first, "succeeded");
  assert.equal(result.second, "not_due");
  assert.equal(result.providerCalls, 1, "the completed calendar effect is never replayed");
  assert.deepEqual(result.command, { state: "succeeded", attempts: 1, lastErrorCode: null });
  assert.deepEqual(result.booking, { calendarState: "succeeded", meetingState: "succeeded" });
  assert.equal(result.linkReadyCount, 1, "rotation does not suppress the one durable invitee notice for the current occurrence");
  assert.equal(result.linkReadyQueuedOldCapability, true, "the race fixture proves the coherent calendar snapshot carried the now-revoked URL");
  assert.equal(result.linkReadyDelivery, "succeeded");
  assert.equal(result.linkReadyState, "succeeded");
  assert.equal(result.linkReadySentCurrentCapability, true, "dispatch refreshes both text and HTML before freezing provider bytes");
  assert.equal(result.linkReadySentNoRevokedCapability, true, "neither sent part contains the revoked capability");
  assert.equal(result.linkReadyFrozenCapability, true, "the unfrozen queue payload is repaired to the active capability");
  assert.equal(result.linkReadyFrozenWireMatchesSend, true, "the frozen wire payload is the exact first provider attempt");
});

contract("NOTIFY-002", "a pending Meet schedules a bounded durable poll and sends exactly one link-ready command after completion", async (context) => {
  const worker = await startWorker(context);
  const result = await readJson(await fetch(`${worker.origin}/pending-meet`));
  assert.deepEqual(result, {
    pendingState: "pending",
    pollAttempt: 1,
    meeting: { meetingState: "succeeded", meetingUrl: "https://meet.google.com/provider-test" },
    linkReadyCommands: 1,
  });
});

async function startWorker(context) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-provider-d1-"));
  const port = String(15712);
  const origin = `http://127.0.0.1:${port}`;
  context.after(() => rm(persist, { recursive: true, force: true }));
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-provider-runtime-test", "--local", "--persist-to", persist, "--config", "tests/providers-worker.wrangler.toml"]);
  const child = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", "tests/providers-worker.wrangler.toml", "--ip", "127.0.0.1", "--port", port, "--inspector-port", "15722"], { cwd: new URL("../", import.meta.url), stdio: "pipe", detached: true });
  const output = capture(child);
  context.after(() => stop(child));
  await waitForReady(origin, child, output);
  return { origin };
}

async function readJson(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(`Provider runtime response ${response.status}: ${body}`);
  return JSON.parse(body);
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

async function waitForReady(origin, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`provider D1 Worker exited before serving requests: ${output.text.slice(-4_000)}`);
    try {
      const response = await fetch(`${origin}/oauth`);
      if (response.ok) return;
    } catch {
      // A cold Worker needs a short time before D1 opens.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 125));
  }
  throw new Error(`provider D1 Worker did not become ready: ${output.text.slice(-4_000)}`);
}

function capture(child) {
  const output = { text: "" };
  child.stdout?.on("data", (chunk) => { output.text += chunk; });
  child.stderr?.on("data", (chunk) => { output.text += chunk; });
  return output;
}

function stop(child) {
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
