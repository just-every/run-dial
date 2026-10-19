import { seedDemoWorkspace, localMagicLink, confirmAuthLink, bootstrapTestOwner, readTestMail } from "./auth-client.mjs";
import assert from "node:assert/strict";
import { startWorker, executeD1, queuedMail } from "./requests/runtime.mjs";
import { contract } from "./contract.mjs";

let journey;
const gate = (context) => journey ??= requestJourney(context);
contract("REQUEST-002", "reviewed alternative requests replay exactly after nonce expiry and retain no public internal identifiers", gate);
contract("REQUEST-003", "operators list requests by state, read each window in the invitee's and the host's zone, and mark a request handled or closed once", gate);
contract("REQUEST-004", "a request mails every host by default; a subset mails only the chosen operators; suppressed email keeps the in-app record and mails nobody", gate);

async function requestJourney(context) {
  const server = await startWorker(context);
  const cookie = await operatorCookie(server.origin);
  await seedDemoWorkspace(server.origin, cookie);
  const event = await firstEvent(server.origin, cookie);
  await executeD1(server, `UPDATE event_types SET status = 'published', alternative_requests_enabled = 1 WHERE id = '${event.id}'`);

  const body = { inviteeName: "Avery Invitee", inviteeEmail: "avery@example.test", inviteeTimezone: "UTC", note: "Afternoons work best.", windows: [{ date: tomorrow(), startMinute: 780, endMinute: 840 }] };
  const review = await json(await fetch(`${server.origin}/api/public/events/maya-chen/${event.slug}/request/review`, post(body)));
  assert.equal(typeof review.nonce, "string");
  assert.ok(review.expiresAt);
  assert.doesNotMatch(JSON.stringify(review), /eventTypeId|compositionHash|operator|requestId/i, "the public review exposes no internal request identifiers");

  const createdResponse = await fetch(`${server.origin}/api/public/events/maya-chen/${event.slug}/request?nonce=${encodeURIComponent(review.nonce)}`, post(body));
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const created = await json(createdResponse);
  assert.doesNotMatch(JSON.stringify(created), /eventTypeId|compositionHash|requestId|operator/i, "the submission receipt remains a public DTO");

  await executeD1(server, "UPDATE availability_request_review_nonces SET expires_at = '2000-01-01T00:00:00.000Z' WHERE consumed_at IS NOT NULL");
  const replayResponse = await fetch(`${server.origin}/api/public/events/maya-chen/${event.slug}/request?nonce=${encodeURIComponent(review.nonce)}`, post(body));
  assert.equal(replayResponse.status, 200, "an already-consumed, matching nonce remains idempotent after expiry");
  assert.deepEqual(await json(replayResponse), created);

  const inboxResponse = await fetch(`${server.origin}/api/app/availability-requests?state=submitted`, { headers: { cookie } });
  assert.equal(inboxResponse.status, 200, `${await inboxResponse.clone().text()}\n${server.output.text.slice(-4_000)}`);
  const inbox = await json(inboxResponse);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].inviteeEmail, body.inviteeEmail);
  const detail = await json(await fetch(`${server.origin}/api/app/availability-requests/${inbox[0].id}`, { headers: { cookie } }));
  assert.match(detail.windows[0].inviteeLabel, /1:00\sPM UTC\+00:00.*\(UTC\)$/, "REQUEST-003: the window in the invitee's zone");
  assert.match(detail.windows[0].hostLabel, /11:00\sPM UTC\+10:00.*\(Australia\/Brisbane\)$/, "REQUEST-003: the same window in the host's zone");
  const handled = await fetch(`${server.origin}/api/app/availability-requests/${inbox[0].id}/state`, { ...post({ state: "handled" }), headers: { ...post({}).headers, cookie } });
  assert.equal(handled.status, 200, await handled.clone().text());
  const repeatTransition = await fetch(`${server.origin}/api/app/availability-requests/${inbox[0].id}/state`, { ...post({ state: "handled" }), headers: { ...post({}).headers, cookie } });
  assert.equal(repeatTransition.status, 409, "the lifecycle transition and notification are one-time");
  const listed = async (state) => (await json(await fetch(`${server.origin}/api/app/availability-requests?state=${state}`, { headers: { cookie } }))).map((request) => request.id);
  assert.deepEqual(await listed("handled"), [inbox[0].id], "REQUEST-003: the handled list holds the handled request");
  assert.deepEqual(await listed("submitted"), [], "REQUEST-003: a handled request leaves the submitted list");
  const closing = { ...body, inviteeName: "Casey Invitee", inviteeEmail: "casey@example.test" };
  const closingReview = await json(await fetch(`${server.origin}/api/public/events/maya-chen/${event.slug}/request/review`, post(closing)));
  assert.equal((await fetch(`${server.origin}/api/public/events/maya-chen/${event.slug}/request?nonce=${encodeURIComponent(closingReview.nonce)}`, post(closing))).status, 201);
  const [closingId] = await listed("submitted");
  const transition = (id, state) => fetch(`${server.origin}/api/app/availability-requests/${id}/state`, { ...post({ state }), headers: { ...post({}).headers, cookie } });
  assert.equal((await transition(closingId, "closed")).status, 200);
  assert.deepEqual(await listed("closed"), [closingId], "REQUEST-003: the closed list holds the closed request");
  assert.equal((await transition(closingId, "closed")).status, 409, "REQUEST-003: closing is one-time");
  assert.equal((await transition(closingId, "handled")).status, 409, "REQUEST-003: a closed request cannot be handled");
  const erased = await fetch(`${server.origin}/api/app/availability-requests/${inbox[0].id}`, { method: "DELETE", headers: { cookie, origin: server.origin } });
  assert.equal(erased.status, 204);
  const missing = await fetch(`${server.origin}/api/app/availability-requests/${inbox[0].id}`, { headers: { cookie } });
  assert.equal(missing.status, 404);
  const erasedReplay = await fetch(`${server.origin}/api/public/events/maya-chen/${event.slug}/request?nonce=${encodeURIComponent(review.nonce)}`, post(body));
  assert.equal(erasedReplay.status, 404, "erasure invalidates the stored request capability without disclosing the erased request");
  await routingJourney(server, cookie, event, body);
}

/** REQUEST-004: policy `availability-request.routing.v1` per event type, applied when the request is created. */
async function routingJourney(server, cookie, event, body) {
  const { origin } = server, headers = { cookie, origin, "content-type": "application/json" };
  const firstEmail = "operator@dial.test", secondEmail = "second-host@dial.test";
  const invited = await fetch(`${origin}/api/app/operators`, { method: "POST", headers, body: JSON.stringify({ email: secondEmail }) });
  assert.equal(invited.status, 201, await invited.clone().text());
  const secondId = (await invited.json()).operator.id;
  const invitation = (await readTestMail(origin)).find((message) => [message.to].flat().includes(secondEmail))?.text?.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)?.[0];
  assert.ok(invitation, "the second operator's invitation reached the test mail adapter");
  assert.equal((await confirmAuthLink(invitation)).status, 303, "the second operator accepts and becomes active");
  const path = `${origin}/api/app/event-types/${event.id}/correspondence`;
  const config = await json(await fetch(path, { headers: { cookie } }));
  assert.equal(config.requestRouting, undefined, "an event never routed uses the default policy");
  const route = (requestRouting) => fetch(path, { method: "PUT", headers, body: JSON.stringify({ ...config, requestRouting }) });
  let client = 0;
  const submit = async (inviteeEmail) => {
    // Each invitee arrives from its own address, so the hourly per-address request limit is not what is under test.
    const composition = { ...body, inviteeName: "Routing Invitee", inviteeEmail }, from = (request) => ({ ...request, headers: { ...request.headers, "CF-Connecting-IP": `198.18.4.${++client}` } });
    const review = await json(await fetch(`${origin}/api/public/events/maya-chen/${event.slug}/request/review`, from(post(composition))));
    const created = await fetch(`${origin}/api/public/events/maya-chen/${event.slug}/request?nonce=${encodeURIComponent(review.nonce)}`, from(post(composition)));
    assert.equal(created.status, 201, await created.clone().text());
    const listed = await json(await fetch(`${origin}/api/app/availability-requests?state=submitted`, { headers: { cookie } }));
    const request = listed.find((candidate) => candidate.inviteeEmail === inviteeEmail);
    assert.ok(request, "the request is in the operator inbox");
    return queuedMail(server, request.id);
  };
  const operatorsMailed = (mail) => mail.filter((row) => row.role === "operator").map((row) => row.recipient).sort();
  const inviteeMailed = (mail) => mail.filter((row) => row.role === "invitee").map((row) => row.recipient);

  const byDefault = await submit("routing-default@example.test");
  assert.deepEqual(operatorsMailed(byDefault), [firstEmail, secondEmail].sort(), "default routing mails every host recipient: each operator of a single-host install");
  assert.deepEqual(inviteeMailed(byDefault), ["routing-default@example.test"]);

  for (const invalid of [{ mode: "selected", operatorIds: [] }, { mode: "selected", operatorIds: ["01UNKNOWNOPERATOR000000000"] }, { mode: "suppressed", operatorIds: [secondId] }, { mode: "everyone" }]) {
    assert.equal((await route(invalid)).status, 400, `refused policy ${JSON.stringify(invalid)}`);
  }
  assert.equal((await json(await fetch(path, { headers: { cookie } }))).requestRouting, undefined, "refused policies change nothing");

  const subset = await route({ mode: "selected", operatorIds: [secondId] });
  assert.equal(subset.status, 200, await subset.clone().text());
  assert.deepEqual((await json(subset)).requestRouting, { mode: "selected", operatorIds: [secondId] });
  const selected = await submit("routing-subset@example.test");
  assert.deepEqual(operatorsMailed(selected), [secondEmail], "a subset mails only the chosen operators");
  assert.deepEqual(inviteeMailed(selected), ["routing-subset@example.test"], "routing never touches the invitee acknowledgement");

  assert.equal((await route({ mode: "suppressed", operatorIds: [] })).status, 200);
  assert.deepEqual((await json(await fetch(path, { headers: { cookie } }))).requestRouting, { mode: "suppressed", operatorIds: [] }, "the policy is stored per event type");
  const suppressed = await submit("routing-suppressed@example.test");
  assert.deepEqual(operatorsMailed(suppressed), [], "suppressed email mails no operator");
  assert.deepEqual(inviteeMailed(suppressed), ["routing-suppressed@example.test"], "suppression keeps the in-app record (found above) and the invitee acknowledgement");

  assert.equal((await route({ mode: "host_recipients", operatorIds: [] })).status, 200);
  assert.deepEqual(operatorsMailed(await submit("routing-restored@example.test")), [firstEmail, secondEmail].sort(), "returning to the default mails every host recipient again");
}

async function operatorCookie(origin) {
  await bootstrapTestOwner(origin);
  await fetch(`${origin}/api/auth/magic-links`, { ...post({ email: "operator@dial.test" }), headers: { Origin: origin, "content-type": "application/json" } });
  const link = (await localMagicLink(origin)).developmentLink;
  const response = await confirmAuthLink(link);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}
async function firstEvent(origin, cookie) { const events = await json(await fetch(`${origin}/api/app/event-types`, { headers: { cookie } })); assert.ok(events[0]); return events[0]; }
function post(body) { return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }
async function json(response) { const body = await response.text(); try { return JSON.parse(body); } catch { throw new Error(`expected JSON (${response.status}): ${body.slice(0, 500)}`); } }
function tomorrow() { return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10); }
