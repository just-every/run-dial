import { evidencePath as outputPath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { authenticate, call, create, data, deliver, effects, errorCode, origin, snapshot } from "../tests/operator-creation-recovery/helpers.mjs";

const evidencePath = outputPath("operator-creation-recovery.json");
const checks = [], proofs = [], mark = (check) => { checks.push(check); console.log(`PASS ${check}`); };
function owned(state, id) { return state.delivery_outbox.filter((row) => row.booking_id === id); }
function proveOne(state, body, id, delivered = false) {
  assert.equal(state.bookings.filter((row) => row.invitee_email === body.email).length, 1);
  assert.equal(state.booking_occurrences.filter((row) => row.booking_id === id).length, 1);
  assert.equal(state.booking_history.filter((row) => row.booking_id === id && row.action === "created").length, 1);
  assert.equal(state.booking_manage_tokens.filter((row) => row.booking_id === id).length, 1);
  const commands = owned(state, id);
  assert.equal(commands.filter((row) => row.kind === "calendar_upsert").length, 1);
  const roleMail = commands.filter((row) => row.kind === "mail_send" && ["operator", "invitee"].includes(JSON.parse(row.payload_json).recipientRole));
  const confirmations = roleMail.filter((row) => {
    const mail = JSON.parse(row.payload_json);
    return row.idempotency_key === `booking:${id}:occurrence:${row.occurrence_id}:mail:${mail.recipientRole}:${mail.to.toLowerCase()}`;
  });
  assert.equal(confirmations.length, 3);
  const linkReady = commands.filter((row) => row.kind === "mail_send" && row.idempotency_key.endsWith(":link-ready"));
  assert.equal(linkReady.length, delivered ? 1 : 0);
  assert.ok(linkReady.every((row) => JSON.parse(row.payload_json).recipientRole === "invitee"));
  assert.deepEqual(roleMail.map((row) => row.id).sort(), [...confirmations, ...linkReady].map((row) => row.id).sort(), "all owned booking-wide role mail is exactly the three confirmations and any delivered link-ready notice");
  assert.equal(commands.filter((row) => row.kind === "reminder").length, 6);
  assert.equal(new Set(commands.map((row) => row.idempotency_key)).size, delivered ? 11 : 10);
  const receipt = state.operator_creation_receipts.filter((row) => row.booking_id === id);
  assert.equal(receipt.length, 1); assert.match(receipt[0].key_hash, /^[A-Za-z0-9_-]{43}$/); assert.match(receipt[0].payload_hash, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(receipt[0]).sort(), ["booking_id", "created_at", "key_hash", "operator_id", "payload_hash"]);
  assert.ok(!JSON.stringify(state).includes(body.idempotencyKey), "raw retry keys are absent from all inspected native records"); assert.ok(!JSON.stringify(receipt).includes(body.email)); assert.ok(!JSON.stringify(receipt).includes(body.name));
  return receipt[0];
}

try {
  if (process.argv[2] === "--before-restart") {
    const fixture = await data("/__fixtures/setup", {});
    await authenticate(fixture.operatorEmail); await authenticate(fixture.secondEmail);
    const event = await data("/api/public/events/dial-host/intro");
    const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
    const slots = availability.slots.filter((slot) => Date.parse(slot.startAt) > Date.now() + 2 * 86400000); assert.ok(slots.length > 80);
    const bodyAt = (index, email) => ({ idempotencyKey: randomUUID(), eventTypeId: fixture.eventId, startAt: slots[index].startAt, inviteeTimezone: "UTC", name: "Synthetic recovery invitee", email, answers: { [event.eventType.questions[0].key]: "Synthetic recovery answer" }, overrideNoticeAndHorizon: true });
    const lost = bodyAt(0, "lost-response@dial.test"); let before = effects(await snapshot());
    await call("/api/app/bookings", lost, 401);
    await call("/api/app/bookings", lost, 403, fixture.operatorEmail, "POST", { Origin: "https://forged.example.test" });
    await call("/api/app/bookings", { ...lost, idempotencyKey: "malformed" }, 400, fixture.operatorEmail);
    assert.deepEqual(effects(await snapshot()), before);
    mark("native creation requires authentication, a valid write origin and a UUID retry key; refusals create no effects");

    await call("/api/app/bookings", lost, 503, fixture.operatorEmail, "POST", { "X-Synthetic-Lost-Response": "yes" });
    let state = await snapshot(); const lostId = state.bookings.find((row) => row.invitee_email === lost.email).id;
    proveOne(state, lost, lostId); before = effects(state);
    const recovered = await create(lost, 200, fixture.operatorEmail); assert.equal(recovered.id, lostId); assert.deepEqual(effects(await snapshot()), before);
    mark("discarding the actual post-commit response as synthetic503 is recovered by an identical200 retry without a second claim, history or command set");

    const parallel = bodyAt(8, "parallel-recovery@dial.test");
    const responses = await Promise.all(Array.from({ length: 8 }, () => call("/api/app/bookings", parallel, [201, 200], fixture.operatorEmail)));
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    const receipts = await Promise.all(responses.map((response) => response.json())); assert.equal(new Set(receipts.map((receipt) => receipt.id)).size, 1);
    state = await snapshot(); proveOne(state, parallel, receipts[0].id); before = effects(state);
    const cosmeticReplay = Object.fromEntries(Object.entries({ ...parallel, name: `  ${parallel.name}  `, email: `  ${parallel.email.toUpperCase()}  ` }).reverse());
    assert.notEqual(JSON.stringify(cosmeticReplay), JSON.stringify(parallel));
    assert.equal((await create(cosmeticReplay, 200, fixture.operatorEmail)).id, receipts[0].id); assert.deepEqual(effects(await snapshot()), before);
    for (const changed of [{ name: "Changed name" }, { email: "changed@dial.test" }, { startAt: slots[12].startAt }, { answers: { [event.eventType.questions[0].key]: "Changed answer" } }]) {
      await errorCode(await call("/api/app/bookings", { ...parallel, ...changed }, 409, fixture.operatorEmail), "booking_attempt_changed");
      assert.deepEqual(effects(await snapshot()), before);
    }
    mark("eight parallel identical attempts commit one booking and one command set; canonical whitespace/email and JSON property-order replay200, while changed payloads409 without effects");

    const otherSession = await call("/api/app/bookings", parallel, 409, fixture.secondEmail);
    assert.ok(!(await otherSession.clone().text()).includes(receipts[0].id)); await errorCode(otherSession, "slot_unavailable");
    const secondBody = { ...parallel, startAt: slots[16].startAt, email: "second-owned@dial.test" };
    const secondBooking = await create(secondBody, 201, fixture.secondEmail); assert.notEqual(secondBooking.id, receipts[0].id);
    const firstHash = proveOne(await snapshot(), parallel, receipts[0].id), secondHash = proveOne(await snapshot(), secondBody, secondBooking.id);
    assert.notEqual(firstHash.key_hash, secondHash.key_hash); assert.notEqual(firstHash.operator_id, secondHash.operator_id);
    before = effects(await snapshot());
    assert.equal((await create({ ...secondBody, operatorId: firstHash.operator_id }, 200, fixture.secondEmail)).id, secondBooking.id);
    assert.deepEqual(effects(await snapshot()), before);
    mark("the same raw key in another native operator session cannot replay private attempt data and has a distinct scoped receipt");

    const composition = { inviteeName: "Linked recovery invitee", inviteeEmail: "linked-recovery@dial.test", inviteeTimezone: "UTC", note: "Synthetic recovery request", windows: [{ date: week, startMinute: 780, endMinute: 840 }] };
    const review = await data("/api/public/events/dial-host/intro/request/review", composition, 201);
    const publicReceipt = await data(`/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(review.nonce)}`, composition, 201);
    assert.ok(!Object.hasOwn(publicReceipt.request, "id"), "public request receipts omit internal request identity");
    const requests = await data("/api/app/availability-requests", undefined, 200, fixture.operatorEmail);
    const request = requests.find((entry) => entry.inviteeEmail === composition.inviteeEmail); assert.ok(request?.id);
    const linked = { ...bodyAt(24, composition.inviteeEmail), requestId: request.id, name: composition.inviteeName };
    const linkedResponses = await Promise.all(Array.from({ length: 4 }, () => call("/api/app/bookings", linked, [201, 200], fixture.operatorEmail)));
    assert.equal(linkedResponses.filter((response) => response.status === 201).length, 1);
    const linkedReceipts = await Promise.all(linkedResponses.map((response) => response.json())), winner = linkedReceipts[0];
    assert.equal(new Set(linkedReceipts.map((receipt) => receipt.id)).size, 1);
    state = await snapshot(); proveOne(state, linked, winner.id);
    const handled = state.availability_requests.find((row) => row.id === request.id); assert.equal(handled.state, "handled"); assert.equal(handled.booking_id, winner.id);
    assert.equal(state.delivery_outbox.filter((row) => row.request_id === request.id && row.idempotency_key === `request:${request.id}:invitee:handled`).length, 1);
    before = effects(state); assert.equal((await create(linked, 200, fixture.operatorEmail)).id, winner.id); assert.deepEqual(effects(await snapshot()), before);
    mark("four parallel linked attempts use the real serialized Durable Object and recover one booking; handling and acknowledgement commit once, and later replay bypasses resolved eligibility");

    const block = await data("/api/app/blocked-addresses", { kind: "email", value: lost.email }, 201, fixture.operatorEmail);
    before = effects(await snapshot()); assert.equal((await create(lost, 200, fixture.operatorEmail)).id, lostId); assert.deepEqual(effects(await snapshot()), before);
    await call("/__fixtures/control", { kind: "busy", failure: true }, 204);
    await call("/__fixtures/calendar-health", { healthy: false }, 204);
    before = effects(await snapshot()); assert.equal((await create(lost, 200, fixture.operatorEmail)).id, lostId); assert.deepEqual(effects(await snapshot()), before);
    const denied = bodyAt(32, "preclaim-denied@dial.test");
    await errorCode(await call("/api/app/bookings", denied, 503, fixture.operatorEmail), "calendar_provider_unavailable"); assert.deepEqual(effects(await snapshot()), before);
    await call("/__fixtures/control", { kind: "busy", failure: false }, 204); await call("/__fixtures/calendar-health", { healthy: true }, 204);
    const deniedBlock = await data("/api/app/blocked-addresses", { kind: "email", value: denied.email }, 201, fixture.operatorEmail);
    before = effects(await snapshot()); await errorCode(await call("/api/app/bookings", denied, 409, fixture.operatorEmail), "booking_unavailable"); assert.deepEqual(effects(await snapshot()), before);
    await call(`/api/app/blocked-addresses/${deniedBlock.id}`, undefined, 204, fixture.operatorEmail, "DELETE");
    const allowed = await create(denied, 201, fixture.operatorEmail); proveOne(await snapshot(), denied, allowed.id);
    await call(`/api/app/blocked-addresses/${block.id}`, undefined, 204, fixture.operatorEmail, "DELETE");
    mark("post-commit blocking or provider health failure cannot defeat matching replay; preclaim denials persist no receipt and the same key can later succeed");

    await deliver(); state = await snapshot();
    for (const [id, body] of [[lostId, lost], [receipts[0].id, parallel], [secondBooking.id, secondBody], [winner.id, linked], [allowed.id, denied]]) {
      proveOne(state, body, id, true);
      assert.equal(state.fixture_events.filter((row) => row.booking_id === id).length, 1);
      assert.equal(state.fixture_mail.filter((row) => row.key.startsWith(`booking:${id}:`) && row.key.includes(":mail:")).length, 3);
      assert.equal(state.fixture_mail.filter((row) => row.key.startsWith(`booking:${id}:`) && row.key.endsWith(":link-ready")).length, 1);
      proofs.push({ bookingId: id, calendarEffects: 1, confirmationMailEffects: 3, linkReadyMailEffects: 1, reminderCommands: 6 });
    }
    mark("draining synthetic providers delivers one calendar effect, three role-bearing confirmations and one separate meeting-link-ready notice per single creation");
    await writeFile(evidencePath, JSON.stringify({ status: "restart_checkpoint", origin, checks, proofs, fixture, lost, lostId, linked, linkedId: winner.id, requestId: request.id }, null, 2) + "\n");
  } else if (process.argv[2] === "--after-restart") {
    const previous = JSON.parse(await readFile(evidencePath, "utf8")); checks.push(...previous.checks); proofs.push(...previous.proofs);
    await authenticate(previous.fixture.operatorEmail); await authenticate(previous.fixture.secondEmail);
    let state = await snapshot(), before = effects(state);
    const recovered = await create(previous.lost, 200, previous.fixture.operatorEmail); assert.equal(recovered.id, previous.lostId);
    assert.equal((await create(previous.linked, 200, previous.fixture.operatorEmail)).id, previous.linkedId);
    assert.deepEqual(effects(await snapshot()), before);
    await deliver(); assert.deepEqual(effects(await snapshot()), before);
    mark("receipt recovery survives a full native process restart, including handled linked requests, without reopening commands or sending again");

    const receipt = state.operator_creation_receipts.find((row) => row.booking_id === previous.lostId);
    await call(`/api/app/bookings/${previous.lostId}`, undefined, 202, previous.fixture.operatorEmail, "DELETE");
    state = await snapshot(); assert.ok(!state.bookings.some((row) => row.id === previous.lostId)); assert.ok(!state.operator_creation_receipts.some((row) => row.booking_id === previous.lostId));
    const tombstones = state.operator_creation_tombstones.filter((row) => row.key_hash === receipt.key_hash); assert.equal(tombstones.length, 1);
    assert.deepEqual(Object.keys(tombstones[0]).sort(), ["created_at", "key_hash", "operator_id"]); assert.equal(tombstones[0].operator_id, receipt.operator_id);
    for (const forbidden of [previous.lost.idempotencyKey, previous.lostId, receipt.payload_hash, previous.lost.name, previous.lost.email, ...Object.values(previous.lost.answers)]) assert.ok(!JSON.stringify(tombstones).includes(forbidden));
    before = effects(state);
    await errorCode(await call("/api/app/bookings", previous.lost, 410, previous.fixture.operatorEmail), "booking_attempt_erased");
    await errorCode(await call("/api/app/bookings", { ...previous.lost, name: "Changed erased attempt" }, 410, previous.fixture.operatorEmail), "booking_attempt_erased");
    assert.deepEqual(effects(await snapshot()), before);
    await call(`/api/app/bookings/${previous.lostId}`, undefined, 404, previous.fixture.operatorEmail);
    // The erased booking's remote calendar event remains busy until its queued cancellation completes.
    await deliver();
    assert.ok((await snapshot()).erased_calendar_targets.find((row) => row.booking_id === previous.lostId)?.completed_at);
    const newBody = { ...previous.lost, idempotencyKey: randomUUID() }, fresh = await create(newBody, 201, previous.fixture.operatorEmail);
    assert.notEqual(fresh.id, previous.lostId); proveOne(await snapshot(), newBody, fresh.id);
    assert.equal((await create(newBody, 200, previous.fixture.operatorEmail)).id, fresh.id);
    proofs.push({ erasedAttempt: { tombstoneFields: Object.keys(tombstones[0]).sort(), oldKeyStatus: 410, newExplicitKeyStatus: 201 } });
    mark("native erasure cascades the receipt and payload hash, retains only salted attempt/operator/time, prevents old-key revival410, and permits a deliberate new key");
    await writeFile(evidencePath, JSON.stringify({ status: "verified", verifiedAt: new Date().toISOString(), origin, providers: "task-owned synthetic calendar and mail", checks, proofs, limits: ["Native Hono/Start/D1/DO only; browser form retention and per-tab retry key lifecycle remain unverified under the launch hold.", "The lost response is a fixture-wrapper503 after a real201 production commit. Linked native calls remain serialized through the real request Durable Object. Late route recovery before eligibility404/409 was statically reviewed and was not dynamically forced through a service bypass.", "Synthetic distinct connecting identities keep independently verified public admission budgets outside this creation slice."] }, null, 2) + "\n");
  } else throw new Error("Use --before-restart or --after-restart; this fixture provides no browser launch.");
} catch (error) {
  await writeFile(evidencePath, JSON.stringify({ status: "failed", observedAt: new Date().toISOString(), origin, checks, proofs, failure: error.message, stack: error.stack }, null, 2) + "\n");
  throw error;
}
