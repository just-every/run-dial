import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { createOperatorAuth, createAuthHandler } from "../modules/operator-auth/index.mjs";
import { admitMailSource } from "./mail-source.mjs";

function binding(sqlite) {
  const prepare = (sql, args = []) => ({ bind: (...values) => prepare(sql, values),
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args), meta: { changes: Number(sqlite.prepare("SELECT changes() AS n").get().n) } }; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { results: [], meta: { changes: Number(result.changes) } }; },
  });
  return { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}
async function database(beforeAuth) {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of (await readdir(new URL("../migrations/core/", import.meta.url))).sort()) {
    if (name.startsWith("0016") && beforeAuth) await beforeAuth(sqlite);
    sqlite.exec(await readFile(new URL(`../migrations/core/${name}`, import.meta.url), "utf8"));
  }
  return { sqlite, db: binding(sqlite) };
}
async function load(path) {
  const bundle = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
}
const origin = "https://dial.example.test";
const secret = "isolated-test-session-secret-at-least-32";
const setup = "isolated-test-bootstrap-token-at-least-32";
const request = (path, body, headers = {}) => new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test("AUTH-001 OPER-001 OPER-002: empty setup uses input identity and scanner-safe Base capabilities", async () => {
  const { sqlite, db } = await database();
  const messages = [];
  const auth = createOperatorAuth({ db, config: { origin, OWNER_EMAIL: "initial@business.example", SESSION_SECRET: secret, SETUP_TOKEN: setup, MAIL_FROM: "signin@business.example" }, clientIp: () => "198.18.0.1", mailSender: { async send(message) { messages.push(message); return { status: "accepted", provider: "fixture", providerMessageId: null }; } } });
  const handle = createAuthHandler(auth);
  const payload = { token: setup, displayName: "Initial operator", returnTo: "/app" };
  assert.equal((await handle(request("/auth/bootstrap", payload, { Origin: "https://evil.example" }))).status, 403);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oa_operators").get().n, 0);
  const boot = await handle(request("/auth/bootstrap", payload)); assert.equal(boot.status, 303);
  assert.match(boot.headers.get("set-cookie"), /^__Host-operator_session=.*; Secure$/);
  const identity = sqlite.prepare("SELECT id,email FROM oa_operators").get(); assert.equal(identity.email, "initial@business.example");
  assert.equal(sqlite.prepare("SELECT operator_id FROM operator_setup_identity").get().operator_id, identity.id);
  assert.equal(sqlite.prepare("SELECT onboarding_completed_at FROM operator_setup_identity").get().onboarding_completed_at, null);
  for (const table of ["host_profiles", "event_types", "bookings", "availability_requests"]) assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table}: no sample data`);
  assert.equal((await handle(request("/auth/bootstrap", payload))).status, 409);
  await auth.requestMagicLink(request("/auth/magic-link", {}), { email: identity.email });
  const link = messages[0].text.match(/https:\/\/[^\s]+/)[0];
  const sessions = sqlite.prepare("SELECT count(*) AS n FROM oa_sessions").get().n;
  for (const method of ["GET", "HEAD", "GET"]) {
    const response = await handle(new Request(link, { method })); assert.equal(response.status, 200); assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oa_sessions").get().n, sessions);
    assert.equal(sqlite.prepare("SELECT consumed_at FROM oa_tokens").get().consumed_at, null);
  }
  const token = new URL(link).searchParams.get("token");
  assert.equal((await handle(request("/auth/confirm", { token }, { Origin: "null" }))).status, 403);
  const confirmation = await handle(request("/auth/confirm", { token })); assert.equal(confirmation.status, 303);
  assert.equal((await handle(request("/auth/confirm", { token }))).status, 400);
  const cookie = confirmation.headers.get("set-cookie").split(";")[0];
  assert.equal((await auth.getSession(request("/app", undefined, { cookie }))).operator.id, identity.id);
  await auth.signOut(request("/auth/signout", {}, { cookie }));
  assert.equal(await auth.getSession(request("/app", undefined, { cookie })), null);
  sqlite.close();
});

test("OPER-002 migration retains setup, authorship and notification generations while retiring legacy credentials", async () => {
  const { sqlite } = await database((db) => {
    db.exec(`INSERT INTO operators(id,email,normalized_email,created_at,updated_at) VALUES('legacy-owner','owner@business.example','owner@business.example','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
      INSERT INTO operator_setup_identity VALUES('default','legacy-owner','2026-01-01T00:00:00Z');
      INSERT INTO operator_sessions VALUES('old-session','legacy-owner','old-hash','2099-01-01','2026-01-01',NULL,'2026-01-01','2026-01-01');
      CREATE TABLE fixture_authored(operator_id TEXT REFERENCES operators(id),value TEXT);
      INSERT INTO fixture_authored VALUES('legacy-owner','preserved authored record');`);
  });
  assert.equal(sqlite.prepare("SELECT id FROM oa_operators").get().id, "legacy-owner");
  assert.equal(sqlite.prepare("SELECT claim_id FROM oa_bootstrap").get().claim_id, "legacy-owner");
  assert.equal(sqlite.prepare("SELECT onboarding_completed_at FROM operator_setup_identity").get().onboarding_completed_at, "2026-01-01T00:00:00Z");
  assert.ok(sqlite.prepare("SELECT revoked_at FROM operator_sessions").get().revoked_at);
  assert.equal(sqlite.prepare("SELECT value FROM fixture_authored").get().value, "preserved authored record");
  sqlite.exec("INSERT INTO oa_operators VALUES('second','second@business.example','Second','owner','active',1,1)");
  sqlite.exec("UPDATE oa_operators SET status='inactive' WHERE id='legacy-owner'");
  assert.equal(sqlite.prepare("SELECT access_generation FROM operators WHERE id='legacy-owner'").get().access_generation, 1);
  sqlite.exec("UPDATE oa_operators SET status='active' WHERE id='legacy-owner'");
  assert.equal(sqlite.prepare("SELECT version FROM oa_operators WHERE id='legacy-owner'").get().version, 3);
  assert.equal(sqlite.prepare("SELECT access_generation FROM operators WHERE id='legacy-owner'").get().access_generation, 1);
  assert.throws(() => sqlite.exec("UPDATE oa_operators SET role='member' WHERE id='second'"), /dial_equal_operators/);
  sqlite.close();
});

test("NOTIFY-005 SendGrid nullable acceptance and unknown outcomes remain durable without automatic replay or stored personal bytes", async () => {
  const { sqlite, db } = await database();
  const { BaseMailSender } = await load("../src/core/platform/mail/base-mail.ts");
  const { DeliveryRepository } = await load("../src/core/features/delivery/repository.ts");
  const repository = new DeliveryRepository(db, "sendgrid");
  const config = { MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-only", MAIL_FROM: "no-reply@business.example" };
  let calls = 0;
  const accepted = new BaseMailSender(db, config, async () => { calls++; return new Response(null, { status: 202 }); });
  const message = { to: "private@person.example", subject: "Private subject", text: "Private body", idempotencyKey: "accepted-id" };
  await admitMailSource(db, repository, message);
  assert.deepEqual(await accepted.send(message), { providerMessageId: null });
  assert.deepEqual(await accepted.send(message), { providerMessageId: null }); assert.equal(calls, 1);
  assert.deepEqual(await new BaseMailSender(db, config, async () => { calls++; return new Response(null, { status: 202 }); }).send(message), { providerMessageId: null });
  assert.equal(calls, 1, "accepted delivery survives sender recreation without a second provider call");
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM base_mail_dispatch").all()), /private@|Private subject|Private body/);
  const unknown = new BaseMailSender(db, config, async () => { calls++; throw new Error("lost response"); });
  const pending = { ...message, idempotencyKey: "unknown-id" };
  await admitMailSource(db, repository, pending);
  await assert.rejects(unknown.send(pending), (error) => error.code === "mail_outcome_unknown" && !error.retryable);
  const after = calls;
  await assert.rejects(new BaseMailSender(db, config, async () => { calls++; return new Response(null, { status: 202 }); }).send(pending), (error) => error.code === "mail_outcome_unknown");
  assert.equal(calls, after);
  sqlite.close();
});

test("AUTH-005 NOTIFY-005 SendGrid signatures gate callbacks and nullable receipts reconcile even before send returns", async () => {
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const { sqlite, db } = await database();
  const { SendGridWebhookReceiver } = await load("../src/core/features/delivery/sendgrid-webhook.ts");
  const { BaseMailSender } = await load("../src/core/platform/mail/base-mail.ts");
  const { DeliveryRepository } = await load("../src/core/features/delivery/repository.ts");
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const receiver = new SendGridWebhookReceiver(db, key);
  const message = { idempotencyKey: "send-id", to: "invitee@example.test", subject: "Booking confirmation", text: "Your booking is confirmed." };
  await admitMailSource(db, new DeliveryRepository(db, "sendgrid"), message);
  const body = JSON.stringify([{ sg_event_id: "signed-event", event: "bounce", rer_delivery_id: "send-id" }]);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign("sha256", Buffer.from(timestamp + body), { key: pair.privateKey, dsaEncoding: "der" }).toString("base64");
  const headers = { "x-twilio-email-event-webhook-timestamp": timestamp, "x-twilio-email-event-webhook-signature": signature };
  let admissions = 0;
  const admit = async () => { admissions++; return { kind: "admitted" }; };
  assert.equal((await receiver.receive(new Request(origin + "/api/webhooks/sendgrid", { method: "POST", headers, body: body + " " }), admit)).kind, "unauthorized");
  assert.equal(admissions, 0);
  const send = () => receiver.receive(new Request(origin + "/api/webhooks/sendgrid", { method: "POST", headers, body }), admit);
  const sender = new BaseMailSender(db, { MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-only", MAIL_FROM: "no-reply@business.example" }, async () => {
    assert.equal(sqlite.prepare("SELECT state FROM base_mail_dispatch").get().state, "invoking");
    assert.equal((await send()).kind, "accepted");
    assert.equal(sqlite.prepare("SELECT state FROM delivery_outbox").get().state, "failed", "callback reconciles before the provider response returns");
    return new Response(null, { status: 202 });
  });
  assert.deepEqual(await sender.send(message), { providerMessageId: null });
  assert.equal(sqlite.prepare("SELECT state FROM delivery_outbox").get().state, "failed");
  assert.equal(sqlite.prepare("SELECT last_error_code FROM delivery_outbox").get().last_error_code, "bounced");
  await send(); assert.equal(sqlite.prepare("SELECT count(*) AS n FROM provider_webhook_events").get().n, 1);
  sqlite.close();
});
