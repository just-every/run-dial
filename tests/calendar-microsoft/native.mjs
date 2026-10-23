import { microsoftBookingLifecycle } from "./booking.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
const origin = "http://127.0.0.1:15714";
const secret = "synthetic-dial-1616-at-least-thirty-two-characters";
export async function microsoftProof(t, kind) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-microsoft-")), config = "tests/calendar-microsoft/worker.wrangler.toml";
  const run = args => new Promise((done, reject) => {
    const child = spawn("pnpm", args, { stdio: "pipe", env: { ...process.env, CI: "1" } }); let output = "";
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    child.once("error", reject); child.once("exit", code => code === 0 ? done() : reject(new Error(output)));
  });
  await run(["exec", "wrangler", "d1", "migrations", "apply", "dial-microsoft-test", "--local", "--persist-to", persist, "--config", config]);
  const server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", config, "--ip", "127.0.0.1", "--port", "15714", "--inspector-port", "15724"], { stdio: "pipe", detached: true, env: { ...process.env, CI: "1" } });
  let output = "", cookie;
  server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
  t.after(async () => { if (server.exitCode === null) { const stopped = new Promise(done => server.once("exit", done)); process.kill(-server.pid, "SIGTERM"); await stopped; } await rm(persist, { recursive: true, force: true }); });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt > 80) throw new Error(output);
    try { const ready = await fetch(origin + "/api/calendar/oauth/callback?state=forged&code=synthetic-dial-1620"); if (ready.status === 400) break; if (ready.status === 503) throw new Error(await ready.text()); } catch (error) { if (!error.message.includes("fetch failed")) throw error; }
    await new Promise(done => setTimeout(done, 125));
  }
  async function call(path, body, status = 200, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(origin + path, { method, redirect: "manual", headers: { Origin: origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${path}: ${await response.clone().text()}`); return response;
  }
  const data = async (...args) => { const response = await call(...args); return response.status === 204 ? null : response.json(); };
  const bootstrap = await call("/auth/bootstrap", { token: "synthetic-dial-1617-at-least-thirty-two-characters", displayName: "Synthetic Dial 1621", returnTo: "/setup" }, 303); cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const begin = async () => {
    const response = await call("/api/app/calendar/oauth/start?provider=microsoft", undefined, 302), url = new URL(response.headers.get("location"));
    assert.equal(url.hostname, "login.microsoftonline.com"); assert.equal(url.pathname, "/common/oauth2/v2.0/authorize");
    return url.searchParams.get("state");
  };
  const finish = state => call(`/api/calendar/oauth/callback?${new URLSearchParams({ state, code: "synthetic-dial-1622" })}`, undefined, 302);
  const state = await begin();
  if (kind === "oauth") {
    await call("/api/calendar/oauth/callback?code=synthetic-dial-1622", undefined, 400);
    await call("/api/calendar/oauth/callback?state=forged&code=synthetic-dial-1622", undefined, 400);
    const decoded = JSON.parse(Buffer.from(state.split(".")[0], "base64url"));
    const sign = changes => { const body = Buffer.from(JSON.stringify({ ...decoded, ...changes })).toString("base64url"); return body + "." + createHmac("sha256", secret).update(body).digest("base64url"); };
    for (const invalid of [sign({ sessionId: "synthetic-dial-1623" }), sign({ issuedAt: new Date(Date.now() - 11 * 60000).toISOString() })]) await call(`/api/calendar/oauth/callback?${new URLSearchParams({ state: invalid, code: "synthetic-dial-1622" })}`, undefined, 400);
    assert.equal((await data("/__fixtures/facts")).sealed, false);
  }
  await finish(state);
  const select = async () => call("/api/app/calendar/selection", { destinationCalendarId: "synthetic-dial-1602", conflictCalendarIds: ["synthetic-dial-1604"] }, 200, "PUT");
  await select(); await call("/api/app/calendar/check", {});
  let facts = await data("/__fixtures/facts");
  assert.equal(facts.provider, "microsoft"); assert.equal(facts.sealed, true);
  if (kind === "oauth") {
    await call(`/api/calendar/oauth/callback?${new URLSearchParams({ state, code: "synthetic-dial-1622" })}`, undefined, 400);
    assert.equal(facts.calls.filter(call => call.path.endsWith("/token")).length, 1);
    await call("/__fixtures/control", { refusedRefresh: true, expire: true }, 204);
    await call("/api/app/calendar/check", {}, 503);
    assert.equal((await data("/api/app/calendar/connection")).reason, "reauthorization_required");
    await call("/__fixtures/control", { refusedRefresh: false }, 204); await finish(await begin()); await call("/api/app/calendar/check", {});
    const recovered = await data("/api/app/calendar/connection"); assert.equal(recovered.state, "healthy");
    assert.ok(recovered.recentChanges.some(change => change.reason === "reauthorization_required"));
    assert.ok(recovered.recentChanges.some(change => change.toState === "healthy"));
  } else if (kind === "busy") {
    const fresh = await data("/__fixtures/busy?fresh=1"); assert.deepEqual(fresh.intervals, [{ startAt: "2030-06-03T10:00:00.000Z", endAt: "2030-06-03T10:30:00.000Z" }]);
    const before = (await data("/__fixtures/facts")).calls.length; await data("/__fixtures/busy"); assert.equal((await data("/__fixtures/facts")).calls.length, before, "covered recent range uses the existing five-minute cache");
    facts = await data("/__fixtures/facts"); assert.ok(facts.calls.some(call => call.path.endsWith("/getSchedule"))); assert.doesNotMatch(JSON.stringify(facts.busy), /Private synthetic|private@example/);
    await call("/__fixtures/control", { unreadable: true }, 204); const failed = await data("/__fixtures/busy?fresh=1"); assert.equal(failed.kind, "unavailable");
  } else if (kind === "channels") {
    assert.equal((await data("/__fixtures/renew", {})).kind, "current");
    const old = facts.subscriptions; await call("/__fixtures/control", { expireChannels: true }, 204);
    assert.equal((await data("/__fixtures/renew", {})).kind, "renewed"); facts = await data("/__fixtures/facts");
    assert.equal(facts.subscriptions.length, 1); assert.ok(old.every(id => !facts.subscriptions.includes(id)));
    const callback = "/api/webhooks/google-calendar?provider=microsoft";
    const validation = await call(callback + "&validationToken=synthetic-dial-1624", {}, 200); assert.equal(await validation.text(), "synthetic-dial-1624");
    await call(callback, { value: [{ subscriptionId: facts.subscriptions[0], clientState: "forged" }] }, 401);
    const notice = { value: [{ subscriptionId: facts.subscriptions[0], clientState: "synthetic-dial-1618-at-least-thirty-two-characters", changeType: "updated", resource: "me/events/synthetic-dial-1625" }] };
    for (let n = 0; n < 2; n++) await call(callback, notice, 204);
    await call(callback, { value: [{ ...notice.value[0], changeType: "deleted" }] }, 204);
    assert.equal((await data("/api/app/calendar/connection")).state, "healthy");
  } else if (kind === "events") {
    await call("/__fixtures/control", { loseCreateResponse: true }, 204); await call("/__fixtures/event", {}, 503);
    const first = await data("/__fixtures/event", {}); facts = await data("/__fixtures/facts");
    assert.equal(facts.events.length, 1); const saved = facts.events[0];
    assert.equal(saved.subject, "Synthetic invitation title"); assert.match(saved.body.content, /Synthetic description\nhttps:\/\/dial.example.test\/manage\/invite\/synthetic-dial-1612/);
    assert.equal(saved.attendees[0].emailAddress.address, "synthetic-dial-1613@example.test");
    assert.ok(saved.singleValueExtendedProperties.some(property => property.value === "synthetic-dial-1609@dial"));
    const moved = await data("/__fixtures/event", { move: true }); assert.equal(moved.providerEventId, first.providerEventId); assert.equal(moved.conferenceUrl, first.conferenceUrl);
    facts = await data("/__fixtures/facts"); assert.equal(facts.events[0].subject, "Synthetic updated title"); assert.ok(facts.calls.filter(call => call.method === "PATCH").every(call => call.ifMatch));
    await data("/__fixtures/event", { phone: true }); facts = await data("/__fixtures/facts"); const phone = facts.events.find(event => event.location.displayName === "+12025550160"); assert.equal(phone.onlineMeeting, undefined);
    await data("/__fixtures/event", { cancel: true }); facts = await data("/__fixtures/facts"); assert.equal(facts.events.some(event => event.id === first.providerEventId), false);
    const sync = await data("/__fixtures/sync", {}); assert.equal(sync.kind, "synced");
    await microsoftBookingLifecycle({ data });
  }
}
