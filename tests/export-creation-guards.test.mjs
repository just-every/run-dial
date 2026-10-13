import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { contract } from './contract.mjs';
import { fixture, testPlatform } from './archive/fixture.mjs';
import { createArchive } from './archive/artifact.mjs';
import { schemaModel } from '../scripts/archive/schema.mjs';
import { restoreArchive } from './archive/artifact.mjs';
import { createOperatorAuth, createAuthHandler } from '../modules/operator-auth/index.mjs';

async function load(path) {
  const result = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
contract('DATA-001', 'restored salted creation receipts and erasure guards protect retries by a freshly signed-in operator without exporting keys or old authority', async () => {
  const source = await fixture(); const target = await schemaModel();
  // Owner-held salt is supplied directly to each runtime, never via the archive.
  const sessionSecret = randomBytes(32).toString('hex');
  try {
    const { operatorCreationIdentity } = await load('../src/core/features/bookings/operator-creation-receipts.ts');
    const { createOperatorBooking, recoverOperatorBooking } = await load('../src/core/features/bookings/operator-creation.ts');
    const { BookingsRepository } = await load('../src/core/features/bookings/repository.ts');
    const input = { operatorId: 'owner', idempotencyKey: randomUUID(), eventTypeId: 'event_types-1', startAt: '2099-01-01T00:00:00.000Z', inviteeTimezone: 'UTC', name: 'Original invitee', email: 'invitee@example.test', answers: {}, overrideNoticeAndHorizon: false };
    const erasedInput = { ...input, idempotencyKey: randomUUID() };
    const receiptIdentity = await operatorCreationIdentity(input, sessionSecret);
    const erasedIdentity = await operatorCreationIdentity(erasedInput, sessionSecret);
    source.db.prepare('UPDATE operator_creation_receipts SET key_hash=?,payload_hash=?').run(receiptIdentity.keyHash, receiptIdentity.payloadHash);
    source.db.prepare('UPDATE operator_creation_tombstones SET key_hash=?').run(erasedIdentity.keyHash);
    // Inspect the actual schema: neither table stores a raw request key or invitee payload.
    assert.deepEqual(source.db.prepare('PRAGMA table_info(operator_creation_receipts)').all().map(row => row.name), ['key_hash', 'operator_id', 'payload_hash', 'booking_id', 'created_at']);
    assert.deepEqual(source.db.prepare('PRAGMA table_info(operator_creation_tombstones)').all().map(row => row.name), ['key_hash', 'operator_id', 'created_at']);
    const origin = 'https://dial.example.test';
    const sourceMail = [];
    const sourceAuth = createOperatorAuth({ db: testPlatform(source.db).binding, config: { origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: sessionSecret, MAIL_FROM: 'sender@example.test' }, clientIp: () => '198.18.0.1', mailSender: { async send(message) { sourceMail.push(message); return { status: 'accepted' }; } } });
    await sourceAuth.requestMagicLink(new Request(origin + '/auth/magic-link', { method: 'POST', headers: { origin } }), { email: 'owner@example.test', returnTo: '/app' });
    const sourceToken = new URL(sourceMail[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
    const sourceResponse = await createAuthHandler(sourceAuth)(new Request(origin + '/auth/confirm', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: sourceToken }) }));
    const sourceCookie = sourceResponse.headers.get('set-cookie').split(';')[0];
    assert.equal((await sourceAuth.getSession(new Request(origin + '/app', { headers: { cookie: sourceCookie } }))).operator.id, 'owner');
    const platform = testPlatform(source.db); platform.knownSecrets = () => [sessionSecret];
    const archive = await createArchive(platform); const destination = testPlatform(target.db);
    for (const name of ['operator_creation_receipts', 'operator_creation_tombstones']) {
      assert.deepEqual(archive.tables.find(table => table.name === name).rows, source.db.prepare(`SELECT * FROM ${name}`).all().map(row => ({ ...row })));
    }
    for (const value of [input.idempotencyKey, erasedInput.idempotencyKey, sessionSecret]) assert.ok(!JSON.stringify(archive).includes(value));
    await restoreArchive(destination, archive);
    assert.deepEqual(await createArchive(destination), archive);
    const mail = [];
    const auth = createOperatorAuth({ db: destination.binding, config: { origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: sessionSecret, MAIL_FROM: 'sender@example.test' }, clientIp: () => '198.18.0.1', mailSender: { async send(message) { mail.push(message); return { status: 'accepted' }; } } });
    assert.equal(await auth.getSession(new Request(origin + '/app', { headers: { cookie: sourceCookie } })), null);
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM oa_sessions').get().n, 0);
    await auth.requestMagicLink(new Request(origin + '/auth/magic-link', { method: 'POST', headers: { origin } }), { email: 'owner@example.test', returnTo: '/app' });
    const token = new URL(mail[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
    const response = await createAuthHandler(auth)(new Request(origin + '/auth/confirm', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) }));
    assert.equal(response.status, 303);
    const session = await auth.getSession(new Request(origin + '/app', { headers: { cookie: response.headers.get('set-cookie').split(';')[0] } }));
    assert.equal(session.operator.id, input.operatorId);
    const dependencies = {
      repository: new BookingsRepository(destination.binding), runtime: { SESSION_SECRET: sessionSecret },
      availability: { async verifyOperatorSelection() { throw new Error('historical retry must not check provider availability'); } },
      async confirmationEmails() { throw new Error('historical retry must not create mail'); },
    };
    const before = Object.fromEntries(['bookings', 'delivery_outbox', 'booking_manage_tokens', 'operator_creation_receipts', 'operator_creation_tombstones'].map(name => [name, target.db.prepare(`SELECT * FROM ${name}`).all()]));
    const result = await createOperatorBooking(dependencies, { ...input, operatorId: session.operator.id });
    assert.equal(result.kind, 'replayed'); assert.equal(result.booking.id, 'bookings-1');
    assert.deepEqual(await createOperatorBooking(dependencies, { ...input, email: 'changed@example.test' }), { kind: 'payload_mismatch' });
    assert.deepEqual(await createOperatorBooking(dependencies, { ...erasedInput, operatorId: session.operator.id }), { kind: 'attempt_erased' });
    assert.equal(await recoverOperatorBooking(dependencies, { ...input, idempotencyKey: randomUUID() }), undefined);
    for (const [name, rows] of Object.entries(before)) assert.deepEqual(target.db.prepare(`SELECT * FROM ${name}`).all(), rows);
  } finally { source.db.close(); target.db.close(); }
});
