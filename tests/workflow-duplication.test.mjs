import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { contract } from './contract.mjs';
import { startWebhookRuntime } from './booking-wire/webhook-runtime.mjs';

contract('FLOW-001', 'owner duplication copies attached workflow configuration independently without history or implicit sends', async context => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`, state = await mkdtemp(join(tmpdir(), 'dial-workflow-copy-'));
  const runtime = await startWebhookRuntime({ state, port, origin });
  context.after(async () => { await runtime.dispose(); await rm(state, { recursive: true, force: true }); });
  const db = await runtime.getD1Database('DB');
  let cookie, secret, sequence = 0;
  const call = (path, { body, method = body === undefined ? 'GET' : 'POST', anonymous = false, machine = false } = {}) => fetch(origin + path, {
    method, redirect: 'manual', headers: { origin, 'content-type': 'application/json',
      ...(!anonymous && !machine && cookie ? { cookie } : {}),
      ...(machine ? { authorization: `Bearer ${secret}`, 'Idempotency-Key': `synthetic-dial-copy-${sequence++}` } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async (path, options = {}, expected = 200) => {
    const response = await call(path, options);
    assert.equal(response.status, expected, `${options.method ?? (options.body ? 'POST' : 'GET')} ${path.split('?')[0]}`);
    return response.json();
  };
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const snapshot = async () => Object.fromEntries(await Promise.all([
    'event_types', 'workflow_rules', 'workflow_dispatches', 'bookings', 'booking_occurrences', 'booking_answers',
    'booking_history', 'booking_manage_tokens', 'delivery_outbox', 'delivery_attempts', 'base_mail_dispatch',
  ].map(async table => [table, await rows(`SELECT * FROM ${table} ORDER BY rowid`)])));
  const tick = async () => {
    const response = await call('/cdn-cgi/local/scheduled?format=json');
    assert.equal(response.status, 200, 'the native scheduler completes'); await response.arrayBuffer();
  };
  const deliver = async () => { await json('/__fixtures/deliver', { body: {} }); };
  await json('/wire/init', { body: {} });
  const bootstrap = await call('/auth/bootstrap', { body: { token: 'dial-test-only-setup-token-at-least-32', displayName: 'Synthetic Dial Owner', returnTo: '/app' } });
  assert.equal(bootstrap.status, 303); cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const { eventId } = await json('/__fixtures/setup', { body: {} });
  await json('/wire/control', { body: { name: 'google-conference', value: 'success' } });
  const credential = await json('/api/app/api-credentials', { body: {
    name: 'Synthetic Dial workflow copy', scopes: ['workflows:manage'], expiresAt: new Date(Date.now() + 86400000).toISOString(),
  } }, 201);
  secret = credential.secret;
  const create = (name, enabled) => json('/api/v1/workflows', { machine: true, body: {
    name, enabled, eventTypeId: eventId, subject: `Synthetic Dial ${name}`, text: `Preparation for ${name}: 桜 & <details>`,
  } }, 201);
  const enabled = await create('enabled workflow', true), disabled = await create('disabled workflow', false), removed = await create('removed workflow', true);
  await json(`/api/v1/workflows/${enabled.id}`, { machine: true, method: 'PATCH', body: { text: 'Original preparation: 桜 & <details>' } });
  await json(`/api/v1/workflows/${removed.id}`, { machine: true, method: 'DELETE' });
  const source = await json(`/api/app/event-types/${eventId}`);
  const week = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  const address = index => [`synthetic-dial-copy-${index}`, 'example.test'].join('@');
  const book = async (event, index) => {
    const base = `/api/public/book/dial-host/${event.slug}`;
    const slots = await json(`${base}/availability?week=${week}&inviteeTimezone=UTC`, { anonymous: true });
    assert.ok(slots.slots.length > 0, 'the published event offers an eligible slot');
    const startAt = slots.slots[0].startAt;
    const selection = await json(`${base}/selection`, { anonymous: true, body: { startAt, inviteeTimezone: 'UTC' } }, 201);
    return json(`${base}/confirm`, { anonymous: true, body: { nonce: selection.nonce, startAt, inviteeTimezone: 'UTC',
      name: `Synthetic Dial guest ${index}`, email: address(index), answers: { [event.questions[0].key]: `Synthetic preparation ${index}` },
    } }, 201);
  };
  const workflowMails = async () => (await json('/wire/state')).wire_calls
    .filter(row => new URL(row.url).hostname === 'api.sendgrid.com' && row.method === 'POST')
    .map(row => JSON.parse(row.body)).filter(mail => mail.subject.startsWith('Synthetic Dial '));
  const originalBooking = await book(source, 1);
  await tick(); await tick(); await deliver();
  const sourceRuns = await rows('SELECT * FROM workflow_dispatches WHERE workflow_id=?', enabled.id);
  assert.equal(sourceRuns.length, 1, 'the source has a real execution receipt');
  assert.equal(sourceRuns[0].booking_id, originalBooking.bookingReference);
  assert.equal((await workflowMails()).length, 1, 'the source sent its own enabled workflow once');
  const before = await snapshot(), beforeMail = await workflowMails();
  const duplicateDoor = `/api/app/event-types/${eventId}/duplicate`;
  const anonymous = await call(duplicateDoor, { anonymous: true, body: {} });
  assert.equal(anonymous.status, 401); await anonymous.arrayBuffer();
  assert.deepEqual(await snapshot(), before, 'anonymous duplication changes no configuration, booking, authority or delivery row');
  const copy = await json(duplicateDoor, { body: {} }, 201);
  assert.equal(copy.status, 'draft'); assert.notEqual(copy.id, source.id);
  const all = (await json('/api/v1/workflows', { machine: true })).data;
  const attached = all.filter(rule => rule.eventTypeId === copy.id);
  assert.equal(attached.length, 2, 'removed workflows are not attachments');
  const config = rule => ({ name: rule.name, subject: rule.subject, text: rule.text, enabled: rule.enabled,
    createdBy: rule.createdBy, trigger: rule.trigger, action: rule.action });
  for (const original of all.filter(rule => rule.eventTypeId === eventId)) {
    const cloned = attached.find(rule => rule.name === original.name);
    assert.ok(cloned); assert.deepEqual(config(cloned), config(original), 'every supported configuration value is preserved');
    assert.ok(![enabled.id, disabled.id, removed.id].includes(cloned.id));
    assert.equal(cloned.id.length, 26); assert.equal(cloned.version, 1, 'the copied rule has a fresh revision');
    assert.equal(cloned.enabledAt, cloned.enabled ? cloned.createdAt : null);
  }
  const clonedEnabled = attached.find(rule => rule.enabled), clonedDisabled = attached.find(rule => !rule.enabled);
  const after = await snapshot();
  for (const table of Object.keys(before).filter(table => !['event_types', 'workflow_rules'].includes(table))) {
    assert.deepEqual(after[table], before[table], `${table}: duplication carries no booking, receipt, capability or outbound command`);
  }
  assert.deepEqual(after.workflow_rules.filter(rule => rule.event_type_id === eventId), before.workflow_rules, 'source rules remain intact');
  assert.deepEqual(await workflowMails(), beforeMail);
  await tick(); await tick(); await deliver();
  assert.equal((await rows('SELECT * FROM workflow_dispatches WHERE workflow_id IN (?,?)', clonedEnabled.id, clonedDisabled.id)).length, 0, 'a draft with no bookings has an empty run log');
  assert.deepEqual(await workflowMails(), beforeMail, 'copying and scheduling alone send nothing');
  const draftPublic = await call(`/api/public/events/dial-host/${copy.slug}`, { anonymous: true });
  assert.equal(draftPublic.status, 404); await draftPublic.arrayBuffer();
  console.log('PROBE FLOW-001 duplication: owner duplicate with enabled, disabled and removed rules plus a sent source run -> draft, two equivalent fresh rules, empty run log, unchanged booking and outbound rows; anonymous request -> 401 without writes');
  await json(`/api/v1/workflows/${enabled.id}`, { machine: true, method: 'PATCH', body: { subject: 'Synthetic Dial source edit' } });
  await json(`/api/v1/workflows/${disabled.id}`, { machine: true, method: 'PATCH', body: { text: 'Source disabled edit' } });
  assert.deepEqual(config(await json(`/api/v1/workflows/${clonedEnabled.id}`, { machine: true })), config(clonedEnabled));
  assert.deepEqual(config(await json(`/api/v1/workflows/${clonedDisabled.id}`, { machine: true })), config(clonedDisabled));
  await json(`/api/v1/workflows/${clonedEnabled.id}`, { machine: true, method: 'PATCH', body: { text: 'Independent copied preparation' } });
  assert.equal((await json(`/api/v1/workflows/${enabled.id}`, { machine: true })).text, 'Original preparation: 桜 & <details>');
  await json(`/api/app/event-types/${copy.id}/publish`, { body: {} });
  const copiedBooking = await book(copy, 2);
  await tick(); await tick(); await deliver(); await deliver();
  const copiedRuns = await rows('SELECT * FROM workflow_dispatches WHERE workflow_id IN (?,?)', clonedEnabled.id, clonedDisabled.id);
  assert.equal(copiedRuns.length, 1); assert.equal(copiedRuns[0].workflow_id, clonedEnabled.id);
  assert.equal(copiedRuns[0].booking_id, copiedBooking.bookingReference);
  const sent = (await workflowMails()).filter(mail => mail.subject === clonedEnabled.subject && JSON.stringify(mail).includes(address(2)));
  assert.equal(sent.length, 1, 'a later eligible copy booking sends exactly once despite repeated scheduler and delivery passes');
  assert.ok(JSON.stringify(sent[0]).includes('Independent copied preparation'));
  assert.deepEqual(await rows('SELECT * FROM workflow_dispatches WHERE workflow_id=?', enabled.id), sourceRuns, 'copy execution never reuses or changes source receipts');
  console.log('PROBE FLOW-001 independence and execution: edit each side, publish copy and confirm a later public booking -> independent text, one copied dispatch and one actual provider message across repeated scheduler passes; disabled rule stays silent');
  const queuedBooking = await book(copy, 3);
  await tick();
  const pending = (await rows('SELECT * FROM workflow_dispatches WHERE workflow_id=? AND booking_id=?', clonedEnabled.id, queuedBooking.bookingReference))[0];
  assert.ok(pending);
  await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,?,?,'owner','active',?)")
    .bind('synthetic-dial-copy-owner', address(99), 'Synthetic second owner', Date.now()).run();
  await db.prepare("UPDATE oa_operators SET status='inactive' WHERE id=?").bind(clonedEnabled.createdBy).run();
  await deliver();
  const stopped = await db.prepare('SELECT state,last_error_code FROM delivery_outbox WHERE id=?').bind(pending.outbox_id).first();
  assert.equal(stopped.state, 'failed'); assert.equal(stopped.last_error_code, 'workflow_authority_revoked');
  assert.equal((await workflowMails()).length, 2, 'a copied rule retains the active owner delivery check');
  await db.prepare("UPDATE oa_operators SET status='active' WHERE id=?").bind(clonedEnabled.createdBy).run();
  await tick(); await deliver();
  assert.equal((await workflowMails()).length, 2, 'restoring owner status never replays a refused dispatch');
  await db.prepare('DELETE FROM oa_sessions WHERE operator_id=?').bind(clonedEnabled.createdBy).run();
  const revokedBefore = await snapshot();
  const revoked = await call(duplicateDoor, { body: {} });
  assert.equal(revoked.status, 401); await revoked.arrayBuffer();
  assert.deepEqual(await snapshot(), revokedBefore, 'a revoked owner session cannot duplicate captured configuration');
  console.log('PROBE FLOW-001 authority: queued copied workflow after owner deactivation -> failed workflow_authority_revoked and no provider send; owner restoration -> no replay; revoked duplicate session -> 401 without writes');
});
