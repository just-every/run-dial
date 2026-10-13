import { createArchive } from './archive/artifact.mjs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { contract } from './contract.mjs';
import { fixture, testPlatform } from './archive/fixture.mjs';
import { schemaModel } from '../scripts/archive/schema.mjs';
import { restoreArchive } from './archive/artifact.mjs';
async function load(path) {
  const result = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n//# sourceURL=dial-test-bundle:${path}\n`).toString('base64')}`);
}
contract('CAL-006', 'restored Calendar shows reauthorization and cached public availability fails closed until an actual reconnect', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    const destination = testPlatform(target.db); await restoreArchive(destination, await createArchive(testPlatform(source.db)));
    const { CalendarConnectionService } = await load('../src/core/features/calendar-connection/service.ts');
    const { CalendarConnectionRepository } = await load('../src/core/features/calendar-connection/repository.ts');
    let calls = 0;
    const adapter = {
      authorizationUrl(_url, state) { return `https://provider.example.test/authorize?state=${encodeURIComponent(state)}`; },
      async exchangeAuthorizationCode() { calls++; return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: '2099-01-01T00:00:00.000Z' }; },
      async listCalendars() { calls++; return []; },
    };
    const runtime = { APP_URL: 'https://dial.example.test', SESSION_SECRET: 'fresh-session-secret-at-least-32-chars', GOOGLE_OAUTH_CLIENT_ID: 'fixture-client', GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-secret', CALENDAR_WEBHOOK_SECRET: 'fixture-webhook' };
    const calendar = new CalendarConnectionService(new CalendarConnectionRepository(destination.binding), runtime, adapter);
    assert.equal((await calendar.connectionHealth()).reason, 'reauthorization_required');
    assert.deepEqual(await calendar.checkConnection(), { kind: 'unavailable', code: 'reauthorization_required' });
    assert.deepEqual(await calendar.readBusy({ startAt: '2026-10-07T00:00:00.000Z', endAt: '2026-10-07T01:00:00.000Z', freshness: 'cached' }), { kind: 'unavailable', code: 'reauthorization_required' });
    assert.equal(calls, 0);
    const session = { id: 'owner', sessionId: 'new-session' };
    const authorization = await calendar.beginAuthorization(session); assert.ok(authorization);
    const state = new URL(authorization).searchParams.get('state');
    assert.deepEqual(await calendar.completeAuthorization({ state, code: 'fresh-code', session }), { kind: 'connected' });
    assert.deepEqual(await calendar.listCalendars(), { kind: 'ok', calendars: [] });
    assert.equal(calls, 2);
    assert.notEqual((await calendar.connectionHealth()).reason, 'reauthorization_required');
  } finally { source.db.close(); target.db.close(); }
});
contract('BASE-OPS-003', 'restored outbox, retries, deletion probes and erasure reconciliation cannot recreate historical provider effects', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    const destination = testPlatform(target.db); await restoreArchive(destination, await createArchive(testPlatform(source.db)));
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
