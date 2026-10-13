import { readLocalOutbox, seedDemoWorkspace, localMagicLink, confirmAuthLink, bootstrapTestOwner } from "./auth-client.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contractTitle } from "./contract.mjs";

const port = String(15710);
const origin = `http://127.0.0.1:${port}`;
const isolatedEnvironment = `runtime-${port}`;
const isolatedWranglerConfig = `.wrangler-${isolatedEnvironment}.toml`;

test("operator authentication is non-enumerating, local-only, replay-safe, and revocable", async (context) => {
  const persistState = await mkdtemp(resolve(tmpdir(), "dial-runtime-"));
  const server = spawn(process.execPath, ["tests/runtime-server.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, OWNER_EMAIL: "operator@dial.test", SETUP_TOKEN: "dial-test-only-setup-token-at-least-32", MAIL_FROM: "no-reply@dial.test", DIAL_PORT: port, DIAL_PERSIST_STATE_DIR: persistState, DIAL_DEV_ENV: isolatedEnvironment, DIAL_WRANGLER_CONFIG_PATH: isolatedWranglerConfig, DIAL_INSPECTOR_PORT: "15720" },
    stdio: "pipe",
    detached: true,
  });
  context.after(() => stopServer(server));
  context.after(() => rm(persistState, { recursive: true, force: true }));
  context.after(() => rm(new URL(`../.dev.vars.${isolatedEnvironment}`, import.meta.url), { force: true }));
  context.after(() => rm(new URL(`../${isolatedWranglerConfig}`, import.meta.url), { force: true }));

  const output = captureOutput(server);
  await waitForHealth(server, output);
  await context.test(contractTitle("HOME-001", "a fresh install without a host profile serves the landing at /, with no cookie and no booking link"), async () => {
    const fresh = await fetch(`${origin}/`);
    assert.equal(fresh.status, 200, "the landing renders without a host profile instead of the recovery page");
    assert.equal(fresh.headers.get("set-cookie"), null, "the landing sets no cookie");
    const html = await fresh.text();
    assert.equal(html.match(/<h1[\s>]/g)?.length, 1, "the landing has one h1");
    assert.doesNotMatch(html, /pb-recovery/, "the recovery page is not served at /");
    assert.doesNotMatch(html, /href="\/book\//, "no booking-profile link without a profile");
  });
  await bootstrapTestOwner(origin);

  const forgedApp = await fetch(`${origin}/app`, { headers: { cookie: "operator_session_local=forged" }, redirect: "manual" });
  assert.equal(forgedApp.status, 302);
  assert.match(forgedApp.headers.get("location") ?? "", /^\/signin\?next=/);

  const forgedApi = await fetch(`${origin}/api/app/profile`, { headers: { cookie: "operator_session_local=forged" } });
  assert.equal(forgedApi.status, 401);

  const unknown = await requestMagicLink("not-an-operator@dial.test");
  const beforeKnown = await readLocalOutbox(origin);
  const known = await requestMagicLink("operator@dial.test");
  assert.equal(unknown.status, 202);
  assert.equal(known.status, 202);
  assert.deepEqual(await unknown.json(), await known.json(), "the request response must not reveal operator membership");
  assert.deepEqual(beforeKnown, [], "an unknown address produces no local mail");

  const { developmentLink } = await localMagicLink(origin);
  assert.equal(typeof developmentLink, "string");
  assert.ok(developmentLink.startsWith(`${origin}/auth/confirm?token=`), "the generated link uses the active local APP_URL port");

  const verified = await confirmAuthLink(developmentLink);
  assert.equal(verified.status, 303);
  const cookie = verified.headers.get("set-cookie");
  assert.match(cookie ?? "", /operator_session_local=/);
  assert.match(cookie ?? "", /HttpOnly/);
  assert.match(cookie ?? "", /SameSite=Lax/);
  assert.doesNotMatch(cookie ?? "", /; Secure/, "development cookies deliberately omit Secure for loopback HTTP");
  const sessionCookie = cookie?.split(";")[0] ?? "";

  const replay = await confirmAuthLink(developmentLink);
  assert.equal(replay.status, 400, "magic links are single-use");

  await seedDemoWorkspace(origin, sessionCookie);
  const profile = await fetch(`${origin}/api/app/profile`, { headers: { cookie: sessionCookie } });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).handle, "maya-chen");

  const signedOut = await fetch(`${origin}/api/auth/sign-out`, { method: "POST", headers: { Origin: origin, cookie: sessionCookie } });
  assert.equal(signedOut.status, 204);
  assert.match(signedOut.headers.get("set-cookie") ?? "", /Max-Age=0/);
  const afterSignOut = await fetch(`${origin}/api/app/profile`, { headers: { cookie: sessionCookie } });
  assert.equal(afterSignOut.status, 401, "sign-out revokes the persisted session");
  // The outbox is reachable only on this loopback-bound development Worker.
  await requestMagicLink("operator@dial.test");
  const { developmentLink: secondDevelopmentLink } = await localMagicLink(origin);
  const secondVerification = await confirmAuthLink(secondDevelopmentLink);
  const secondCookie = secondVerification.headers.get("set-cookie")?.split(";")[0] ?? "";

  const invalid = await fetch(`${origin}/api/app/event-types`, { method: "POST", headers: { cookie: secondCookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_request", "all zod boundary errors use the shared error envelope");

  const updatedProfile = await fetch(`${origin}/api/app/profile`, {
    method: "PATCH",
    headers: { cookie: secondCookie, "content-type": "application/json" },
    body: JSON.stringify({
      handle: "maya-chen", name: "Maya Chen", title: "Product strategy for independent teams", biography: "I help independent teams decide what to build next.", timezone: "Australia/Brisbane",
      focusAreas: [{ label: "Product strategy" }], socialProof: [{ quote: "Clear and useful.", attribution: "A client" }],
    }),
  });
  assert.equal(updatedProfile.status, 200, await updatedProfile.clone().text());
  assert.deepEqual((await updatedProfile.json()).socialProof, [{ quote: "Clear and useful.", attribution: "A client" }]);

  const invalidTimezone = await fetch(`${origin}/api/app/profile`, {
    method: "PATCH",
    headers: { cookie: secondCookie, "content-type": "application/json" },
    body: JSON.stringify({
      handle: "maya-chen", name: "Maya Chen", title: "Product strategy for independent teams", biography: "I help independent teams decide what to build next.", timezone: "Mars/Olympus",
      focusAreas: [{ label: "Product strategy" }], socialProof: [],
    }),
  });
  assert.equal(invalidTimezone.status, 400, "host timezone must be a canonical IANA identifier");

  const slug = `runtime-${Date.now().toString(36)}`;
  const payload = {
    slug, title: "Runtime configuration", description: "An integration-tested draft event.", durationMinutes: 5, color: "#176b5a",
    locationType: "fixed_link", locationLabel: "Video call", locationValue: "https://meet.example/private-room", listed: true, alternativeRequestsEnabled: true,
    slotIncrementMinutes: 15, minimumNoticeMinutes: 120, bookingHorizonDays: 45, beforeBufferMinutes: 10, afterBufferMinutes: 5, hostDayBookingLimit: null,
    questions: [{ kind: "single_choice", label: "Goal", required: true, options: [{ value: "strategy", label: "Product strategy" }] }],
    availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  };
  const created = await fetch(`${origin}/api/app/event-types`, { method: "POST", headers: { cookie: secondCookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(created.status, 201);
  const event = await created.json();
  assert.equal(event.durationMinutes, 5, "the lower event duration bound is accepted");
  assert.equal(event.locationValue, payload.locationValue, "operator routes retain private delivery values");
  assert.deepEqual(event.questions[0].options, payload.questions[0].options);

  const replacement = {
    ...payload,
    title: "Runtime configuration revised",
    durationMinutes: 480,
    questions: [{ kind: "checkbox", label: "Agree to preparation", required: true, options: [{ value: "agree", label: "I agree" }] }],
    availability: [{ weekday: 2, startMinute: 600, endMinute: 900 }],
  };
  const updatedEvent = await fetch(`${origin}/api/app/event-types/${event.id}`, { method: "PATCH", headers: { cookie: secondCookie, "content-type": "application/json" }, body: JSON.stringify(replacement) });
  assert.equal(updatedEvent.status, 200);
  const replaced = await updatedEvent.json();
  assert.deepEqual(replaced.questions.map((question) => ({ kind: question.kind, label: question.label, required: question.required, options: question.options })), replacement.questions, "question children are replaced as one persisted set");
  assert.ok(replaced.questions.every((question) => typeof question.key === "string"), "persisted questions receive stable public answer keys");
  assert.deepEqual(replaced.availability, replacement.availability, "availability children are replaced as one persisted set");
  assert.equal(replaced.durationMinutes, 480, "the upper event duration bound is accepted");

  for (const durationMinutes of [4, 481]) {
    const invalidDuration = await fetch(`${origin}/api/app/event-types`, {
      method: "POST",
      headers: { cookie: secondCookie, "content-type": "application/json" },
      body: JSON.stringify({ ...payload, slug: `${slug}-${durationMinutes}`, durationMinutes }),
    });
    assert.equal(invalidDuration.status, 400, `${durationMinutes} minutes is outside the event duration range`);
  }

  const overrideDate = hostDateOffset(2);
  const openedOverride = await fetch(`${origin}/api/app/event-types/${event.id}/availability-overrides/${overrideDate}`, {
    method: "PUT",
    headers: { cookie: secondCookie, "content-type": "application/json" },
    body: JSON.stringify({ mode: "open", windows: [{ startMinute: 540, endMinute: 720 }] }),
  });
  assert.equal(openedOverride.status, 200, await openedOverride.clone().text());
  assert.deepEqual((await openedOverride.json()).windows, [{ startMinute: 540, endMinute: 720 }]);

  const replacedOverride = await fetch(`${origin}/api/app/event-types/${event.id}/availability-overrides/${overrideDate}`, {
    method: "PUT",
    headers: { cookie: secondCookie, "content-type": "application/json" },
    body: JSON.stringify({ mode: "open", windows: [{ startMinute: 780, endMinute: 900 }] }),
  });
  assert.equal(replacedOverride.status, 200);
  assert.deepEqual((await replacedOverride.json()).windows, [{ startMinute: 780, endMinute: 900 }], "replacement removes stale override windows atomically");

  const closedOverride = await fetch(`${origin}/api/app/event-types/${event.id}/availability-overrides/${overrideDate}`, {
    method: "PUT",
    headers: { cookie: secondCookie, "content-type": "application/json" },
    body: JSON.stringify({ mode: "closed", windows: [] }),
  });
  assert.equal(closedOverride.status, 200);
  const closed = await closedOverride.json();
  assert.equal(closed.hostDate, overrideDate);
  assert.equal(closed.mode, "closed");
  assert.deepEqual(closed.windows, []);

  const overrides = await fetch(`${origin}/api/app/event-types/${event.id}/availability-overrides`, { headers: { cookie: secondCookie } });
  assert.equal(overrides.status, 200);
  assert.deepEqual((await overrides.json()).map((override) => ({ hostDate: override.hostDate, mode: override.mode, windows: override.windows })), [{ hostDate: overrideDate, mode: "closed", windows: [] }]);

  const malformedOverride = await fetch(`${origin}/api/app/event-types/${event.id}/availability-overrides/2026-02-30`, {
    method: "PUT",
    headers: { cookie: secondCookie, "content-type": "application/json" },
    body: JSON.stringify({ mode: "closed", windows: [] }),
  });
  assert.equal(malformedOverride.status, 400, "override dates must be real ISO host dates");
  const pastOverride = await fetch(`${origin}/api/app/event-types/${event.id}/availability-overrides/${hostDateOffset(-2)}`, {
    method: "PUT",
    headers: { cookie: secondCookie, "content-type": "application/json" },
    body: JSON.stringify({ mode: "closed", windows: [] }),
  });
  assert.equal(pastOverride.status, 409, "past host dates cannot be modified");

  const deletedOverride = await fetch(`${origin}/api/app/event-types/${event.id}/availability-overrides/${overrideDate}`, { method: "DELETE", headers: { cookie: secondCookie } });
  assert.equal(deletedOverride.status, 204);

  const publicDraft = await fetch(`${origin}/api/public/events/maya-chen/${slug}`);
  assert.equal(publicDraft.status, 404, "draft events are never exposed from public routes");

  const publicProfile = await fetch(`${origin}/api/public/profiles/maya-chen`);
  assert.equal(publicProfile.status, 200);
  const publicProfilePayload = await publicProfile.json();
  assert.equal(publicProfilePayload.profile.handle, "maya-chen");
  assert.ok(!("id" in publicProfilePayload.profile), "public profiles exclude persistence IDs");
  assert.ok(!("createdAt" in publicProfilePayload.profile), "public profiles exclude persistence timestamps");
  assert.ok(!publicProfilePayload.eventTypes.some((entry) => entry.slug === slug), "draft event types are excluded from public profile listings");

  const publicProfileSurface = await fetch(`${origin}/book/maya-chen`);
  assert.equal(publicProfileSurface.status, 200, "a configured profile is a valid public surface");
  assert.match(await publicProfileSurface.text(), /id="root"/, "the Worker serves the React recovery-capable shell");

  const draftSurface = await fetch(`${origin}/book/maya-chen/${slug}`);
  assert.equal(draftSurface.status, 404, "draft event routes are indistinguishable from unknown public routes");
  assert.doesNotMatch(await draftSurface.text(), new RegExp(payload.locationValue), "a public recovery surface never leaks an event's private location value");

  const unknownProfileSurface = await fetch(`${origin}/book/no-such-host`);
  assert.equal(unknownProfileSurface.status, 404);
  assert.match(await unknownProfileSurface.text(), /id="root"/);
  const detailsSurface = await fetch(`${origin}/book/maya-chen/${slug}/details`);
  assert.equal(detailsSurface.status, 404, "direct booking details without a capability nonce expose no data");
  const confirmationSurface = await fetch(`${origin}/book/maya-chen/${slug}/confirmed`);
  assert.equal(confirmationSurface.status, 404, "direct confirmation without a capability nonce exposes no data");
  const manageSurface = await fetch(`${origin}/manage/not-a-real-token`);
  assert.equal(manageSurface.status, 404, "an unknown manage token receives recovery without booking data");

  const publicAvailability = await fetch(`${origin}/api/public/events/maya-chen/${slug}/availability`);
  assert.equal(publicAvailability.status, 404, "availability cannot be queried for a draft event");

  const home = await fetch(`${origin}/api/public/home/profile`);
  assert.equal(home.status, 200);
  assert.ok(!(await home.json()).eventTypes.some((entry) => entry.slug === slug), "only published and listed events appear on the public home profile route");
  await context.test(contractTitle("HOME-001", "with a host profile, / links to the host's booking profile and sets no cookie"), async () => {
    const homeSurface = await fetch(`${origin}/`);
    assert.equal(homeSurface.status, 200, "the owner landing is a Worker-first public surface");
    assert.equal(homeSurface.headers.get("set-cookie"), null, "the landing sets no cookie");
    assert.match(await homeSurface.text(), /href="\/book\/maya-chen"/, "the landing links to the configured host's booking profile");
  });

  const privacySurface = await fetch(`${origin}/privacy`);
  assert.equal(privacySurface.status, 200, "the configured privacy notice is a real local public surface");

  for (const path of ["/docs", "/docs/", "/docs/install"]) {
    const docsSurface = await fetch(`${origin}${path}`);
    assert.equal(docsSurface.status, 200, `${path} is a public documentation page`);
    assert.equal(docsSurface.headers.get("set-cookie"), null, `${path} sets no cookie`);
    assert.equal((await docsSurface.text()).match(/<h1[\s>]/g)?.length, 1, `${path} has the page title as its one h1`);
  }
  for (const path of ["/docs/nope", "/docs/Install", "/docs/install/extra"]) {
    const unknownDocs = await fetch(`${origin}${path}`);
    assert.equal(unknownDocs.status, 404, `${path} is the existing not-found page`);
    assert.match(await unknownDocs.text(), /id="root"/);
  }

  const embedSurface = await fetch(`${origin}/embed/maya-chen/${slug}`);
  assert.equal(embedSurface.status, 404, "embed remains unavailable until the full embed capability exists");
  assert.equal(embedSurface.headers.get("x-frame-options"), "DENY");
  assert.match(embedSurface.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

  await executeD1(persistState, `UPDATE event_types SET status = 'published', alternative_requests_enabled = 0 WHERE id = '${event.id}'`);
  const disabledRequest = await fetch(`${origin}/book/maya-chen/${slug}/request`);
  assert.equal(disabledRequest.status, 404, "an event without alternative requests cannot expose the request route");

  const disabled = await fetch(`${origin}/api/app/event-types/${event.id}/disable`, { method: "POST", headers: { cookie: secondCookie } });
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).status, "disabled");
  const deleted = await fetch(`${origin}/api/app/event-types/${event.id}`, { method: "DELETE", headers: { cookie: secondCookie } });
  assert.equal(deleted.status, 204);
});

async function requestMagicLink(email) {
  return fetch(`${origin}/api/auth/magic-links`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

function captureOutput(server) {
  const output = { text: "" };
  server.stdout?.on("data", (chunk) => { output.text += chunk; });
  server.stderr?.on("data", (chunk) => { output.text += chunk; });
  return output;
}

async function waitForHealth(server, output) {
  for (let attempt = 0; attempt < 480; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`pnpm dev exited: ${output.text.slice(-4_000)}`);
    try {
      if ((await fetch(`${origin}/health`)).ok) return;
    } catch {
      // The Worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`pnpm dev did not become healthy within 60 seconds: ${output.text.slice(-4_000)}`);
}

function stopServer(server) {
  if (server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

function executeD1(persistState, command) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", "d1", "execute", "dial-local", "--local", "--persist-to", persistState, "--config", isolatedWranglerConfig, "--command", command], {
      cwd: new URL("../", import.meta.url),
      stdio: "pipe",
      env: { ...process.env, CI: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Could not update isolated D1: ${output}`)));
  });
}

function hostDateOffset(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
