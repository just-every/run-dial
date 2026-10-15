import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './mail-connection/fixture.mjs';

test('Managed mail verifies the relay, sends through Base, honours Retry-After and exposes a retired credential to the owner', async t => {
  const calls = [], relay = 'https://platform.example.test/api/managed-mail/send';
  let status = 202;
  const f = await fixture(t, { MAIL_PROVIDER: 'rer', MAIL_API_KEY: 'synthetic-managed-credential', MAIL_RELAY_URL: relay }, async request => {
    assert.equal(request.url, relay);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('authorization'), 'Bearer synthetic-managed-credential');
    assert.equal(request.headers.get('content-type'), 'application/json');
    const body = await request.json();
    calls.push(body);
    if (status === 307) return new Response(null, { status, headers: { Location: 'https://credential-thief.example.test/' } });
    if (!Object.keys(body).length) return Response.json({ error: 'Invalid message' }, { status: status === 401 ? 401 : 400 });
    assert.deepEqual(Object.keys(body).sort(), ['html', 'subject', 'text', 'to']);
    assert.ok(['invitee@example.test', 'owner@example.test'].includes(body.to));
    return Response.json(status === 202 ? { accepted: true } : { error: 'sensitive provider body must not reach Dial' }, { status, headers: status === 429 ? { 'Retry-After': '180' } : {} });
  });
  assert.equal((await f.request('/api/app/mail/check', {})).status, 200);
  const event = await (await f.request('/__fixture/seed')).json();
  assert.equal((await f.request(`/api/app/event-types/${event.id}/publish`, {})).status, 200);
  const now = new Date(), at = now.toISOString();
  // A real queued invitee notice, with network as the only substituted edge.
  const enqueue = async (id, recipient = {}) => {
    await f.db.prepare("INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES(?,'mail_send',?,?,'pending',0,?,?,?)")
      .bind(id, id, JSON.stringify({ to: 'invitee@example.test', subject: 'A conversation with Robin', text: 'Your conversation is confirmed.', html: '<p>Your conversation is confirmed.</p>', ...recipient }), at, at, at).run();
  };
  const process = async (id, time = at) => (await (await f.request('/__fixture/process', { outboxId: id, now: time })).json()).result;
  const row = id => f.db.prepare('SELECT state,last_error_code,next_attempt_at FROM delivery_outbox WHERE id=?').bind(id).first();
  await enqueue('managed-accepted');
  assert.equal(await process('managed-accepted'), 'succeeded');
  assert.equal(await process('managed-accepted'), 'not_due');
  assert.equal(calls.filter(body => body.to).length, 1, 'a completed command is never sent twice');
  status = 429;
  await enqueue('managed-throttled');
  assert.equal(await process('managed-throttled'), 'retrying');
  assert.equal(Date.parse((await row('managed-throttled')).next_attempt_at) - now.getTime(), 180_000);
  assert.equal(await process('managed-throttled', new Date(now.getTime() + 179_000).toISOString()), 'not_due');
  status = 202;
  assert.equal(await process('managed-throttled', new Date(now.getTime() + 180_000).toISOString()), 'succeeded');
  status = 429;
  const owner = await f.db.prepare('SELECT id,access_generation AS generation FROM operators WHERE normalized_email=?').bind('owner@example.test').first();
  await enqueue('managed-operator-throttled', { to: 'owner@example.test', recipientRole: 'operator', operatorAccess: owner });
  assert.equal(await process('managed-operator-throttled'), 'retrying');
  assert.equal(Date.parse((await row('managed-operator-throttled')).next_attempt_at) - now.getTime(), 180_000, 'Retry-After survives the native notification coordinator');
  status = 401;
  await enqueue('managed-retired');
  assert.equal(await process('managed-retired'), 'failed');
  assert.equal((await row('managed-retired')).last_error_code, 'unauthorized');
  const health = await (await f.request('/api/app/mail/connection')).json();
  assert.equal(health.state, 'unhealthy');
  assert.equal(health.reason, 'unauthorized');
  assert.equal((await f.request('/api/app/mail/check', {})).status, 503);
  assert.equal((await f.request(`/api/app/event-types/${event.id}/publish`, {})).status, 409);
  status = 307;
  await enqueue('managed-redirect');
  assert.equal(await process('managed-redirect'), 'failed');
  assert.equal((await row('managed-redirect')).last_error_code, 'mail_outcome_unknown');
  status = 202;
  assert.equal((await f.request('/auth/magic-link', { email: 'owner@example.test', returnTo: '/app' })).status, 202);
  assert.ok(calls.some(body => body.to === 'owner@example.test' && body.text.includes('/auth/confirm')));
  const missing = await fixture(t, { MAIL_PROVIDER: 'rer', MAIL_API_KEY: undefined, MAIL_RELAY_URL: relay });
  assert.equal((await missing.request('/api/app/mail/check', {})).status, 503);
  assert.equal(missing.calls, 0);
});
