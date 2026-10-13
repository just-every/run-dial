import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
import { createD1DevelopmentOutbox } from "../modules/mail/src/development/index.mjs";
import { opaqueToken, hashToken } from "../modules/operator-auth/crypto.mjs";
import { TEST_DEV_KEY, devKeyHeaders } from "./dev-key.mjs";
import { admitMailSource } from "./mail-source.mjs";

async function load(path) {
  const result = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
function binding(sqlite) {
  const prepare = (sql, args = []) => ({ bind: (...values) => prepare(sql, values),
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { const statement = sqlite.prepare(sql); return { success: true, results: statement.columns().length ? statement.all(...args) : (statement.run(...args), []), meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n } }; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, results: [], meta: { changes: result.changes } }; },
  });
  return { prepare, async batch(statements) { sqlite.exec("BEGIN"); try { const results = []; for (const s of statements) results.push(await s.all()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
}
async function database(limit = "9999") {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of (await readdir(new URL("../migrations/core", import.meta.url))).sort()) if (name.slice(0, 4) <= limit) sqlite.exec(await readFile(new URL(`../migrations/core/${name}`, import.meta.url), "utf8"));
  return { sqlite, db: binding(sqlite) };
}
const local = { ENVIRONMENT: "development", APP_URL: "http://127.0.0.1:8787", OWNER_EMAIL: "owner@example.test", SESSION_SECRET: "test-session-secret-at-least-32-characters", SETUP_TOKEN: "test-setup-token-at-least-32-characters", MAIL_PROVIDER: "development", MAIL_FROM: "noreply@example.test" };
function request(path, body, headers = {}) { return new Request(local.APP_URL + path, { method: body ? "POST" : "GET", headers: { host: "127.0.0.1:8787", origin: local.APP_URL, "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); }

contract("DATA-001", "local outbox adoption preserves existing authored and provider data and retires only the old credential sink", async () => {
  const { sqlite } = await database("0019");
  try {
    sqlite.exec("INSERT INTO host_profiles VALUES ('host','default','own-host','Own name','Own title','Own biography','UTC','before','before'); INSERT INTO provider_connection_health VALUES ('sendgrid','healthy','before',NULL,'healthy_announced',2,'before','before'); INSERT INTO development_magic_link_sink VALUES ('default','old-private-link','before')");
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'development_magic_link_sink' ORDER BY name").all().map(row => row.name);
    const before = Object.fromEntries(tables.map(name => [name, sqlite.prepare(`SELECT * FROM ${name}`).all()]));
    for (const name of ["0020_base_development_outbox.sql", "0021_remove_development_magic_link_sink.sql", "0022_development_mail_health.sql"]) sqlite.exec(await readFile(new URL(`../migrations/core/${name}`, import.meta.url), "utf8"));
    for (const name of tables) assert.deepEqual(sqlite.prepare(`SELECT * FROM ${name}`).all(), before[name], `${name} preserved`);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='development_magic_link_sink'").get().n, 0);
    sqlite.exec("INSERT INTO provider_connection_health VALUES ('development','healthy','after',NULL,'healthy_announced',0,'after','after')");
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM rer_mail_development_outbox").get().n, 0);
  } finally { sqlite.close(); }
});

contract("AUTH-001", "local sign-in captures real Base mail and viewer is loopback-only, non-enumerating and replay-safe", async () => {
  const { OperatorsService } = await load("../src/core/features/operators/service.ts");
  const { handleDevelopmentOutbox } = await load("../src/core/platform/mail/development.ts");
  const { sqlite, db } = await database();
  try {
    const operators = new OperatorsService(db, local);
    assert.equal((await operators.handle(request("/auth/bootstrap", { token: local.SETUP_TOKEN, displayName: "Own name" }))).status, 303);
    const incomplete = sqlite.prepare('SELECT first_setup FROM oa_auth_settings').get().first_setup;
    const refused = await operators.handle(request('/auth/setup-complete', {}));
    const proof = await hashToken(local.SESSION_SECRET, 'local-cli', 'sign-in');
    const completed = await operators.handle(request('/auth/setup-complete', {}, { 'x-rer-local-cli': proof }));
    assert.deepEqual([incomplete, refused.status, completed.status, await completed.json(), sqlite.prepare('SELECT first_setup FROM oa_auth_settings').get().first_setup], [1, 403, 200, { complete: true }, 0]);
    for (const table of ["host_profiles", "event_types"]) assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    const unknown = await operators.requestMagicLink(request("/api/auth/magic-links", {}), "unknown@example.test");
    assert.equal((await createD1DevelopmentOutbox({ db }).list()).length, 0);
    assert.deepEqual(await operators.requestMagicLink(request("/api/auth/magic-links", {}), local.OWNER_EMAIL), unknown);
    await operators.requestMagicLink(request("/api/auth/magic-links", {}), "another-unknown@example.test");
    const captures = await createD1DevelopmentOutbox({ db }).list();
    assert.equal(captures.length, 1); assert.deepEqual(captures[0].message.to, [local.OWNER_EMAIL]);
    // A loopback origin is not a guard (a tunnel or proxy makes remote requests look local): the viewer needs the checkout's key.
    for (const [key, headers] of [[TEST_DEV_KEY, {}], [undefined, devKeyHeaders], [TEST_DEV_KEY, { "x-rer-dev-key": "wrong-key-wrong-key-wrong-key-wrong-key-wrong-key" }]]) {
      assert.equal((await handleDevelopmentOutbox(request("/__dev/outbox", undefined, headers), db, local, key)).status, 404);
      assert.equal((await handleDevelopmentOutbox(request(`/__dev/outbox?message=${captures[0].id}`, undefined, headers), db, local, key)).status, 404);
    }
    const list = await handleDevelopmentOutbox(request("/__dev/outbox", undefined, devKeyHeaders), db, local, TEST_DEV_KEY);
    assert.equal(list.status, 200); assert.equal(list.headers.get("cache-control"), "no-store");
    const detail = await handleDevelopmentOutbox(request(`/__dev/outbox?message=${captures[0].id}`, undefined, devKeyHeaders), db, local, TEST_DEV_KEY);
    assert.match(await detail.text(), /Open this link/);
    for (const headers of [{ host: "evil.example" }, { host: "127.0.0.1:8787", origin: "https://evil.example" }, { host: "127.0.0.1:8787", "sec-fetch-site": "cross-site" }]) assert.equal(await handleDevelopmentOutbox(new Request(local.APP_URL + "/__dev/outbox", { headers: { ...devKeyHeaders, ...headers } }), db, local, TEST_DEV_KEY), null);
    const link = captures[0].message.text.match(/https?:\/\/[^\s]+/)[0];
    const token = new URL(link).searchParams.get("token");
    assert.equal((await operators.handle(request(`/auth/confirm?token=${token}`))).headers.get("set-cookie"), null);
    const confirmed = await operators.handle(request("/auth/confirm", { token }));
    assert.equal(confirmed.status, 303);
    assert.equal((await operators.handle(request("/auth/confirm", { token }))).status, 400);
    const form = await operators.handle(new Request(local.APP_URL + "/auth/magic-link", { method: "POST", headers: { host: "127.0.0.1:8787", origin: local.APP_URL, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: local.OWNER_EMAIL, returnTo: "/setup" }) }));
    assert.equal(form.status, 303);
    assert.equal(form.headers.get("location"), "/__dev/outbox", "accepted native forms open the key-gated local outbox before hydration");
    assert.equal((await createD1DevelopmentOutbox({ db }).list()).length, 2);
  } finally { sqlite.close(); }
});

contract("DATA-001", "the authentication migrations upgrade a populated store: sessions and sign-in links stay valid and the table admits dev sessions", async () => {
  const { OperatorsService } = await load("../src/core/features/operators/service.ts");
  const { sqlite, db } = await database("0029");
  try {
    const before = new OperatorsService(db, local);
    const claimed = await before.handle(request("/auth/bootstrap", { token: local.SETUP_TOKEN, displayName: "Own name" }));
    assert.equal(claimed.status, 303);
    const cookie = claimed.headers.get("set-cookie").split(";")[0];
    // A sign-in link issued before the upgrade, and one stored session of every other kind and state.
    // Seed the pre-upgrade native link format directly: the current sign-in issuer
    // requires the new domain policy tables, which this old store does not yet have.
    const owner = sqlite.prepare("SELECT id, version FROM oa_operators").get();
    const token = opaqueToken(), now = Date.now();
    sqlite.prepare("INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,return_to,created_at,expires_at) VALUES(?,?,'magic',?,?,?,?,?)")
      .run("pre-upgrade-link", await hashToken(local.SESSION_SECRET, "link", token), owner.id, owner.version, "/setup", now, now + 600_000);
    const insert = sqlite.prepare("INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?)");
    for (const [id, kind, expires, revoked] of [["s-review", "review", 4e12, null], ["s-oidc", "oidc", 4e12, null], ["s-password", "password", 4e12, null], ["s-revoked", "native", 4e12, 1e9], ["s-expired", "native", 1e9, null]]) insert.run(id, `hash-${id}`, owner.id, owner.version, kind, 1e9, expires, revoked);
    const sessions = sqlite.prepare("SELECT * FROM oa_sessions ORDER BY id").all(), tokens = sqlite.prepare("SELECT * FROM oa_tokens ORDER BY id").all();
    assert.ok(sessions.length >= 6 && tokens.length === 1);

    // Upgrade to the current schema: 0030/0031 change the auth tables, and current sign-in also writes 0038's rate correlation.
    for (const name of (await readdir(new URL("../migrations/core", import.meta.url))).sort()) if (name.slice(0, 4) > "0029") sqlite.exec(await readFile(new URL(`../migrations/core/${name}`, import.meta.url), "utf8"));
    assert.deepEqual(sqlite.prepare("SELECT * FROM oa_sessions ORDER BY id").all(), sessions, "every session row is identical, ids and expiries included");
    assert.deepEqual(sqlite.prepare("SELECT * FROM oa_tokens ORDER BY id").all(), tokens);
    const after = new OperatorsService(db, local);
    assert.equal((await after.authenticate(request("/api/app/session", undefined, { cookie })))?.email, local.OWNER_EMAIL, "the session from before the upgrade is still valid");
    assert.equal((await after.handle(request("/auth/confirm", { token }))).status, 303, "the link from before the upgrade still signs in");
    insert.run("s-dev", "hash-s-dev", owner.id, owner.version, "dev", 1e9, 4e12, null);
    assert.throws(() => insert.run("s-other", "hash-s-other", owner.id, owner.version, "other", 1e9, 4e12, null));
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oa_dev_credentials").get().n, 0);
  } finally { sqlite.close(); }
});

contract("AUTH-001", "production cannot select development mail or mount its viewer and missing provider never captures", async () => {
  const { parseRuntimeEnvironment } = await load("../src/core/shared/runtime-env.ts");
  const { createAuthenticationMail, BaseMailSender } = await load("../src/core/platform/mail/base-mail.ts");
  const { handleDevelopmentOutbox } = await load("../src/core/platform/mail/development.ts");
  const { sqlite, db } = await database();
  try {
    for (const runtime of [{ ...local, ENVIRONMENT: "production" }, { ...local, ENVIRONMENT: "preview" }, { ...local, APP_URL: "https://dial.example.test" }]) {
      assert.throws(() => parseRuntimeEnvironment(runtime), /development mail requires/);
      assert.throws(() => createAuthenticationMail(db, runtime), /Development mail/);
      assert.equal(await handleDevelopmentOutbox(request("/__dev/outbox", undefined, devKeyHeaders), db, runtime, TEST_DEV_KEY), null);
      await assert.rejects(new BaseMailSender(db, runtime).checkConnection(), /Development mail/);
    }
    for (const MAIL_PROVIDER of [undefined, "sendgrid", "resend"]) {
      const runtime = { ...local, MAIL_PROVIDER };
      assert.equal(createAuthenticationMail(db, runtime), undefined);
      assert.equal(await handleDevelopmentOutbox(request("/__dev/outbox", undefined, devKeyHeaders), db, runtime, TEST_DEV_KEY), null);
    }
    assert.equal((await createD1DevelopmentOutbox({ db }).list()).length, 0);
  } finally { sqlite.close(); }
});

contract("NOTIFY-001", "explicit local delivery uses the same Base outbox without a remote receipt or provider request", async () => {
  const { BaseMailSender } = await load("../src/core/platform/mail/base-mail.ts");
  const { DeliveryRepository } = await load("../src/core/features/delivery/repository.ts");
  const { sqlite, db } = await database();
  try {
    const sender = new BaseMailSender(db, local, () => assert.fail("local mail made a provider request"));
    assert.ok((await sender.checkConnection()).checkedAt);
    const message = { idempotencyKey: "local-delivery", to: "invitee@example.test", subject: "Local booking", text: "Local text", html: "<p>Local text</p>" };
    await admitMailSource(db, new DeliveryRepository(db, "development"), message);
    assert.deepEqual(await sender.send(message), { providerMessageId: null });
    const [capture] = await createD1DevelopmentOutbox({ db }).list();
    assert.equal(capture.message.subject, "Local booking"); assert.equal(capture.message.html, "<p>Local text</p>");
  } finally { sqlite.close(); }
});

contract("DATA-001", "local mail retention is bounded to 100 captures and seven days across readers", async () => {
  const { DeliveryRepository } = await load("../src/core/features/delivery/repository.ts");
  const { sqlite, db } = await database();
  try {
    const repository = new DeliveryRepository(db, "development");
    let now = 1_000_000_000;
    const box = createD1DevelopmentOutbox({ db, clock: () => now });
    for (let index = 0; index < 101; index++) {
      const message = { idempotencyKey: String(index), to: "owner@example.test", subject: String(index), text: "Local-only message" };
      await admitMailSource(db, repository, message);
      await box.put({ deliveryId: message.idempotencyKey, from: "noreply@example.test", to: [message.to], subject: message.subject, text: message.text });
    }
    const rows = await box.list(); assert.equal(rows.length, 100); assert.equal(rows[0].message.subject, "100"); assert.equal(rows.at(-1).message.subject, "1");
    now += 7 * 86400 * 1000;
    assert.deepEqual(await createD1DevelopmentOutbox({ db, clock: () => now }).list(), []);
  } finally { sqlite.close(); }
});

contract("AUTH-001", "link request responses distinguish local and deployed delivery without revealing address membership", async () => {
  const { Hono } = await import("hono");
  const { operatorRoutes } = await load("../src/core/features/operators/routes.ts");
  for (const [runtime, status] of [[local, "open_local_outbox"], [{ ...local, ENVIRONMENT: "production", APP_URL: "https://dial.example.test", MAIL_PROVIDER: "sendgrid" }, "check_your_email"]]) {
    const seen = [];
    const app = new Hono().use("*", async (context, next) => { context.set("runtime", runtime); context.set("services", { operators: { requestMagicLink: async (_request, email) => seen.push(email) } }); await next(); }).route("/", operatorRoutes);
    for (const email of [local.OWNER_EMAIL, "unknown@example.test"]) {
      const response = await app.request("/api/auth/magic-links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      assert.equal(response.status, 202); assert.deepEqual(await response.json(), { status });
    }
    assert.deepEqual(seen, [local.OWNER_EMAIL, "unknown@example.test"]);
    assert.equal((await app.request("/api/auth/development-sink")).status, 404);
  }
});

contract("OPER-001", "review runtime config validates its explicit operator and real local outbox", async () => {
  const { parseRuntimeEnvironment } = await load("../src/core/shared/runtime-env.ts");
  const vars = (await readFile(new URL("../wrangler.review.toml", import.meta.url), "utf8")).split("[vars]")[1];
  const values = Object.fromEntries([...vars.matchAll(/^([A-Z_]+) = "([^"]+)"$/gm)].map(match => [match[1], match[2]]));
  const runtime = parseRuntimeEnvironment(values);
  assert.equal(runtime.OWNER_EMAIL, "operator@dial.test"); assert.equal(runtime.MAIL_PROVIDER, "development");
  assert.equal(runtime.APP_URL, "http://127.0.0.1:15702");
});

contract("OPER-002", "Base invitation migration preserves prior identities, tokens, sessions and cancellation authority", async () => {
  const { sqlite } = await database("0022");
  try {
    sqlite.exec("INSERT INTO oa_operators VALUES ('prior-owner','prior@example.test','Prior owner','owner','active',1,100); INSERT INTO oa_operators VALUES ('prior-invite','invite@example.test','Prior invite','owner','invited',1,100); INSERT INTO oa_bootstrap VALUES (1,'prior-owner',100); INSERT INTO oa_tokens VALUES ('old-link','hash','invite','prior-invite',1,'prior-owner',1,'/app',100,200,NULL,NULL); INSERT INTO oa_sessions VALUES ('prior-session','session-hash','prior-owner',1,'native',NULL,100,200,NULL)");
    const tables = ["oa_operators", "operators", "oa_tokens", "oa_sessions", "oa_bootstrap"];
    const before = Object.fromEntries(tables.map(name => [name, sqlite.prepare(`SELECT * FROM ${name}`).all()]));
    sqlite.exec(await readFile(new URL("../migrations/core/0023_base_invitation_cancellation.sql", import.meta.url), "utf8"));
    for (const name of tables) assert.deepEqual(sqlite.prepare(`SELECT * FROM ${name}`).all(), before[name], `${name} preserved`);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oa_invitation_cancellations").get().n, 0, "no historical acceptance inferred");
    sqlite.exec("UPDATE oa_operators SET status='inactive' WHERE id='prior-invite'");
    assert.equal(sqlite.prepare("SELECT operator_version FROM oa_invitation_cancellations WHERE operator_id='prior-invite'").get().operator_version, 2);
    assert.throws(() => sqlite.exec("UPDATE oa_operators SET status='active' WHERE id='prior-invite'"), /invitation_required/);
    assert.equal(sqlite.prepare("SELECT status FROM oa_operators WHERE id='prior-owner'").get().status, "active");
  } finally { sqlite.close(); }
});

contract("OPER-002", "Dial config gives real sign-in and invitation mail matching branded HTML and text and expired-link recovery", async () => {
  const { OperatorsService } = await load("../src/core/features/operators/service.ts");
  const { sqlite, db } = await database();
  try {
    const service = new OperatorsService(db, local);
    const bootstrap = await service.handle(request("/auth/bootstrap", { token: local.SETUP_TOKEN, displayName: "Own name" }));
    const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
    await service.requestMagicLink(request("/api/auth/magic-links", {}), local.OWNER_EMAIL);
    const invite = request("/auth/invite", {}); invite.headers.set("cookie", cookie);
    await service.auth.invite(invite, { email: "invited@example.test", displayName: "Invited", role: "owner", returnTo: "/app" });
    const captures = await createD1DevelopmentOutbox({ db }).list();
    assert.equal(captures.length, 2);
    for (const { message } of captures) {
      assert.match(message.subject, /Dial/); assert.match(message.html, /background:#1d1c1a;color:#ffffff/);
      assert.match(message.text, /Dial/); assert.match(message.html, /Dial/);
      const link = message.text.match(/https?:\/\/[^\s]+/)[0];
      assert.equal(message.html.includes(link.replaceAll("&", "&amp;")), true);
      assert.match(message.html, /Confirm/); assert.match(message.text, /Confirm/);
      const token = new URL(link).searchParams.get("token");
      sqlite.prepare("UPDATE oa_tokens SET expires_at=1 WHERE consumed_at IS NULL").run();
      const expired = await service.handle(request(`/auth/confirm?token=${token}`));
      assert.equal(expired.status, 400); assert.match(await expired.text(), /href="\/signin">Request a new link/);
    }
    assert.deepEqual(captures.map(row => row.message.subject).sort(), ["You're invited to Dial", "Your sign-in link for Dial"].sort());
  } finally { sqlite.close(); }
});

contract("OPER-002", "Base reissues cancelled identities while retaining authority and permanently retiring old links", async () => {
  const { OperatorsService } = await load("../src/core/features/operators/service.ts");
  const { sqlite, db } = await database();
  try {
    const operators = new OperatorsService(db, local);
    const bootstrap = await operators.handle(request("/auth/bootstrap", { token: local.SETUP_TOKEN, displayName: "Owner" }));
    const owner = request("/api/app/operators", {}); owner.headers.set("cookie", bootstrap.headers.get("set-cookie").split(";")[0]);
    await operators.auth.invite(owner, { email: "reinvited@example.test", displayName: "Invited", role: "owner", returnTo: "/app" });
    const invited = (await operators.auth.listOperators(owner)).find(row => row.email === "reinvited@example.test");
    const first = (await createD1DevelopmentOutbox({ db }).list())[0].message.text.match(/https?:\/\/[^\s]+/)[0];
    await operators.auth.cancelInvitation(owner, invited.id);
    assert.equal((await operators.handle(request(new URL(first).pathname + new URL(first).search))).status, 400);
    await assert.rejects(operators.auth.setOperatorStatus(owner, invited.id, "active"), error => error.code === "invitation_required" && error.status === 409);
    const input = { email: invited.email, displayName: "Invited", role: "owner", returnTo: "/app" };
    await assert.rejects(operators.auth.invite(request("/api/app/operators", {}), input), error => error.code === "unauthenticated");
    const original = sqlite.prepare("SELECT id,created_at FROM oa_operators WHERE id=?").get(invited.id);
    const bootstrapLedger = sqlite.prepare("SELECT * FROM oa_bootstrap").all();
    for (let cycle = 0; cycle < 2; cycle++) {
      await operators.auth.invite(owner, input);
      const reissued = (await operators.auth.listOperators(owner)).find(row => row.email === invited.email);
      assert.equal(reissued.id, invited.id);
      assert.deepEqual(sqlite.prepare("SELECT id,created_at FROM oa_operators WHERE id=?").get(invited.id), original);
      assert.equal(sqlite.prepare("SELECT status FROM oa_operators WHERE id=?").get(invited.id).status, "invited");
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oa_invitation_cancellations WHERE operator_id=?").get(invited.id).n, 1);
      await assert.rejects(operators.auth.setOperatorStatus(owner, invited.id, "active"), error => error.code === "invitation_required" && error.status === 409);
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?").get(invited.id).n, 0);
      assert.equal((await operators.handle(request("/auth/confirm", { token: new URL(first).searchParams.get("token") }))).status, 400);
      if (cycle === 0) await operators.auth.cancelInvitation(owner, invited.id);
    }
    const latest = (await createD1DevelopmentOutbox({ db }).list())[0].message.text.match(/https?:\/\/[^\s]+/)[0];
    const token = new URL(latest).searchParams.get("token");
    const preview = await operators.handle(request(`/auth/confirm?token=${token}`));
    assert.equal(preview.status, 200); assert.equal(preview.headers.get("set-cookie"), null);
    const accepted = await operators.handle(request("/auth/confirm", { token }));
    assert.equal(accepted.status, 303); assert.ok(accepted.headers.get("set-cookie"));
    assert.equal(sqlite.prepare("SELECT status FROM oa_operators WHERE id=?").get(invited.id).status, "active");
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oa_invitation_cancellations WHERE operator_id=?").get(invited.id).n, 0);
    assert.deepEqual(sqlite.prepare("SELECT * FROM oa_bootstrap").all(), bootstrapLedger);
    assert.equal((await operators.handle(request("/auth/confirm", { token: new URL(first).searchParams.get("token") }))).status, 400);
    assert.equal((await operators.handle(request("/auth/confirm", { token }))).status, 400);
  } finally { sqlite.close(); }
});

contract("OPER-001", "native deployed sign-in and invitation transport keeps both MIME parts without a development capture", async () => {
  const { OperatorsService } = await load("../src/core/features/operators/service.ts");
  const { sqlite, db } = await database();
  const originalFetch = globalThis.fetch;
  const payloads = [];
  const runtime = { ...local, ENVIRONMENT: "production", APP_URL: "https://dial.example.test", MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "synthetic-test-key" };
  const post = (path, body, cookie) => new Request(runtime.APP_URL + path, { method: "POST", headers: { host: "dial.example.test", origin: runtime.APP_URL, "cf-connecting-ip": "198.18.0.1", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  try {
    globalThis.fetch = async (url, init) => { assert.equal(String(url), "https://api.sendgrid.com/v3/mail/send"); payloads.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); };
    const operators = new OperatorsService(db, runtime);
    const bootstrap = await operators.handle(post("/auth/bootstrap", { token: runtime.SETUP_TOKEN, displayName: "Owner" }));
    assert.equal(bootstrap.status, 303);
    const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
    await operators.requestMagicLink(post("/api/auth/magic-links", {}), runtime.OWNER_EMAIL);
    await operators.auth.invite(post("/api/app/operators", {}, cookie), { email: "invited@example.test", displayName: "Invited", role: "owner" });
    assert.equal(payloads.length, 2);
    for (const payload of payloads) {
      assert.deepEqual(payload.content.map(part => part.type), ["text/plain", "text/html"]);
      assert.ok(payload.content.every(part => part.value.includes("Dial")));
      assert.ok(payload.content[1].value.includes("background:#1d1c1a;color:#ffffff"));
    }
    assert.equal((await createD1DevelopmentOutbox({ db }).list()).length, 0);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

contract("AUTH-001", "sign-in options expose only Base presentation flags and hide bootstrap after a durable owner claim", async () => {
  const { signinOptions } = await load("../src/core/features/operators/signin-options.ts");
  const { OperatorsService } = await load("../src/core/features/operators/service.ts");
  const { sqlite, db } = await database();
  try {
    const first = await signinOptions({ ...local, DB: db });
    assert.deepEqual(first, { setup: true, local: true, developmentOutbox: true, setupInstructions: "Open .dev.vars in your local project and copy the SETUP_TOKEN value. This signs in the configured owner without sending email." });
    assert.deepEqual(Object.keys(first).sort(), ["developmentOutbox", "local", "setup", "setupInstructions"]);
    for (const key of ["SESSION_SECRET", "SETUP_TOKEN", "OWNER_EMAIL"]) assert.equal(JSON.stringify(first).includes(local[key]), false);
    assert.equal((await signinOptions({ ...local, DB: db, SETUP_TOKEN: undefined })).setup, false);
    const deployed = await signinOptions({ ...local, DB: db, ENVIRONMENT: "production", APP_URL: "https://dial.example.test", MAIL_PROVIDER: "sendgrid" });
    assert.equal(deployed.developmentOutbox, false); assert.equal(deployed.local, false);
    assert.equal(deployed.setupInstructions, "Use the setup token from your deployment. This signs in the configured owner without sending email.");
    const operators = new OperatorsService(db, local);
    assert.equal((await operators.handle(request("/auth/bootstrap", { token: local.SETUP_TOKEN, displayName: "Existing owner" }))).status, 303);
    assert.equal((await signinOptions({ ...local, DB: db })).setup, false);
    const rotated = new OperatorsService(db, { ...local, OWNER_EMAIL: "second@example.test", SETUP_TOKEN: "rotated-test-setup-token-at-least-32-characters" });
    assert.equal((await rotated.handle(request("/auth/bootstrap", { token: "rotated-test-setup-token-at-least-32-characters", displayName: "Second owner" }))).status, 409);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oa_operators").get().n, 1);
  } finally { sqlite.close(); }
});
