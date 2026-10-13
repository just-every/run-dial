import { evidencePath } from "../../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { admit, call, counts, data, origin, product, reset, state } from "./helpers.mjs";

export async function verifyNative() {
  const checks = [], mark = (name) => { checks.push(name); console.log(`PASS ${name}`); };
  const fixture = await data("/__fixtures/setup", {});
  const event = await data("/api/public/events/dial-host/intro");
  const ip = "203.0.113.10", now = Date.UTC(2030, 0, 1, 0, 0, 59);
  const ordinary = { path: "/api/public/events/dial-host/intro", ip, now };
  await reset();
  assert.deepEqual(counts(await admit({ ...ordinary, count: 120 })), { admitted: 120 });
  assert.equal((await admit({ ...ordinary, now: now + 2000 }))[0].kind, "limited");
  assert.equal((await admit({ ...ordinary, now: now + 2000 }))[0].retryAfterSeconds, 58);
  assert.equal((await admit({ ...ordinary, now: now + 60000 }))[0].kind, "admitted");
  assert.equal((await state()).rates.length, 1);
  mark("public admission permits exactly120 and uses a strict rolling minute across the clock-minute boundary");

  await reset();
  const mutation = { ...ordinary, path: "/api/public/book/dial-host/intro/confirm", method: "POST" };
  assert.deepEqual(counts(await admit({ ...mutation, count: 8 })), { admitted: 8 });
  assert.equal((await admit({ ...mutation, path: "/api/public/manage/synthetic-capability/cancel" }))[0].kind, "admitted");
  assert.equal((await admit({ ...mutation, path: "/api/public/manage/synthetic-capability/reschedule" }))[0].kind, "admitted");
  assert.equal((await admit(mutation))[0].kind, "limited");
  assert.equal((await state()).rates.length, 10);
  assert.deepEqual(counts(await admit({ ...ordinary, count: 110 })), { admitted: 110 });
  assert.equal((await admit(ordinary))[0].kind, "limited");
  mark("confirm, cancellation and actual reschedule share exactly10 admissions; a refused special budget does not consume the general budget");

  await reset();
  const alternative = { ...ordinary, path: "/api/public/events/dial-host/intro/request", method: "POST" };
  assert.deepEqual(counts(await admit({ ...alternative, count: 5 })), { admitted: 5 });
  assert.equal((await admit(alternative))[0].kind, "limited");
  assert.equal((await admit({ ...alternative, now: now + 60001 }))[0].kind, "limited");
  assert.equal((await admit({ ...alternative, now: now + 3600000 }))[0].kind, "admitted");
  mark("only submitted alternatives use the exact5-per-hour budget and retain it after the general minute expires");

  await reset();
  assert.deepEqual(counts(await admit({ ...ordinary, count: 150, concurrent: true })), { admitted: 120, limited: 30 });
  assert.equal((await state()).rates.length, 120);
  mark("150 simultaneous real D1 admission calls commit exactly120 admissions");

  await reset();
  assert.deepEqual(counts(await admit({ ...ordinary, ip: "2001:db8::1", count: 120 })), { admitted: 120 });
  assert.equal((await admit({ ...ordinary, ip: "2001:0DB8:0000:0000:0000:0000:0000:0001", forwardedFor: "198.51.100.200" }))[0].kind, "limited");
  assert.equal((await admit({ ...ordinary, production: true, ip: undefined, forwardedFor: "198.51.100.1" }))[0].code, "client_identity_unavailable");
  assert.equal((await admit({ ...ordinary, production: true, ip: "not-an-ip" }))[0].code, "client_identity_unavailable");
  assert.equal((await admit({ ...ordinary, production: true, ip: "192.0.2.1" }))[0].kind, "admitted");
  assert.equal((await admit({ ...ordinary, ip: undefined }))[0].kind, "admitted");
  const privacy = await state();
  const columns = privacy.columns.map((column) => column.name);
  assert.deepEqual(columns, ["id", "client_key", "booking_mutation", "alternative_submission", "provider", "admitted_at", "expires_at", "created_at", "updated_at"]);
  assert.ok(privacy.rates.every((row) => /^[A-Za-z0-9_-]{43}$/.test(row.client_key)));
  assert.ok(!JSON.stringify(privacy.rates).includes("2001:") && !JSON.stringify(privacy.rates).includes("synthetic-capability"));
  mark("IPv6 spelling shares one budget, forwarded identity is ignored, production identity fails closed, and stored rate rows contain hashes and bounded metadata only");

  await reset();
  const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
  const slot = availability.slots.find((candidate) => Date.parse(candidate.startAt) > Date.now() + 86400000);
  const selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slot.startAt, inviteeTimezone: "UTC" }, 201);
  const body = { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name: "Admission failure fixture", email: "admission-failure@dial.test", answers: { [event.eventType.questions[0].key]: "Synthetic answer" } };
  const beforeMissing = await product();
  await call("/__fixtures/admission/table", { disabled: true }, 204);
  try {
    const denied = await call("/api/public/book/dial-host/intro/confirm", body, 503);
    assert.equal((await denied.json()).error.code, "rate_limit_state_unavailable");
    await call("/api/webhooks/google-calendar", {}, 401);
    await call("/api/webhooks/resend", {}, 401);
    assert.deepEqual(await product(), beforeMissing);
  } finally { await call("/__fixtures/admission/table", { disabled: false }, 204); }
  mark("missing rate state refuses ordinary confirmation before nonce consumption or claims, while invalid callbacks still return401");

  const { channels } = await data("/__fixtures/admission/channels", {});
  assert.ok(channels.length >= 2);
  for (const provider of ["google_calendar", "resend"]) {
    await reset();
    assert.deepEqual(counts(await admit({ path: `/api/webhooks/${provider === "resend" ? "resend" : "google-calendar"}`, provider, method: "POST", now: Date.now(), count: 600, uniqueClients: true, concurrent: true })), { admitted: 600 });
    assert.equal((await admit({ path: "/api/webhooks/another-channel", provider, method: "POST", now: Date.now(), ip: "192.0.2.200" }))[0].kind, "limited");
    const before = (await state()).effects;
    if (provider === "google_calendar") {
      for (const channel of channels.slice(0, 2)) {
        const refused = await call("/api/webhooks/google-calendar", {}, 429, { "CF-Connecting-IP": "192.0.2.201", "x-goog-channel-id": channel.provider_channel_id, "x-goog-resource-id": channel.provider_resource_id, "x-goog-message-number": "999", "x-goog-channel-token": "synthetic-calendar-webhook-secret-for-test-only" });
        assert.ok(Number(refused.headers.get("Retry-After")) >= 1); assert.equal(refused.headers.get("Cache-Control"), "no-store");
      }
    } else {
      const payload = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "synthetic-admission-mail" } });
      const id = "synthetic-admission-event", timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", Buffer.from("a".repeat(32), "utf8")).update(`${id}.${timestamp}.${payload}`).digest("base64");
      await call("/api/webhooks/resend", payload, 429, { "CF-Connecting-IP": "192.0.2.201", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` });
    }
    await call(`/api/webhooks/${provider === "resend" ? "resend" : "google-calendar"}`, {}, 401);
    assert.deepEqual((await state()).effects, before);
    assert.equal((await state()).rates.length, 600);
  }
  mark("each fixed provider budget admits exactly600 across clients; authenticated callbacks then return429 without webhook, cache or delivery effects, across Google channel identities");

  const beforeExpiration = await product();
  await call("/__fixtures/admission/expire", { now: Date.now() + 3600001 }, 204);
  assert.equal((await state()).rates.length, 0); assert.deepEqual(await product(), beforeExpiration);
  mark("expiry removes only ephemeral admission rows and preserves product records");
  await reset();
  const restartIp = "198.51.100.77";
  assert.deepEqual(counts(await admit({ path: "/api/public/events/dial-host/intro", ip: restartIp, count: 120 })), { admitted: 120 });
  await writeFile(evidencePath("public-admission-native.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, fixture, checks, restartIp, restartPreloadedAt: Date.now(), limits: ["Provider600 and concurrent120 boundaries exercise the real D1 gate with a task-controlled clock/client set; actual authenticated callback refusals use the production HTTP pipeline."] }, null, 2) + "\n");
}
