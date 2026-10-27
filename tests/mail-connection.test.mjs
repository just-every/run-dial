import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, configuration } from './mail-connection/fixture.mjs';

test('mail readiness starts unchecked, records sender checks and permits publication only after fresh provider verification', async t => {
  for (const overrides of [{}, { MAIL_API_KEY: undefined }, { MAIL_FROM: undefined }]) {
    const f = await fixture(t, overrides);
    const before = await f.snapshot();
    const health = await (await f.request('/api/app/mail/connection')).json();
    assert.equal(health.state, 'unchecked');
    assert.equal(health.reason, null);
    assert.equal(health.checkedAt, null);
    assert.deepEqual(await f.snapshot(), before, 'viewing fresh health has no write effects');
    assert.equal(f.calls, 0);
    const missing = Object.keys(overrides).length > 0;
    assert.equal((await f.request('/api/app/mail/check', {})).status, missing ? 503 : 200);
    const checked = await (await f.request('/api/app/mail/connection')).json();
    assert.equal(checked.state, missing ? 'unhealthy' : 'healthy');
    assert.equal(checked.reason, missing ? 'missing_configuration' : null);
    assert.ok(Number.isFinite(Date.parse(checked.checkedAt)));
    assert.equal(f.calls, missing ? 0 : 2);
    if (!missing) await verifyPublication(f);
    await f.close();
  }
});

async function verifyPublication(f) {
  const health = await (await f.request('/api/app/mail/connection')).json();
  assert.equal(health.eventTracking, 'off');
  const declaration = JSON.parse(await readFile('deploy.json', 'utf8'));
  const { secretBindings } = await import('../node_modules/@runeditrun/rer/modules/deploy-kit/worker.mjs');
  const { ownerPlan } = await import('../node_modules/@runeditrun/rer/modules/deploy-kit/owner.mjs');
  const plan = ownerPlan({ project: declaration.project, environment: 'production', worker: 'mail-fixture', origin: configuration.APP_URL }, declaration, { migrations: [] });
  const inputs = { OWNER_EMAIL: configuration.OWNER_EMAIL, SESSION_SECRET: configuration.SESSION_SECRET, SETUP_TOKEN: configuration.SETUP_TOKEN, SENDGRID_API_KEY: configuration.MAIL_API_KEY, MAIL_FROM: configuration.MAIL_FROM };
  await secretBindings({}, 'fixture-worker', plan, inputs, false);
  for (const missing of ['SENDGRID_API_KEY', 'MAIL_FROM']) await assert.rejects(secretBindings({}, 'fixture-worker', plan, { ...inputs, [missing]: undefined }, false), /missing-secret/);
  const event = await (await f.request('/__fixture/seed')).json();
  const beforeRefusalCalls = f.calls;
  f.verified = false;
  assert.equal((await f.request(`/api/app/event-types/${event.id}/publish`, {})).status, 409);
  assert.ok(f.calls > 0);
  assert.ok(f.calls > beforeRefusalCalls, 'refused publication also performs a fresh provider check');
  assert.equal((await (await f.request(`/api/app/event-types/${event.id}`)).json()).status, 'draft');
  f.verified = true;
  assert.equal((await f.request('/api/app/mail/check', {})).status, 200);
  const calls = f.calls;
  assert.equal((await f.request(`/api/app/event-types/${event.id}/publish`, {})).status, 200);
  assert.ok(f.calls > calls, 'publication performs a fresh provider check');
}

test('provider webhooks refuse unsigned or oversized bodies before verifying them', async t => {
  const f = await fixture(t, { MAIL_WEBHOOK_KEY: 'synthetic-dial-1', RESEND_WEBHOOK_SECRET: 'synthetic-dial-2' });
  const before = await f.snapshot();
  const oversized = 'x'.repeat(1024 * 1024 + 1), timestamp = String(Math.floor(Date.now() / 1000));
  const signatures = {
    '/api/webhooks/resend': { 'svix-id': 'synthetic-dial-3', 'svix-timestamp': timestamp, 'svix-signature': 'v1,c3ludGhldGlj' },
    '/api/webhooks/sendgrid': { 'x-twilio-email-event-webhook-timestamp': timestamp, 'x-twilio-email-event-webhook-signature': 'c3ludGhldGlj' },
    '/api/webhooks/stripe': { 'stripe-signature': `t=${timestamp},v1=${'0'.repeat(64)}` },
  };
  for (const [path, headers] of Object.entries(signatures)) {
    const refused = await f.request(path, oversized, headers);
    assert.equal(refused.status, 413, `${path} refuses a body over 1 MiB`);
    assert.equal((await refused.json()).error.code, 'provider_callback_too_large');
    assert.equal((await f.request(path, oversized)).status, 401, `${path} refuses a body without its signature headers`);
  }
  assert.deepEqual(await f.snapshot(), before, 'refused callbacks write nothing');
});

test('SendGrid callbacks stay closed without a key or valid signature and signed bounce receipts remain idempotent', async t => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  for (const configured of [false, true]) {
    const f = await fixture(t, configured ? { MAIL_WEBHOOK_KEY: key } : {});
    const message = { idempotencyKey: 'signed-send', to: 'invitee@example.test', subject: 'Confirmation', text: 'Booking confirmed.' };
    // Seed the paid-provider acceptance edge; the callback travels through the real HTTP route.
    assert.equal((await f.request('/__fixture/mail', message)).status, 204);
    const body = JSON.stringify([{ sg_event_id: 'signed-event', event: 'bounce', rer_delivery_id: message.idempotencyKey }]);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { 'x-twilio-email-event-webhook-timestamp': timestamp, 'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.from(timestamp + body), pair.privateKey).toString('base64') };
    const before = await f.snapshot();
    assert.equal((await f.request('/api/webhooks/sendgrid', body)).status, 401);
    assert.equal((await f.request('/api/webhooks/sendgrid', body + ' ', headers)).status, 401);
    assert.deepEqual(await f.snapshot(), before);
    assert.equal((await f.request('/api/webhooks/sendgrid', body, headers)).status, configured ? 204 : 401);
    if (configured) {
      const row = await f.db.prepare('SELECT state,last_error_code FROM delivery_outbox').first();
      assert.deepEqual({ ...row }, { state: 'failed', last_error_code: 'bounced' });
      const after = (await f.db.prepare('SELECT * FROM delivery_outbox').all()).results;
      assert.equal((await f.request('/api/webhooks/sendgrid', body, headers)).status, 204);
      assert.deepEqual((await f.db.prepare('SELECT * FROM delivery_outbox').all()).results, after);
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM provider_webhook_events').first()).n, 1);
    } else assert.deepEqual(await f.snapshot(), before);
    await f.close();
  }
});
