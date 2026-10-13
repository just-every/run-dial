import { evidencePath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { add, authenticate, call, data, neutral, origin, remove, rules, sideEffects, snapshot, waitForBarrier } from "../tests/public-blocking/helpers.mjs";

const checks = [], races = [], mark = (check) => { checks.push(check); console.log(`PASS ${check}`); };
try {
  const fixture = await data("/__fixtures/setup", {});
  await data("/__fixtures/blocking/barrier", { state: "released" });
  await authenticate(fixture.operatorEmail);
  await call("/api/app/blocked-addresses", undefined, 401);
  await call("/api/app/blocked-addresses", { kind: "email", value: "auth@dial.test" }, 401);
  await call(`/api/app/blocked-addresses/${"a".repeat(26)}`, undefined, 401, false, "DELETE");
  await call("/api/app/blocked-addresses", { kind: "email", value: "forged@dial.test" }, 403, true, "POST", { Origin: "https://forged.example.test" });
  assert.deepEqual(await rules(), []);
  mark("native list/create/delete require sessions and forged write origins cannot add rules");

  const exact = await add("email", "  EXACT@DIAL.TEST  ");
  assert.equal(exact.value, "exact@dial.test"); assert.equal(exact.kind, "email"); assert.equal(exact.id.length, 26);
  const duplicate = await add("email", "Exact@Dial.Test"); assert.deepEqual(duplicate, exact);
  const domain = await add("domain", "  Quota.Example.Test  "); assert.equal(domain.value, "quota.example.test");
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => add("domain", "QUOTA.EXAMPLE.TEST")));
  assert.ok(duplicates.every((rule) => rule.id === domain.id)); assert.equal((await rules()).length, 2);
  for (const value of ["@example.test", "https://example.test", "*.example.test", "example.test/path", "name space.test"]) await call("/api/app/blocked-addresses", { kind: "domain", value }, 400, true);
  await call(`/api/app/blocked-addresses/${exact.id}`, undefined, 403, true, "DELETE", { Origin: "https://forged.example.test" });
  assert.equal((await rules()).length, 2);
  mark("email/domain values trim and lowercase; duplicate/concurrent upserts retain one rule identity; malformed hostnames and forged deletion are refused");

  const event = await data("/api/public/events/dial-host/intro");
  const answerKey = event.eventType.questions[0].key;
  const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
  const slots = availability.slots.filter((slot) => Date.parse(slot.startAt) > Date.now() + 86400000); assert.ok(slots.length > 80);
  async function publicBody(index, email, name = email) {
    const selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slots[index].startAt, inviteeTimezone: "UTC" }, 201);
    return { nonce: selection.nonce, startAt: slots[index].startAt, inviteeTimezone: "UTC", name, email, answers: { [answerKey]: "Synthetic blocking fixture" } };
  }
  const confirm = (body, expected) => call("/api/public/book/dial-host/intro/confirm", body, expected);
  const operatorBody = (index, email) => ({ eventTypeId: fixture.eventId, startAt: slots[index].startAt, inviteeTimezone: "UTC", name: "Synthetic operator invitee", email, answers: { [answerKey]: "Synthetic operator blocking" }, overrideNoticeAndHorizon: true });
  const blockedBody = await publicBody(0, " ExAcT@DiAl.TeSt ");
  let before = sideEffects(await snapshot());
  await neutral(await confirm(blockedBody, 409), "booking_unavailable"); assert.deepEqual(sideEffects(await snapshot()), before);
  await neutral(await call("/api/app/bookings", operatorBody(0, "exact@dial.test"), 409, true), "booking_unavailable"); assert.deepEqual(sideEffects(await snapshot()), before);
  const domainBody = await publicBody(4, "USER@QUOTA.EXAMPLE.TEST"); before = sideEffects(await snapshot());
  await neutral(await confirm(domainBody, 409), "booking_unavailable"); assert.deepEqual(sideEffects(await snapshot()), before);
  await neutral(await call("/api/app/bookings", operatorBody(4, "user@quota.example.test"), 409, true), "booking_unavailable"); assert.deepEqual(sideEffects(await snapshot()), before);
  mark("exact email and domain rules neutrally refuse public and operator bookings without consuming nonces, claims, calendar commands or notification effects");

  for (const [index, email] of [[8, "other@dial.test"], [12, "user@sub.quota.example.test"], [16, "user@notquota.example.test"]]) await confirm(await publicBody(index, email), 201);
  await remove(exact.id); await call(`/api/app/blocked-addresses/${exact.id}`, undefined, 404, true, "DELETE");
  const receipt = await (await confirm(blockedBody, 201)).json();
  const replayBlock = await add("email", "exact@dial.test");
  before = sideEffects(await snapshot()); const replay = await (await confirm(blockedBody, 200)).json();
  assert.deepEqual(replay, receipt); assert.deepEqual(sideEffects(await snapshot()), before); await remove(replayBlock.id);
  mark("matching is exact across addresses and subdomains; deleting a rule permits the same unconsumed nonce once, and a later block preserves an already-created replay");

  const requestBody = { inviteeName: "Blocked alternative invitee", inviteeEmail: "request@quota.example.test", inviteeTimezone: "UTC", note: "Synthetic alternate request", windows: [{ date: week, startMinute: 780, endMinute: 840 }] };
  const review = await data("/api/public/events/dial-host/intro/request/review", requestBody, 201);
  const requestPath = `/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(review.nonce)}`;
  before = sideEffects(await snapshot()); await neutral(await call(requestPath, requestBody, 409), "request_unavailable"); assert.deepEqual(sideEffects(await snapshot()), before);
  await remove(domain.id);
  const requestReceipt = await data(requestPath, requestBody, 201);
  const requestBlock = await add("domain", "quota.example.test"); before = sideEffects(await snapshot());
  assert.deepEqual(await data(requestPath, requestBody), requestReceipt); assert.deepEqual(sideEffects(await snapshot()), before);
  await remove(requestBlock.id);
  mark("blocked alternative submission preserves its review nonce and creates no request/mail; unblocking permits exact retry once and later blocking keeps replay idempotent");

  async function verificationRace(path, body, authenticated, email) {
    const beforeRace = sideEffects(await snapshot());
    await data("/__fixtures/blocking/barrier", { state: "armed" });
    const pending = call(path, body, 409, authenticated);
    // Attach a handler immediately so a defect cannot become an unhandled rejection while the barrier is controlled.
    const result = pending.then((response) => ({ response }), (error) => ({ error }));
    let installed;
    try { await waitForBarrier(); installed = await add("email", email); }
    finally { await data("/__fixtures/blocking/barrier", { state: "released" }); }
    const completed = await result; if (completed.error) throw completed.error;
    await neutral(completed.response, "booking_unavailable"); assert.deepEqual(sideEffects(await snapshot()), beforeRace);
    await remove(installed.id);
    await call(path, body, 201, authenticated);
  }
  await verificationRace("/api/public/book/dial-host/intro/confirm", await publicBody(24, "late-public@dial.test"), false, "late-public@dial.test");
  await verificationRace("/api/app/bookings", operatorBody(28, "late-operator@dial.test"), true, "late-operator@dial.test");
  mark("a rule installed after the preliminary check during held calendar verification atomically prevents both public and operator claims; release after unblock permits the original retry");

  for (let index = 0; index < 3; index++) {
    const body = { ...requestBody, inviteeName: `Concurrent alternative${index}`, inviteeEmail: `concurrent-${index}@dial.test` };
    const review = await data("/api/public/events/dial-host/intro/request/review", body, 201);
    const path = `/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(review.nonce)}`;
    const beforeRace = sideEffects(await snapshot());
    const [rule, submitted] = await Promise.all([add("email", body.inviteeEmail), call(path, body, [201, 409])]);
    const created = submitted.status === 201;
    if (!created) { await neutral(submitted, "request_unavailable"); assert.deepEqual(sideEffects(await snapshot()), beforeRace); }
    await call(path, body, created ? 200 : 409);
    await remove(rule.id); await call(path, body, created ? 200 : 201);
    const after = await snapshot(); assert.equal(after.availability_requests.filter((row) => row.invitee_email === body.inviteeEmail).length, 1);
    races.push({ case: index, outcome: created ? "submission committed before rule" : "rule committed before submission" });
  }
  mark("concurrent rule installation and alternative submission produce one valid serialized outcome, with one eventual request and idempotent retry");

  for (const [index, first] of [[60, "booking"], [64, "request"]]) {
    const email = `erasure-${first}@erasure-${first}.example.test`;
    await confirm(await publicBody(index, email), 201);
    const composition = { ...requestBody, inviteeName: `Erasure${first}`, inviteeEmail: email };
    const reviewed = await data("/api/public/events/dial-host/intro/request/review", composition, 201);
    await call(`/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(reviewed.nonce)}`, composition, 201);
    const subjects = await snapshot();
    const booking = subjects.bookings.find((row) => row.invitee_email === email);
    const request = subjects.availability_requests.find((row) => row.invitee_email === email);
    const addressRule = await add("email", email), domainRule = await add("domain", email.split("@")[1]);
    const eraseBooking = () => call(`/api/app/bookings/${booking.id}`, undefined, 202, true, "DELETE");
    const eraseRequest = () => call(`/api/app/availability-requests/${request.id}`, undefined, 204, true, "DELETE");
    await (first === "booking" ? eraseBooking() : eraseRequest());
    assert.ok((await rules()).some((rule) => rule.id === addressRule.id), "another contact record still needs its email rule");
    await (first === "booking" ? eraseRequest() : eraseBooking());
    const remaining = await rules();
    assert.ok(!remaining.some((rule) => rule.id === addressRule.id)); assert.ok(remaining.some((rule) => rule.id === domainRule.id));
    const erased = await snapshot();
    assert.ok(!erased.bookings.some((row) => row.id === booking.id)); assert.ok(!erased.availability_requests.some((row) => row.id === request.id));
    assert.ok(erased.anonymized_audit.some((row) => row.entity_kind === "booking" && row.action === "erased"));
    assert.ok(erased.anonymized_audit.some((row) => row.entity_kind === "availability_request" && row.action === "erased"));
    assert.ok(!JSON.stringify(erased.anonymized_audit).includes(email)); await remove(domainRule.id);
  }
  const orphan = await add("email", "no-historical-subject@dial.test"); await remove(orphan.id);
  mark("erasing either first contact record retains its email rule; erasing the last removes it atomically while keeping domain policy and anonymized audit, and operators can delete orphan rules");

  await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {});
  const final = await snapshot();
  assert.equal(final.bookings.filter((row) => row.invitee_email === "exact@dial.test").length, 1);
  assert.equal(final.availability_requests.filter((row) => row.invitee_email === requestBody.inviteeEmail).length, 1);
  const requestId = final.availability_requests.find((row) => row.invitee_email === requestBody.inviteeEmail).id;
  assert.equal(final.fixture_mail.filter((row) => row.key.startsWith(`request:${requestId}:`)).length, 2);
  assert.deepEqual(await rules(), []);
  await writeFile(evidencePath("public-blocking.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, providers: "task-owned synthetic calendar and mail", checks, races, limits: ["Native Worker/D1 only. Settings UI controls and browser denial/retry presentation remain unverified under the explicit browser launch hold. Each fixture request uses a task-owned connecting identity to keep the independently verified admission quotas outside this blocking slice."] }, null, 2) + "\n");
} catch (error) {
  await writeFile(evidencePath("public-blocking-failure.json"), JSON.stringify({ observedAt: new Date().toISOString(), origin, checks, races, failure: error.message, stack: error.stack }, null, 2) + "\n");
  throw error;
}
