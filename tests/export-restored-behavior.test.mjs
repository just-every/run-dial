import { createArchive } from './archive/artifact.mjs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { contract } from './contract.mjs';
import { fixture, healthChanges, testPlatform } from './archive/fixture.mjs';
import { schemaModel } from '../scripts/archive/schema.mjs';
import { restoreArchive } from './archive/artifact.mjs';
async function load(path) {
  const result = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n//# sourceURL=dial-test-bundle:${path}\n`).toString('base64')}`);
}
contract('CAL-006', 'restored Calendar preserves health history, requires reauthorization for a connected source and preserves a disconnected source', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    const destination = testPlatform(target.db);
    const archive = await createArchive(testPlatform(source.db));
    assert.deepEqual(archive.tables.find(table => table.name === 'calendar_connection_health_changes').rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)), healthChanges);
    await restoreArchive(destination, archive);
    const history = db => db.prepare('SELECT * FROM calendar_connection_health_changes ORDER BY occurred_at,id').all().map(row => ({ ...row }));
    assert.deepEqual(history(target.db), healthChanges, 'restore preserves historical health facts without inventing a reauthorization transition');
    const { CalendarConnectionService } = await load('../src/core/features/calendar-connection/service.ts');
    const { CalendarConnectionRepository } = await load('../src/core/features/calendar-connection/repository.ts');
    let calls = 0;
    const adapter = {
      authorizationUrl(_url, state) { return `https://provider.example.test/authorize?state=${encodeURIComponent(state)}`; },
      async exchangeAuthorizationCode() { calls++; return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: '2099-01-01T00:00:00.000Z' }; },
      async listCalendars() { calls++; return []; },
    };
    const runtime = { APP_URL: 'https://dial.example.test', SESSION_SECRET: 'synthetic-fresh-session-secret-at-least-32-chars', GOOGLE_OAUTH_CLIENT_ID: 'fixture-client', GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-secret', CALENDAR_WEBHOOK_SECRET: 'fixture-webhook' };
    const calendar = new CalendarConnectionService(new CalendarConnectionRepository(destination.binding), runtime, adapter);
    assert.equal((await calendar.connectionHealth()).reason, 'reauthorization_required');
    assert.deepEqual(await calendar.checkConnection(), { kind: 'unavailable', code: 'reauthorization_required' });
    assert.deepEqual(await calendar.readBusy({ startAt: '2026-10-07T00:00:00.000Z', endAt: '2026-10-07T01:00:00.000Z', freshness: 'cached' }), { kind: 'unavailable', code: 'reauthorization_required' });
    assert.equal(calls, 0);
    assert.deepEqual(history(target.db), healthChanges, 'reading restored unavailable health preserves its history');
    const session = { id: 'owner', sessionId: 'new-session' };
    const authorization = await calendar.beginAuthorization(session); assert.ok(authorization);
    const state = new URL(authorization).searchParams.get('state');
    assert.deepEqual(await calendar.completeAuthorization({ state, code: 'fresh-code', session }), { kind: 'connected' });
    assert.deepEqual(await calendar.listCalendars(), { kind: 'ok', calendars: [] });
    assert.equal(calls, 2);
    assert.notEqual((await calendar.connectionHealth()).reason, 'reauthorization_required');
    const disconnected = await schemaModel();
    try {
      source.db.exec("UPDATE calendar_connections SET status='disconnected',unhealthy_code='disconnected'");
      await restoreArchive(testPlatform(disconnected.db), await createArchive(testPlatform(source.db)));
      const row = disconnected.db.prepare('SELECT status,access_token_ciphertext,refresh_token_ciphertext,access_token_expires_at,channel_id,channel_resource_id,channel_expires_at FROM calendar_connections').get();
      assert.deepEqual(Object.values(row), ['disconnected', null, null, null, null, null, null]);
      assert.deepEqual(history(disconnected.db), healthChanges, 'a disconnected source retains the same historical facts');
    } finally { disconnected.db.close(); }
  } finally { source.db.close(); target.db.close(); }
});
contract('BASE-OPS-003', 'NOTIFY-001 confirmation choice survives restore; restored outbox, retries, deletion probes and erasure reconciliation cannot recreate historical provider effects', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    const destination = testPlatform(target.db); await restoreArchive(destination, await createArchive(testPlatform(source.db)));
    for (const table of ['event_correspondence', 'booking_correspondence']) {
      const row = target.db.prepare(`SELECT templates_json FROM ${table}`).get();
      assert.equal(JSON.parse(row.templates_json).inviteeConfirmationEnabled, false, 'NOTIFY-001: archive restores the saved confirmation choice');
      assert.equal(JSON.parse(row.templates_json).invitationManageLinkEnabled, false, 'NOTIFY-009: archive restores the saved invitation manage-link choice');
    }
    const { DeliveryRepository } = await load('../src/core/features/delivery/repository.ts');
    const { DeliveryRecovery } = await load('../src/core/features/delivery/recovery.ts');
    const { CalendarDeletionProbesRepository } = await load('../src/core/features/bookings/deletion-probes.ts');
    const { ErasureRepository } = await load('../src/core/features/erasure/repository.ts');
    const repository = new DeliveryRepository(destination.binding);
    const now = '2099-01-01T00:00:00.000Z';
    assert.deepEqual(await repository.dueIds(now, 100), []);
    assert.equal(await repository.claim('delivery_outbox-1', now), undefined);
    assert.equal(await new DeliveryRecovery(destination.binding).retry('bookings-1', 'delivery_outbox-1'), null);
    const probes = new CalendarDeletionProbesRepository(destination.binding);
    assert.deepEqual(await probes.due(now), []);
    assert.equal(await probes.retry('bookings-1', 'calendar_deletion_probes.provider_event_id', now), false);
    const before = target.db.prepare('SELECT count(*) AS n FROM delivery_outbox').get().n;
    const erased = target.db.prepare('SELECT booking_id FROM erased_calendar_targets').get().booking_id;
    await new ErasureRepository(destination.binding, 'archive-restoration-synthetic-secret').reconcileCalendarFact(erased, 'changed', now);
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM delivery_outbox').get().n, before);
    // Even an accidentally requeued state never grants archived commands authority.
    target.db.exec("UPDATE delivery_outbox SET state='pending'");
    assert.deepEqual(await repository.dueIds(now, 100), []);
    assert.equal(await repository.claim('delivery_outbox-1', now), undefined);
  } finally { source.db.close(); target.db.close(); }
});
