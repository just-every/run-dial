import { confirmAuthLink } from "./auth-client.mjs";
import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { origin, startRuntime } from "./operator-management/runtime.mjs";
import { configure } from "../modules/operator-auth/config.mjs";

// Read the same native defaults used by Dial's adapter, without changing limits.
const { emailLimit: tokenLimit, limitWindowSeconds } = configure({ origin, local: true, OWNER_EMAIL: "operator@dial.test", SESSION_SECRET: "test-only-native-defaults-configuration" });
const windowMs = limitWindowSeconds * 1000;
const boundary = Math.ceil(Date.UTC(2026, 9, 9, 19, 30) / windowMs) * windowMs;
const sessionRows = (runtime) => runtime.query("SELECT id, created_at FROM oa_sessions ORDER BY id");
async function assertRejectedConfirmations(responses) {
  for (const response of responses.filter((response) => response.status !== 303)) {
    assert.equal(response.headers.get("set-cookie"), null, "rejected confirmation never issues a cookie");
    assert.deepEqual(await response.json(), { error: response.status === 429 ? "rate_limited" : "invalid_or_expired" });
  }
}

contract("OPER-002", "native destructive management preserves authorship and protects self and setup owner", async (context) => {
  const runtime = await startRuntime(context, { now: boundary - 1 });
  const call = (path, { method = "GET", body, cookie, headers = {} } = {}) => fetch(origin + path, { method, redirect: "manual", headers: { Origin: origin, "CF-Connecting-IP": "198.18.0.2", ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let owner;
  async function link(email, actor = owner) { const response = await call("/__test/signin", { method: "POST", body: { email }, cookie: actor }); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).link; }
  async function login(email, actor = owner) { const response = await confirmAuthLink(await link(email, actor)); assert.equal(response.status, 303); return response.headers.get("set-cookie").split(";")[0]; }
  const prior = await login("prior@example.test");
  assert.equal((await call("/api/app/operators", { cookie: prior })).status, 503, "unknown historical setup identity fails closed");
  const setup = await (await call("/__test/setup", { method: "POST" })).json();
  owner = await login("setup@example.test");
  assert.equal((await call("/api/app/blocked-addresses", { method: "POST", body: { kind: "domain", value: "preserved.example.test" }, cookie: prior })).status, 201);
  const singleUse = await link("setup@example.test");
  const before = await sessionRows(runtime);
  for (const method of ["GET", "HEAD"]) {
    const scanner = await fetch(singleUse, { method, redirect: "manual" });
    assert.equal(scanner.status, 200);
    assert.equal(scanner.headers.get("set-cookie"), null);
    assert.deepEqual(await sessionRows(runtime), before, "scanners cannot persist sessions");
  }
  const excess = 3;
  const redemptions = await Promise.all(Array.from({ length: tokenLimit + excess }, () => confirmAuthLink(singleUse)));
  assert.deepEqual(redemptions.map((r) => r.status).sort(), [303, ...Array(tokenLimit - 1).fill(400), ...Array(excess).fill(429)], "concurrent redemption creates only one session; excess attempts are rate limited");
  await assertRejectedConfirmations(redemptions);
  const after = await sessionRows(runtime);
  assert.equal(after.length, before.length + 1, "the concurrent burst persists exactly one new session");
  assert.equal(after.find((row) => !before.some((previous) => previous.id === row.id)).created_at, boundary - 1, "the native adapter uses the Worker clock");
  await runtime.setNow(boundary);
  const replenished = await confirmAuthLink(singleUse);
  assert.equal(replenished.status, 400, "crossing a bucket boundary changes a throttled consumed token back to invalid");
  const renewed = await Promise.all(Array.from({ length: tokenLimit }, () => confirmAuthLink(singleUse)));
  assert.deepEqual(renewed.map((r) => r.status).sort(), [...Array(tokenLimit - 1).fill(400), 429], "the replenished bucket enforces the same exact token limit");
  await assertRejectedConfirmations([replenished, ...renewed]);
  assert.deepEqual(await sessionRows(runtime), after, "replenishment and excess attempts cannot revive a consumed token");
  context.diagnostic(JSON.stringify({ scenario: "same-window", now: boundary - 1, tokenLimit, statuses: redemptions.map((r) => r.status).sort(), replenished: replenished.status, renewed: renewed.map((r) => r.status).sort(), sessionDelta: after.length - before.length }));
  assert.equal((await call("/api/app/operators")).status, 401);
  assert.equal((await call("/app")).status, 302);
  assert.equal((await call("/api/app/operators", { method: "POST", body: { email: "x@example.test" }, cookie: owner, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await call("/api/app/operators", { method: "POST", body: { email: "x@example.test", role: "owner" }, cookie: owner })).status, 400);
  const invite = async (email, cookie = owner) => {
    const response = await call("/api/app/operators", { method: "POST", body: { email }, cookie });
    assert.equal(response.status, 201, await response.clone().text());
    const result = await response.json(); assert.notEqual(result.invitation, "queued", "unconfigured actual provider is not claimed delivered"); return result.operator;
  };
  const second = await invite(" SECOND@example.test "); assert.equal(second.email, "second@example.test");
  assert.equal((await invite("second@example.test")).id, second.id, "repeat invitation retains identity");
  const secondCookie = await login(second.email);
  const remove = (id, cookie) => call(`/api/app/operators/${id}/remove`, { method: "POST", cookie });
  assert.equal((await remove(setup.id, secondCookie)).status, 409, "setup owner is protected until ownership transfer");
  const pending = await link(second.email);
  const [removed, racingRedemption] = await Promise.all([remove(second.id, owner), confirmAuthLink(pending)]);
  assert.equal(removed.status, 204);
  assert.ok([303, 400].includes(racingRedemption.status));
  if (racingRedemption.status === 303) assert.equal((await call("/api/app/session", { cookie: racingRedemption.headers.get("set-cookie").split(";")[0] })).status, 401, "a concurrently redeemed session is also revoked");
  assert.equal((await call("/api/app/session", { cookie: secondCookie })).status, 401, "existing session immediately invalid");
  assert.equal((await confirmAuthLink(pending)).status, 400, "unused link immediately invalid");
  assert.equal(await link(second.email), undefined, "removed address cannot request a link");
  const readded = await invite(second.email); assert.notEqual(readded.id, second.id, "erased identity is never reactivated");
  assert.equal((await call("/api/app/session", { cookie: secondCookie })).status, 401, "reinvitations cannot revive old sessions");
  assert.equal((await confirmAuthLink(pending)).status, 400, "reinvitations cannot revive old links");
  const newSecondCookie = await login(second.email);
  assert.equal((await remove("not-a-persisted-operator", owner)).status, 204, "unknown identity removal is an authenticated idempotent no-op");
  assert.equal((await remove("01K00000000000000000000000", owner)).status, 204);
  assert.equal((await call("/api/app/session", { cookie: prior })).status, 401);
  assert.equal((await remove(setup.id, owner)).status, 409, "setup self-erasure stays held with another operator");
  assert.equal((await remove(readded.id, newSecondCookie)).status, 409, "self-erasure is held even with another operator");
  const third = await invite("third@example.test", newSecondCookie); const thirdCookie = await login(third.email, newSecondCookie);
  const race = await Promise.all([remove(readded.id, thirdCookie), remove(third.id, newSecondCookie)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [204, 401], "a removed caller loses authority before a competing removal");
  const state = await (await call("/__test/state")).json();
  assert.equal(state.operators.filter((o) => !o.removed_at).length, 2);
  assert.deepEqual(state.history, [{ operator_id: "01K00000000000000000000000", value: "preserved.example.test" }]);
  assert.deepEqual(state.setup, [{ operator_id: setup.id }]);
  await runtime.restart();
  assert.deepEqual(await (await call("/__test/state")).json(), state, "access, setup identity, revocations and retained authorship survive restart");
});

contract("OPER-002", "native confirmation limits reset at the bucket boundary without reviving a consumed link", async (context) => {
  const runtime = await startRuntime(context, { legacy: false, now: boundary - 1 });
  await fetch(origin + "/__test/setup", { method: "POST" });
  const issued = await fetch(origin + "/__test/signin", { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ email: "setup@example.test" }) });
  assert.equal(issued.status, 200);
  const { link } = await issued.json();
  const before = await sessionRows(runtime);
  const batchSize = tokenLimit - 1;
  const first = await Promise.all(Array.from({ length: batchSize }, () => confirmAuthLink(link)));
  assert.deepEqual(first.map((r) => r.status).sort(), [303, ...Array(batchSize - 1).fill(400)]);
  await assertRejectedConfirmations(first);
  const consumed = await sessionRows(runtime);
  assert.equal(consumed.length, before.length + 1);
  assert.equal(consumed[0].created_at, boundary - 1);
  // All first-window requests are settled before advancing the shared Worker clock.
  await runtime.setNow(boundary);
  const second = await Promise.all(Array.from({ length: batchSize }, () => confirmAuthLink(link)));
  assert.deepEqual(second.map((r) => r.status), Array(batchSize).fill(400), "new bucket restores quota, never the consumed capability");
  await assertRejectedConfirmations(second);
  assert.deepEqual(await sessionRows(runtime), consumed, "crossing the boundary cannot persist another session");
  const counters = await runtime.query(`SELECT count FROM oa_limits WHERE window=${boundary / windowMs} ORDER BY count`);
  assert.deepEqual(counters, [{ count: batchSize }, { count: batchSize }], "native D1 token and IP counters use the new UTC bucket");
  await runtime.restart();
  assert.equal((await (await fetch(origin + "/__test/clock")).json()).now, boundary, "restart preserves projected Worker time");
  assert.deepEqual(await runtime.query(`SELECT count FROM oa_limits WHERE window=${boundary / windowMs} ORDER BY count`), counters, "rate counters survive restart");
  const remaining = await confirmAuthLink(link);
  assert.equal(remaining.status, 400, "the remaining in-window allowance still checks consumed-token validity");
  const overflow = await confirmAuthLink(link);
  assert.equal(overflow.status, 429, "the next attempt must be throttled, even for a consumed token");
  await assertRejectedConfirmations([remaining, overflow]);
  assert.deepEqual(await sessionRows(runtime), consumed, "rejected and throttled attempts create no hidden session");
  for (const now of [boundary - 1, -1, null, "later", 1.5, 8.64e15 + 1]) {
    const response = await fetch(origin + "/__test/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ now }) });
    assert.equal(response.status, 400, "invalid or backwards fixture time is rejected");
  }
  assert.equal((await (await fetch(origin + "/__test/clock")).json()).now, boundary);
  context.diagnostic(JSON.stringify({ scenario: "split-window", times: [boundary - 1, boundary], tokenLimit, statuses: [...first, ...second].map((r) => r.status).sort(), overflow: [remaining.status, overflow.status], sessionDelta: consumed.length - before.length, counters }));
});

contract("AUTH-001", "clean native bootstrap installs only the setup-input identity and every private surface uses its Base session", async (context) => {
  await startRuntime(context, { legacy: false });
  const call = (path, body, headers = {}) => fetch(origin + path, { method: body === undefined ? "GET" : "POST", redirect: "manual", headers: { Origin: origin, "CF-Connecting-IP": "198.18.0.8", "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const input = { token: "dial-test-only-setup-token-at-least-32", displayName: "Setup input operator", returnTo: "/app" };
  assert.equal((await call("/auth/bootstrap", input, { Origin: "null" })).status, 403);
  const bootstrap = await call("/auth/bootstrap", input); assert.equal(bootstrap.status, 303);
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/auth/bootstrap", input)).status, 409);
  assert.equal((await (await call("/api/app/session", undefined, { cookie })).json()).operator.email, "operator@dial.test");
  // Ordinary private singleton absence is successful null, without sample host data.
  const absentProfile = await call("/api/app/profile", undefined, { cookie });
  assert.equal(absentProfile.status, 200);
  assert.equal(await absentProfile.json(), null, "clean install has no sample host");
  assert.equal((await call("/api/app/profile")).status, 401, "absent singleton still requires the native operator session");
  assert.deepEqual(await (await call("/api/app/event-types", undefined, { cookie })).json(), [], "clean install has no sample event");
  assert.equal((await call("/app")).status, 302);
  assert.equal((await call("/api/app/session")).status, 401);
  const { link } = await (await call("/__test/signin", { email: "operator@dial.test" })).json();
  const before = await call("/auth/sessions", undefined, { cookie }); const count = (await before.json()).length;
  for (const method of ["GET", "HEAD"]) {
    const scanner = await fetch(link, { method, redirect: "manual" }); assert.equal(scanner.status, 200); assert.equal(scanner.headers.get("set-cookie"), null);
    assert.equal((await (await call("/auth/sessions", undefined, { cookie })).json()).length, count);
  }
  const signed = await confirmAuthLink(link); assert.equal(signed.status, 303);
  assert.equal((await confirmAuthLink(link)).status, 400);
  assert.equal((await call("/auth/signout", {}, { cookie })).status, 204);
  assert.equal((await call("/api/app/session", undefined, { cookie })).status, 401);
});

contract("OPER-002", "cancelling an unaccepted invitation returns success and permanently retires its link", async (context) => {
  await startRuntime(context);
  const call = (path, body, cookie) => fetch(origin + path, { method: body === undefined ? "GET" : "POST", redirect: "manual", headers: { Origin: origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  await call("/__test/setup", {});
  const ownerLink = await (await call("/__test/signin", { email: "setup@example.test" })).json();
  const signedIn = await confirmAuthLink(ownerLink.link);
  assert.equal(signedIn.status, 303);
  const cookie = signedIn.headers.get("set-cookie").split(";")[0];
  const email = "unaccepted@example.test";
  const invited = await call("/api/app/operators", { email }, cookie);
  assert.equal(invited.status, 201);
  const invitation = await invited.json();
  assert.equal(invitation.invitation, "not_deliverable", "unconfigured provider remains visibly unavailable");
  const pending = await (await call("/__test/signin", { email }, cookie)).json();
  assert.ok(pending.link);
  const removePath = `/api/app/operators/${invitation.operator.id}/remove`;
  const denied = await call(removePath, {});
  assert.equal(denied.status, 401);
  const before = await (await call("/api/app/operators", undefined, cookie)).json();
  assert.equal(before.operators.find((entry) => entry.email === email).status, "invited");
  const removed = await call(removePath, {}, cookie);
  assert.equal(removed.status, 204, await removed.text());
  assert.equal((await confirmAuthLink(pending.link)).status, 400, "cancelled invitation cannot create a session");
  assert.ok(!(await (await call("/api/app/operators", undefined, cookie)).json()).operators.some((entry) => entry.email === email));
  assert.equal((await call(removePath, {}, cookie)).status, 204, "repeated removal is idempotent");
  const readded = await (await call("/api/app/operators", { email }, cookie)).json();
  assert.notEqual(readded.operator.id, invitation.operator.id, "reinvitation creates a fresh identity after destructive removal");
  assert.equal((await confirmAuthLink(pending.link)).status, 400, "reinvitation never revives the cancelled capability");
});

contract("PROFILE-001", "native empty bootstrap keeps profile setup actionable after desktop and mobile hydration", async (context) => {
  await startRuntime(context, { legacy: false });
  const { verifyEmptyWorkspace } = await import("./empty-workspace/journey.mjs");
  await verifyEmptyWorkspace(origin);
});
