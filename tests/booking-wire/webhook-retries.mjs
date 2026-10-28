import assert from "node:assert/strict";

async function within(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not complete`)), 10000); })]); }
  finally { clearTimeout(timer); }
}

export async function webhookRetries({ data, call, state, receiver, subscribe, process, book, workspace, first, eventInput }) {
  const original = (await data("/api/app/webhooks")).deliveries.find(row => row.subscriptionId === workspace.id && row.eventType === "booking.created.v1");
  const before = receiver.captures.filter(row => row.path === "/workspace" && JSON.parse(row.body).id === original.eventId);
  const at = new Date(Date.now() + 10000).toISOString();
  await data(`/api/app/webhook-deliveries/${original.id}/redeliver`, {}); await process(at, original.id); await process(at, original.id);
  const replayed = receiver.captures.filter(row => row.path === "/workspace" && JSON.parse(row.body).id === original.eventId);
  assert.equal(replayed.length, before.length + 1);
  assert.equal(replayed.at(-1).body, before[0].body);
  assert.notEqual(replayed.at(-1).headers["dial-signature"], before[0].headers["dial-signature"]);
  receiver.verify(replayed.at(-1), workspace.secret);
  const retry = await subscribe("/retry", ["booking.created.v1"]);
  receiver.fail("/retry", 1); await book();
  const clock = new Date(Date.now() + 1000), started = clock.toISOString();
  await process(started);
  let delivery = (await data("/api/app/webhooks")).deliveries.find(row => row.subscriptionId === retry.id);
  assert.deepEqual([delivery.state, delivery.responseCode, delivery.attempts], ["pending", 500, 1]);
  assert.ok(Date.parse(delivery.nextAttemptAt) > clock.getTime(), "retry is scheduled in the future");
  await process(new Date(Date.parse(delivery.nextAttemptAt) - 1).toISOString(), delivery.id);
  assert.equal(receiver.captures.filter(row => row.path === "/retry").length, 1, "not retried before due");
  await data("/__fixtures/webhooks/scheduled", { now: delivery.nextAttemptAt });
  delivery = (await data("/api/app/webhooks")).deliveries.find(row => row.id === delivery.id);
  assert.deepEqual([delivery.state, delivery.responseCode, delivery.attempts], ["delivered", 204, 2]);
  await process(delivery.nextAttemptAt, delivery.id);
  const attempts = receiver.captures.filter(row => row.path === "/retry");
  assert.equal(attempts.filter(row => row.status === 204).length, 1);
  assert.equal(attempts[0].body, attempts[1].body);
  attempts.forEach(row => receiver.verify(row, retry.secret));
  const doomed = await subscribe("/exhausted", ["booking.created.v1"]); receiver.fail("/exhausted", 1000); await book();
  const doomedRow = (await state()).webhook_deliveries.find(row => row.subscription_id === doomed.id);
  assert.equal(Date.parse(doomedRow.retry_until) - Date.parse(doomedRow.created_at), 24 * 3600000);
  let now = new Date(Date.now() + 1000).toISOString(), priorDelay = 0, rounds = 0;
  while (true) {
    await process(now, doomedRow.id);
    const row = (await data("/api/app/webhooks")).deliveries.find(row => row.id === doomedRow.id);
    if (row.state === "failed") break;
    assert.equal(row.state, "pending");
    const delay = Date.parse(row.nextAttemptAt) - Date.parse(now);
    if (rounds < 3) { assert.ok(delay > priorDelay, "backoff grows after successive failures"); priorDelay = delay; }
    assert.ok(Date.parse(row.nextAttemptAt) <= Date.parse(doomedRow.retry_until));
    now = row.nextAttemptAt; assert.ok(++rounds < 40, "bounded retry schedule");
  }
  assert.equal(now, doomedRow.retry_until, "failed at the 24 hour deadline");
  const deleted = await subscribe("/deleted", ["booking.created.v1"]); await book();
  const deletedDelivery = (await state()).webhook_deliveries.find(row => row.subscription_id === deleted.id);
  await call(`/api/app/webhooks/${deleted.id}`, undefined, 200, "DELETE");
  await process(undefined, deletedDelivery.id); await book(); await process();
  assert.equal(receiver.captures.filter(row => row.path === "/deleted").length, 0);
  await call(`/api/app/webhook-deliveries/${deletedDelivery.id}/redeliver`, {}, 404);
  const resolving = await subscribe("/deleted-during-dns", ["booking.created.v1"]); await book();
  const resolvingDelivery = (await state()).webhook_deliveries.find(row => row.subscription_id === resolving.id);
  const dnsStarted = receiver.pauseDns(), inFlight = process(undefined, resolvingDelivery.id);
  await within(Promise.race([dnsStarted, inFlight.then(result => { throw new Error(`Delivery ended before the DNS barrier: ${JSON.stringify(result)}`); })]), "DNS barrier");
  await within(call(`/api/app/webhooks/${resolving.id}`, undefined, 200, "DELETE"), "Deletion while DNS is pending");
  receiver.resumeDns(); assert.deepEqual((await inFlight).results, ["unavailable"]);
  assert.equal(receiver.captures.filter(row => row.path === "/deleted-during-dns").length, 0, "deletion during DNS stops the not-yet-started send");
  // Deleting a routed event preserves history and withdraws its queued payload,
  // including an attempt waiting for DNS and a later routing submission.
  const removedEvent = await data("/api/app/event-types", { ...eventInput, slug: "synthetic-dial-1451" }, 201);
  await data(`/api/app/event-types/${removedEvent.id}/publish`, {});
  const removedTeam = await data("/api/app/teams", { name: "Retired planning", eventTypeIds: [removedEvent.id] }, 201);
  const removedSub = await subscribe("/deleted-event", ["routing.submitted.v1"], "team", removedTeam.id);
  const removedForm = await data("/api/app/routing-forms", { title: "Retired route", questions: [{ key: "purpose", label: "Purpose", required: true }], rules: [{ id: "planning", questionKey: "purpose", equals: "planning", eventTypeId: removedEvent.id, teamId: removedTeam.id }], defaultMessage: "Contact the host" }, 201);
  const removedDoor = `/api/public/routing/${removedForm.id}`;
  const routed = await data(removedDoor + "/submit", { nonce: (await data(removedDoor)).capability.nonce, answers: { purpose: "planning" } }, 201);
  assert.equal(routed.eventTypeId, removedEvent.id);
  const queued = (await state()).webhook_deliveries.find(row => row.subscription_id === removedSub.id);
  assert.ok(queued, "the supported destination records a real subscriber delivery");
  const resolvingEvent = receiver.pauseDns(), eventInFlight = process(undefined, queued.id);
  await within(Promise.race([resolvingEvent, eventInFlight.then(() => { throw new Error("Event delivery ended before DNS barrier"); })]), "Event DNS barrier");
  try {
    const before = await state();
    const origin = globalThis.process.env.DIAL_REVIEW_ORIGIN;
    const refused = await fetch(origin + `/api/app/event-types/${removedEvent.id}`, { method: "DELETE", headers: { Origin: origin } });
    assert.equal(refused.status, 401);
    const unchanged = await state();
    for (const table of ["event_types", "routing_submissions", "team_event_types", "webhook_subscriptions", "webhook_deliveries"]) assert.deepEqual(unchanged[table], before[table], `${table}: refused deletion changes nothing`);
    await call(`/api/app/event-types/${removedEvent.id}`, undefined, 204, "DELETE");
  } finally { receiver.resumeDns(); }
  assert.deepEqual((await eventInFlight).results, ["unavailable"]);
  const removedState = await state();
  assert.equal(removedState.routing_submissions.find(row => row.id === routed.submissionId).event_type_id, null, "routing history retains no live event reference");
  assert.ok(removedState.team_event_types.every(row => row.event_type_id !== removedEvent.id));
  assert.ok(removedState.webhook_deliveries.every(row => JSON.parse(row.body_json).data.eventTypeId !== removedEvent.id));
  assert.deepEqual((await process(undefined, queued.id)).results, ["not_due"]);
  await call(`/api/app/webhook-deliveries/${queued.id}/redeliver`, {}, 404);
  const beforeSubmission = removedState.routing_submissions;
  await call(removedDoor + "/submit", { nonce: (await data(removedDoor)).capability.nonce, answers: { purpose: "planning" } }, 409);
  assert.deepEqual((await state()).routing_submissions, beforeSubmission, "a removed routing destination creates nothing");
  assert.equal(receiver.captures.filter(row => row.path === "/deleted-event").length, 0, "a deleted event never reaches its subscriber");
  const eraseId = (await state()).webhook_deliveries.find(row => row.booking_id === first.booking.id).id;
  const preview = await data("/api/app/privacy/preview", { email: first.payload.email });
  await data("/api/app/privacy/erase", { email: first.payload.email, confirmation: preview.confirmation, expiresAt: preview.expiresAt });
  assert.ok((await state()).webhook_deliveries.every(row => row.booking_id !== first.booking.id));
  await call(`/api/app/webhook-deliveries/${eraseId}/redeliver`, {}, 404);
  const total = receiver.captures.length; await process(undefined, eraseId); assert.equal(receiver.captures.length, total);
  const personal = await book(), pending = (await state()).webhook_deliveries.find(row => row.booking_id === personal.booking.id && row.subscription_id === workspace.id);
  const personalPreview = await data("/api/app/privacy/preview", { email: personal.payload.email });
  const erased = await data("/api/app/privacy/erase", { email: personal.payload.email, confirmation: personalPreview.confirmation, expiresAt: personalPreview.expiresAt });
  assert.equal(erased.localComplete, true, "confirmed booking erasure completes through the native door");
  assert.ok((await state()).webhook_deliveries.every(row => row.booking_id !== personal.booking.id));
  const capturesAfterErasure = receiver.captures.length;
  assert.deepEqual((await process(undefined, pending.id)).results, ["not_due"]);
  await call(`/api/app/webhook-deliveries/${pending.id}/redeliver`, {}, 404);
  assert.equal(receiver.captures.length, capturesAfterErasure);
  assert.equal(receiver.captures.filter(row => JSON.parse(row.body).data.bookingId === personal.booking.id).length, 0, "erased confirmed booking cannot expose a queued payload");
}
