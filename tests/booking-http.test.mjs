import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { contract } from "./contract.mjs";

contract("AUTH-002", "the public Hono flow binds a nonce to its selected event and replays only an identical confirmation", async (context) => {
  const server = await startWorker(context);
  await fetch(`${server.origin}/fixture`);
  const event = await readJson(await fetch(`${server.origin}/api/public/events/dial-host/intro`), "public event");
  assert.doesNotMatch(JSON.stringify(event), /"id"|eventTypeId|locationValue|operator|createdAt|updatedAt/i, "the actual published-event HTTP DTO excludes database IDs, private location delivery values, and operator fields");
  const availability = await readJson(await fetch(`${server.origin}/api/public/book/dial-host/intro/availability`), "availability");
  assert.equal(availability.state, "available");
  const slot = availability.slots[0];
  const selection = await readJson(await fetch(`${server.origin}/api/public/book/dial-host/intro/selection`, json({ startAt: slot.startAt, inviteeTimezone: "UTC" })), "selection");
  const selectionQuery = new URLSearchParams({ nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC" });
  const selectionReload = await fetch(`${server.origin}/api/public/book/dial-host/intro/selection?${selectionQuery}`);
  assert.equal(selectionReload.status, 200, "a details reload reads the still-valid capability");
  assert.deepEqual(await readJson(selectionReload, "selection reload"), {
    nonce: selection.nonce,
    expiresAt: selection.expiresAt,
    guestLimit: 0,
    selection: { startAt: selection.selection.startAt, endAt: selection.selection.endAt, hostTimezone: "UTC", inviteeTimezone: "UTC" },
    event: event.eventType,
    host: { avatarKey: null, handle: "dial-host", name: "Dial Host", title: "Host", biography: "Booking tests", timezone: "UTC", focusAreas: [], socialProof: [] },
  }, "the reload API returns only the public selection DTO");
  assert.equal((await fetch(`${server.origin}/book/dial-host/intro/details?${selectionQuery}`)).status, 200, "a valid details page capability renders the public surface");
  assert.equal((await fetch(`${server.origin}/book/dial-host/intro/details`)).status, 404, "a details route with no query is a recovery 404, never a validation 400");
  assert.equal((await fetch(`${server.origin}/book/dial-host/intro/details?startAt=${encodeURIComponent(slot.startAt)}&inviteeTimezone=UTC`)).status, 404, "details without a nonce is a recovery 404, never a validation 400");

  const expiringSlot = availability.slots[1];
  const expiringSelection = await readJson(await fetch(`${server.origin}/api/public/book/dial-host/intro/selection`, json({ startAt: expiringSlot.startAt, inviteeTimezone: "UTC" })), "expiring selection");
  await fetch(`${server.origin}/expire-selection`, json({ nonce: expiringSelection.nonce }));
  const expiredQuery = new URLSearchParams({ nonce: expiringSelection.nonce, startAt: expiringSlot.startAt, inviteeTimezone: "UTC" });
  assert.equal((await fetch(`${server.origin}/api/public/book/dial-host/intro/selection?${expiredQuery}`)).status, 410, "an expired selection API capability is explicit");
  assert.equal((await fetch(`${server.origin}/book/dial-host/intro/details?${expiredQuery}`)).status, 410, "an expired details capability renders its recovery surface");

  const body = { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name: "Invitee", email: "invitee@example.test", answers: { [event.eventType.questions[0].key]: "review" } };
  const created = await fetch(`${server.origin}/api/public/book/dial-host/intro/confirm`, json(body));
  assert.equal(created.status, 201, await created.clone().text());
  const receipt = await readJson(created, "created confirmation");
  assert.ok(receipt.manageUrl.includes("/manage/"));
  assert.doesNotMatch(JSON.stringify(receipt), /bookingId|eventTypeId|locationValue|operator/i, "public confirmation excludes internal/operator fields");
  const manageToken = new URL(receipt.manageUrl).pathname.split("/").at(-1);
  assert.ok(manageToken, "receipt has a capability token");
  assert.deepEqual(await readJson(await fetch(`${server.origin}/api/public/manage/${manageToken}`), "receipt reload"), receipt, "the receipt reload is capability-authorized and stable");
  assert.equal((await fetch(`${server.origin}/book/dial-host/intro/confirmed?token=${manageToken}`)).status, 200, "a receipt route is bound to its matching public event");
  assert.equal((await fetch(`${server.origin}/book/dial-host/other/confirmed?token=${manageToken}`)).status, 404, "a receipt capability cannot be replayed through another event URL");
  assert.equal((await fetch(`${server.origin}/book/dial-host/intro/confirmed`)).status, 404, "a receipt route without its token is a recovery 404");
  assert.equal((await fetch(`${server.origin}/book/dial-host/intro/details?${selectionQuery}`)).status, 410, "a consumed selection becomes a recovery 410 rather than exposing the details form");

  const replay = await fetch(`${server.origin}/api/public/book/dial-host/intro/confirm`, json(body));
  assert.equal(replay.status, 200);
  assert.deepEqual(await readJson(replay, "replay confirmation"), receipt, "identical replay returns the stored booking result");

  const changed = await fetch(`${server.origin}/api/public/book/dial-host/intro/confirm`, json({ ...body, name: "Other invitee" }));
  assert.equal(changed.status, 409, "different replay payload creates no second booking");
  const mismatchedEvent = await fetch(`${server.origin}/api/public/book/dial-host/other/confirm`, json(body));
  assert.equal(mismatchedEvent.status, 404, "a nonce cannot be replayed through another public event URL");
  const missingNonce = await fetch(`${server.origin}/api/public/book/dial-host/intro/confirm`, json({ ...body, nonce: undefined }));
  assert.equal(missingNonce.status, 404, "missing capability material is a recovery 404, never a mutation");

  const status = await readJson(await fetch(`${server.origin}/status`), "transaction status");
  assert.equal(status.bookings, 1);
  assert.deepEqual(status.outbox.map((entry) => entry.kind), ["calendar_upsert", "mail_send", "mail_send"], "the booking, calendar command, invitee email, and operator email commit together");
  assert.equal(status.outbox[0].payload.locationType, "google_meet");
  const inviteeMail = status.outbox.find((entry) => entry.kind === "mail_send" && entry.payload.recipientRole === "invitee");
  assert.ok(inviteeMail, "the transactional invitee command is present");
  assert.equal(inviteeMail.payload.attachments[0].filename, "booking.ics", "the invitee confirmation atomically includes the current calendar file");
  assert.match(Buffer.from(inviteeMail.payload.attachments[0].contentBase64, "base64").toString("utf8"), /UID:dial-/);
});

contract("AUTH-001", "the invitation manage capability and the booking manage capability each open only their own declared public surface; anonymous, forged and crossed tokens change nothing", async (context) => {
  const { deploy } = JSON.parse(await readFile(new URL("../seed.json", import.meta.url), "utf8"));
  const declared = path => deploy.publicPaths.some(entry => entry.endsWith("/") && entry !== "/" ? path.startsWith(entry) : path === entry);
  for (const path of ["/manage/invite/token", "/api/public/manage/invite/token", "/api/public/manage/invite/token/email"]) assert.ok(declared(path), `${path} is a declared public path`);
  const server = await startWorker(context);
  await fetch(`${server.origin}/fixture`);
  const event = await readJson(await fetch(`${server.origin}/api/public/events/dial-host/intro`), "public event");
  const [slot] = (await readJson(await fetch(`${server.origin}/api/public/book/dial-host/intro/availability`), "availability")).slots;
  const selection = await readJson(await fetch(`${server.origin}/api/public/book/dial-host/intro/selection`, json({ startAt: slot.startAt, inviteeTimezone: "UTC" })), "selection");
  const created = await fetch(`${server.origin}/api/public/book/dial-host/intro/confirm`, json({ nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name: "Invitee", email: "invitee@example.test", answers: { [event.eventType.questions[0].key]: "review" } }));
  assert.equal(created.status, 201, await created.clone().text());
  const receipt = await readJson(created, "confirmation");
  const manageToken = new URL(receipt.manageUrl).pathname.split("/").at(-1);
  const invitationToken = new URL((await readJson(await fetch(`${server.origin}/invitation-link`), "invitation link")).url).pathname.split("/").at(-1);
  const flipped = `${invitationToken.slice(0, -1)}${invitationToken.endsWith("A") ? "B" : "A"}`;
  const before = await readJson(await fetch(`${server.origin}/status`), "status before");
  const refused = [
    ["GET", `/manage/invite/${flipped}`, 404], ["GET", `/api/public/manage/invite/${flipped}`, 404], ["POST", `/api/public/manage/invite/${flipped}/email`, 404],
    ["GET", "/manage/invite/unknown", 404], ["POST", "/api/public/manage/invite/unknown/email", 404],
    ["GET", `/manage/invite/${manageToken}`, 404], ["GET", `/api/public/manage/invite/${manageToken}`, 404], ["POST", `/api/public/manage/invite/${manageToken}/email`, 404],
    ["GET", `/manage/${invitationToken}`, 404], ["GET", `/api/public/manage/${invitationToken}`, 404],
    ["POST", `/api/public/manage/${invitationToken}/cancel`, 404, { reason: "crossed capability" }],
  ];
  for (const [method, path, status, body = {}] of refused) {
    const response = await fetch(`${server.origin}${path}`, method === "GET" ? {} : json(body));
    assert.equal(response.status, status, `${method} ${path}`);
    assert.doesNotMatch(await response.text(), /invitee@example\.test|Invitee|Introductory call/, `${method} ${path} discloses no booking`);
  }
  assert.deepEqual(await readJson(await fetch(`${server.origin}/status`), "status after"), before, "refused requests create, queue and rotate nothing");
  assert.deepEqual(await readJson(await fetch(`${server.origin}/api/public/manage/invite/${invitationToken}`), "invitation projection"), { available: true }, "the invitation capability opens only its field-free projection");
  assert.equal((await fetch(`${server.origin}/manage/invite/${invitationToken}`)).status, 200);
  assert.deepEqual(await readJson(await fetch(`${server.origin}/api/public/manage/${manageToken}`), "receipt"), receipt, "the booking capability still reads its own booking unchanged");
});

async function startWorker(context) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-booking-http-"));
  const port = String(15714);
  const origin = `http://127.0.0.1:${port}`;
  context.after(() => rm(persist, { recursive: true, force: true }));
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-booking-http-test", "--local", "--persist-to", persist, "--config", "tests/booking-http-worker.wrangler.toml"]);
  const worker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", "tests/booking-http-worker.wrangler.toml", "--ip", "127.0.0.1", "--port", port, "--inspector-port", "15724"], { cwd: new URL("../", import.meta.url), stdio: "pipe", detached: true });
  const workerOutput = captureOutput(worker);
  context.after(() => stop(worker));
  await waitForReady(origin, worker, workerOutput);
  return { origin };
}

function json(body) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function readJson(response, name) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} was not JSON (${response.status}): ${text.slice(0, 500)}`);
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

async function waitForReady(origin, worker, workerOutput) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (worker.exitCode !== null) throw new Error(`booking HTTP Worker exited before serving requests: ${workerOutput.text}`);
    try {
      const response = await fetch(`${origin}/status`);
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const status = await response.json();
        if (typeof status.bookings === "number" && Array.isArray(status.outbox)) return;
      }
    } catch {
      // A cold local Worker needs several seconds before its D1 binding is available.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 125));
  }
  throw new Error(`booking HTTP Worker did not become ready within 10 seconds: ${workerOutput.text}`);
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
