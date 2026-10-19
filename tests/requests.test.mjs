import { seedDemoWorkspace, localMagicLink, confirmAuthLink, bootstrapTestOwner } from "./auth-client.mjs";
import assert from "node:assert/strict";
import { startWorker, executeD1 } from "./requests/runtime.mjs";
import { contract } from "./contract.mjs";

let journey;
const gate = (context) => journey ??= requestJourney(context);
contract("REQUEST-002", "reviewed alternative requests replay exactly after nonce expiry and retain no public internal identifiers", gate);
contract("REQUEST-003", "operators list requests by state, read each window in the invitee's and the host's zone, and mark a request handled or closed once", gate);

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
