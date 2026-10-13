import { hashToken } from "../modules/operator-auth/crypto.mjs";
import { confirmAuthLink } from "./auth-client.mjs";
import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { origin, startRuntime } from "./operator-removal-mail/runtime.mjs";
import { verifyPrivateTransport } from "./operator-removal-mail/private-transport.mjs";

contract("OPER-002", "removal retires pending operator notifications without reviving them on reinvitation", async (context) => {
  const runtime = await startRuntime(context);
  let cookie, secondCookie, client = 0;
  async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(origin + path, { method, redirect: "manual", headers: { Origin: origin, "CF-Connecting-IP": `198.19.${Math.floor(client / 250)}.${++client % 250 + 1}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, expected, `${path.split("?")[0]}: unexpected status`);
    return response;
  }
  const data = async (...args) => (await call(...args)).json();
  const sql = (sql, values = []) => data("/__removal/sql", { sql, values });
  const state = () => data("/__removal/state");
  const processOne = (id) => data("/__removal/process", { id });
  const payload = (row) => JSON.parse(row.payload_json);
  const email = "former-operator@example.test", inviteeEmail = "independent-invitee@example.test";
  const fixture = await data("/__removal/setup", {});
  const signIn = await data("/__removal/signin", { email: fixture.operatorEmail });
  const session = await confirmAuthLink(signIn.link);
  assert.equal(session.status, 303); cookie = session.headers.get("set-cookie").split(";")[0];
  let confirmationToken;
  const invite = async () => {
    await sql("DELETE FROM oa_limits");
    const operator = (await data("/api/app/operators", { email }, 201)).operator;
    // Base grants a new invitation only after the recipient confirms it.
    const delivery = await data("/__removal/signin", { email });
    confirmationToken = new URL(delivery.link).searchParams.get("token");
    const confirmed = await confirmAuthLink(delivery.link);
    assert.equal(confirmed.status, 303); secondCookie = confirmed.headers.get("set-cookie").split(";")[0];
    return operator;
  };
  let second = await invite();
  const ownerCookie = cookie;
  cookie = secondCookie;
  await data('/auth/step-up', { action: 'delete', returnTo: '/app/settings' }, 202);
  cookie = ownerCookie;
  const stepUpBefore = (await sql('SELECT id FROM oa_step_up_challenges WHERE operator_id=?', [second.id])).results;
  assert.equal(stepUpBefore.length, 1, 'native step-up creates a session-bound proof');
  await data('/auth/magic-link', { email: 'rate-control@example.test', returnTo: '/app' }, 202);
  const rateSecret = 'operator-management-isolated-test-secret-only';
  const personalRateKeys = await Promise.all(['invite','magic','step-up'].map(scope => hashToken(rateSecret, 'rate', `${scope}:email:${email}`)));
  // The valid-link confirmation counter cannot be recomputed from anything stored after the link is used:
  // only its write-time rer_erasure_rates correlation lets erasure find it (DATA-002).
  const confirmationRateKey = await hashToken(rateSecret, 'rate', `confirmation:email:${confirmationToken}`);
  assert.equal((await sql('SELECT count(*) AS n FROM oa_limits WHERE key=?', [confirmationRateKey])).results[0].n, 1);
  assert.deepEqual((await sql("SELECT rate_table,entity FROM rer_erasure_rates WHERE rate_key=? AND subject=?", [confirmationRateKey, second.id])).results, [{ rate_table: 'oa_limits', entity: 'operator' }]);
  const controlRateKey = await hashToken(rateSecret, 'rate', 'magic:email:rate-control@example.test');
  const controlRateBefore = (await sql('SELECT * FROM oa_limits WHERE key=?', [controlRateKey])).results;
  assert.equal(controlRateBefore.length, 1);
  const queueAlert = async (cycle) => { await data("/__removal/alert", { cycle }); return (await state()).delivery_outbox.filter((row) => row.idempotency_key.startsWith(`connection:resend:unhealthy:${cycle}:`)); };
  const legacy = (id) => sql("UPDATE delivery_outbox SET payload_json = json_remove(payload_json, '$.recipientRole') WHERE id = ?", [id]);
  const fault = (row, mode) => sql("INSERT INTO removal_mail_faults(key,mode) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET mode = excluded.mode", [row.idempotency_key, mode]);
  const due = (id) => sql("UPDATE delivery_outbox SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [id]);
  const event = await data("/api/public/events/dial-host/intro");
  const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const offers = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
  const slots = offers.slots.filter((slot) => Date.parse(slot.startAt) > Date.now() + 2 * 86400000);
  assert.ok(slots.length > 10, JSON.stringify({ now: new Date().toISOString(), week, offers }));
  async function book(index, name) {
    const selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slots[index].startAt, inviteeTimezone: "UTC" }, 201);
    await data("/api/public/book/dial-host/intro/confirm", { nonce: selection.nonce, startAt: slots[index].startAt, inviteeTimezone: "UTC", name, email: inviteeEmail, answers: { [event.eventType.questions[0].key]: "Independent public invitee" } }, 201);
    return (await state()).bookings.find((row) => row.invitee_name === name);
  }
  const booking = await book(0, "Public invitee with operator email");
  const retryBooking = await book(4, "Public invitee with ambiguous operator copy");
  const deliveredBooking = await book(8, "Public invitee with completed operator copy");
  const requestBody = { inviteeName: "Independent requester", inviteeEmail, inviteeTimezone: "UTC", note: "Same email, public authority", windows: [{ date: week, startMinute: 780, endMinute: 840 }] };
  const reviewed = await data("/api/public/events/dial-host/intro/request/review", requestBody, 201);
  await data(`/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(reviewed.nonce)}`, requestBody, 201);
  let snapshot = await state();
  const requested = snapshot.availability_requests[0];
  const modernRequest = { ...requestBody, inviteeName: "Second independent requester" };
  const modernReview = await data("/api/public/events/dial-host/intro/request/review", modernRequest, 201);
  await data(`/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(modernReview.nonce)}`, modernRequest, 201);
  const requestNotice = snapshot.delivery_outbox.find((row) => row.request_id === requested.id && payload(row).to === email && payload(row).recipientRole === "operator");
  assert.ok(requestNotice); await legacy(requestNotice.id);
  await queueAlert(10);
  const pendingAlerts = await queueAlert(11);
  await legacy(pendingAlerts.find((row) => payload(row).to === email).id);
  const retryAlerts = await queueAlert(12);
  const frozen = retryAlerts.find((row) => payload(row).to === email);
  await legacy(frozen.id); await fault(frozen, "before");
  assert.equal((await processOne(frozen.id)).result, "retrying");
  const activeFrozen = retryAlerts.find((row) => payload(row).to === fixture.operatorEmail);
  await fault(activeFrozen, "after"); assert.equal((await processOne(activeFrozen.id)).result, "retrying");
  snapshot = await state();
  const ambiguous = snapshot.delivery_outbox.find((row) => row.booking_id === retryBooking.id && row.kind === "mail_send" && payload(row).recipientRole === "operator" && payload(row).to === email);
  await fault(ambiguous, "terminal"); assert.equal((await processOne(ambiguous.id)).result, "failed");
  const retried = await data(`/api/app/bookings/${retryBooking.id}/deliveries/${ambiguous.id}/retry`, {}, 202);
  const completed = snapshot.delivery_outbox.find((row) => row.booking_id === deliveredBooking.id && row.kind === "mail_send" && payload(row).recipientRole === "operator" && payload(row).to === email);
  assert.equal((await processOne(completed.id)).result, "succeeded");
  snapshot = await state();
  const before = snapshot;
  const removedRows = before.delivery_outbox.filter((row) => payload(row).to === email && (payload(row).recipientRole === "operator" || row.id === frozen.id || row.id === requestNotice.id || pendingAlerts.some((alert) => alert.id === row.id)));
  assert.ok(removedRows.length >= 9, "booking, reminders, request, legacy connection and explicit retry work are pending before removal");
  assert.ok(payload(before.delivery_outbox.find((row) => row.id === frozen.id)).wireMail);
  const retryBefore = before.delivery_outbox.find((row) => row.id === retried.id);
  assert.equal(payload(retryBefore).providerIdempotencyKey, ambiguous.idempotency_key);
  assert.deepEqual(payload(retryBefore).wireMail, payload(before.delivery_outbox.find((row) => row.id === ambiguous.id)).wireMail);

  await context.test("native removal erases queued and sent operator copies while preserving unrelated records and the real shared calendar", async () => {
    await call(`/api/app/operators/${second.id}/remove`, undefined, 204, "POST");
    snapshot = await state();
    assert.deepEqual(snapshot.bookings, before.bookings);
    assert.deepEqual(snapshot.booking_history, before.booking_history);
    assert.deepEqual(snapshot.connections, before.connections);
    assert.deepEqual((await sql('SELECT * FROM oa_limits WHERE key=?', [controlRateKey])).results, controlRateBefore);
    for (const key of [...personalRateKeys, confirmationRateKey]) assert.equal((await sql('SELECT count(*) AS n FROM oa_limits WHERE key=?', [key])).results[0].n, 0);
    assert.equal((await sql("SELECT count(*) AS n FROM rer_erasure_rates INDEXED BY rer_erasure_rates_subject WHERE entity='operator' AND subject=?", [second.id])).results[0].n, 0, "no correlation row or index entry links to the erased operator");
    assert.equal((await sql("SELECT count(*) AS n FROM rer_erasure_rates WHERE rate_key=?", [confirmationRateKey])).results[0].n, 0);
    assert.equal((await sql('SELECT count(*) AS n FROM oa_step_up_challenges WHERE operator_id=?', [second.id])).results[0].n, 0);
    assert.deepEqual(snapshot.delivery_attempts, before.delivery_attempts.filter(attempt => !removedRows.some(row => row.id === attempt.outbox_id)), "only the removed operator delivery attempts are erased");
    assert.deepEqual(snapshot.fixture_mail, before.fixture_mail, "removal creates no provider effect");
    const tableNames = (await sql("SELECT name FROM sqlite_master WHERE type='table' AND name<>'_cf_METADATA' ORDER BY name")).results;
    for (const { name } of tableNames) {
      const records = (await sql(`SELECT * FROM "${name.replaceAll('"', '""')}"`)).results;
      assert.equal(JSON.stringify(records).toLowerCase().includes(email), false, `${name}: removed operator identity remains`);
    }
    for (const previous of removedRows) {
      const current = snapshot.delivery_outbox.find((row) => row.id === previous.id);
      assert.equal(current, undefined, "queued, failed and sent personal mail rows are destructively erased");
    }
  });
  await context.test("new producers exclude the removed identity while independent public invitee mail still sends", async () => {
    const alerts = await queueAlert(13); assert.equal(alerts.length, 1); assert.equal(payload(alerts[0]).to, fixture.operatorEmail);
    const publicCopies = snapshot.delivery_outbox.filter((row) => payload(row).to === inviteeEmail && (payload(row).recipientRole === "invitee" || row.idempotency_key === `request:${requested.id}:invitee:ack`));
    assert.equal(publicCopies.length, 11, "three public confirmations, six reminders and two request acknowledgements");
    for (const row of publicCopies) { await due(row.id); assert.equal((await processOne(row.id)).result, "succeeded"); }
    const sent = await state();
    for (const row of publicCopies) assert.ok(sent.fixture_mail.some((mail) => mail.key === row.idempotency_key));
    await data(`/api/app/availability-requests/${requested.id}/state`, { state: "closed" });
    const closed = (await state()).delivery_outbox.find((row) => row.idempotency_key === `request:${requested.id}:invitee:closed`);
    assert.ok(closed); assert.equal((await processOne(closed.id)).result, "succeeded");
    assert.ok((await state()).fixture_mail.some((mail) => mail.key === closed.idempotency_key));
  });
  await context.test("reinvitation and process restart do not recreate erased mail or provider receipts", async () => {
    const previousId = second.id; second = await invite(); assert.notEqual(second.id, previousId);
    await runtime.restart();
    const callsBefore = (await state()).calls.length;
    for (const row of removedRows) { await due(row.id); assert.equal((await processOne(row.id)).result, "not_due"); }
    assert.equal((await state()).calls.length, callsBefore);
    const ordinary = removedRows.find((row) => row.booking_id === booking.id && row.kind === "mail_send");
    assert.equal((await data(`/api/app/bookings/${booking.id}/deliveries/${ordinary.id}/retry`, {}, 409)).error.code, "delivery_not_retryable");
    const listed = await data(`/api/app/bookings/${booking.id}/deliveries`);
    assert.equal(listed.find((row) => row.id === ordinary.id), undefined);
    assert.equal((await data(`/api/app/bookings/${retryBooking.id}/deliveries/${ambiguous.id}/retry`, {}, 409)).error.code, "delivery_not_retryable");
  });
  await context.test("active operator retry retains the frozen provider bytes and key; only new work reaches reinvited operators", async () => {
    await fault(activeFrozen, "none"); await due(activeFrozen.id);
    assert.equal((await processOne(activeFrozen.id)).result, "succeeded");
    const sent = await state();
    const calls = sent.calls.filter((row) => row.key === activeFrozen.idempotency_key);
    assert.equal(calls.length, 2); assert.equal(calls[0].message_json, calls[1].message_json);
    assert.equal(sent.fixture_mail.filter((row) => row.key === activeFrozen.idempotency_key).length, 1, "ambiguous acceptance is deduplicated by original identity");
    assert.equal(payload(sent.delivery_outbox.find((row) => row.id === activeFrozen.id)).wireMail.idempotencyKey, activeFrozen.idempotency_key);
    const newAlerts = await queueAlert(14); assert.equal(newAlerts.length, 2);
    await invite(); // Duplicate invitation to an active identity must not retire current work.
    for (const row of newAlerts) assert.equal((await processOne(row.id)).result, "succeeded");
    const current = await state();
    for (const row of newAlerts) assert.ok(current.fixture_mail.some((mail) => mail.key === row.idempotency_key));
  });
  await context.test("late provider failure cannot recreate an erased sent-mail receipt", async () => {
    const receipt = before.delivery_attempts.find((attempt) => attempt.outbox_id === completed.id);
    assert.ok(receipt.provider_message_id, "actual test sink delivery produced a receipt before removal");
    assert.equal((await data("/__removal/bounce", { providerMessageId: receipt.provider_message_id })).changed, false);
    assert.equal((await state()).delivery_outbox.find((row) => row.id === completed.id), undefined);
    assert.equal((await data(`/api/app/bookings/${deliveredBooking.id}/deliveries/${completed.id}/retry`, {}, 409)).error.code, "delivery_not_retryable");
  });
  await context.test("legacy rows from removal before the repair are denied at send time and retired before reactivation", async () => {
    const first = (await queueAlert(15)).find((row) => payload(row).to === email);
    const secondOld = (await queueAlert(16)).find((row) => payload(row).to === email);
    await legacy(first.id); await legacy(secondOld.id);
    await fault(secondOld, "before"); assert.equal((await processOne(secondOld.id)).result, "retrying");
    const oldBytes = (await state()).delivery_outbox.find((row) => row.id === secondOld.id).payload_json;
    await sql("UPDATE oa_operators SET status = 'inactive' WHERE id = ?", [second.id]);
    const callsBefore = (await state()).calls.length;
    assert.equal((await processOne(first.id)).result, "failed");
    assert.equal((await state()).calls.length, callsBefore);
    assert.equal((await state()).delivery_outbox.find((row) => row.id === first.id).last_error_code, "operator_removed");
    await invite(); await due(secondOld.id); assert.equal((await processOne(secondOld.id)).result, "not_due");
    const final = await state();
    assert.deepEqual(payload(final.delivery_outbox.find((row) => row.id === secondOld.id)), { ...JSON.parse(oldBytes), operatorAccessRevoked: true });
    assert.equal(final.delivery_outbox.find((row) => row.id === secondOld.id).last_error_code, "operator_removed");
    assert.equal(final.calls.length, callsBefore + 1, "only the new invitation itself is sent");
  });
  await context.test("operator removal holds until one person confirmation erases all overlapping invitee records", async () => {
    const overlapping = (await data("/api/app/operators", { email: inviteeEmail }, 201)).operator;
    const beforeHold = await state();
    const held = await data('/api/app/privacy/preview', { email: inviteeEmail });
    assert.equal(held.operatorIdentityRetained, true);
    await call(`/api/app/operators/${overlapping.id}/remove`, undefined, 409, 'POST');
    assert.deepEqual((await state()).bookings, beforeHold.bookings);
    const receipt = await data('/api/app/privacy/erase', { email: inviteeEmail, confirmation: held.confirmation, expiresAt: held.expiresAt });
    assert.equal(receipt.localComplete, true);
    assert.equal(receipt.operatorIdentityRetained, true);
    assert.equal(JSON.stringify(receipt).includes(inviteeEmail) || JSON.stringify(receipt).includes(overlapping.id), false);
    const erased = await state();
    assert.equal(erased.bookings.some(row => row.invitee_email === inviteeEmail), false);
    assert.equal(erased.availability_requests.some(row => row.invitee_email === inviteeEmail), false);
    assert.equal((await data('/api/app/operators')).operators.some(row => row.id === overlapping.id), true);
    await call(`/api/app/operators/${overlapping.id}/remove`, undefined, 204, 'POST');
    assert.equal((await data('/api/app/privacy/preview', { email: inviteeEmail })).operatorIdentityRetained, false);
  });
  await context.test("shared domain policy keeps its anonymous author while native authority cannot be revived", async () => {
    const address = 'policy-author@example.test';
    const author = (await data('/api/app/operators', { email: address }, 201)).operator;
    const delivery = await data('/__removal/signin', { email: address });
    const joined = await confirmAuthLink(delivery.link);
    assert.equal(joined.status, 303);
    const authorCookie = joined.headers.get('set-cookie').split(';')[0];
    await sql('INSERT INTO oa_domain_rules(domain,provider_id,created_by,created_at) VALUES(?,?,?,?)', ['shared.example.test','existing-provider',author.id,1234]);
    const prior = (await sql('SELECT * FROM oa_domain_rules')).results;
    const version = (await sql('SELECT version FROM oa_operators WHERE id=?', [author.id])).results[0].version;
    await call(`/api/app/operators/${author.id}/remove`, undefined, 204, 'POST');
    assert.deepEqual((await sql('SELECT * FROM oa_domain_rules')).results, prior);
    const anonymous = (await sql('SELECT * FROM oa_operators WHERE id=?', [author.id])).results[0];
    assert.equal(anonymous.email, 'erased:' + author.id);
    assert.equal(anonymous.display_name, 'Removed operator');
    assert.equal(anonymous.status, 'inactive'); assert.ok(anonymous.version > version);
    assert.equal((await data('/api/app/operators')).operators.some(row => row.id === author.id), false);
    cookie = authorCookie; await call('/api/app/profile', undefined, 401); cookie = ownerCookie;
    assert.equal((await confirmAuthLink(delivery.link)).status, 400);
    await call('/auth/operator/status', { operatorId: author.id, status: 'active' }, 404);
    assert.equal((await sql('SELECT status FROM oa_operators WHERE id=?', [author.id])).results[0].status, 'inactive');
    for (const { name } of (await sql("SELECT name FROM sqlite_master WHERE type='table' AND name<>'_cf_METADATA'")).results) {
      const values = (await sql(`SELECT * FROM "${name.replaceAll('"', '""')}"`)).results;
      assert.equal(JSON.stringify(values).toLowerCase().includes(address), false, `${name}: domain author identity remained`);
    }
    const invitedAgain = (await data('/api/app/operators', { email: address }, 201)).operator;
    assert.notEqual(invitedAgain.id, author.id);
    assert.deepEqual((await sql('SELECT * FROM oa_domain_rules')).results, prior);
  });
  await context.test("the declared Start transport denies missing, forged and revoked native sessions", async () => {
    await verifyPrivateTransport({ origin, cookie });
  });
});
