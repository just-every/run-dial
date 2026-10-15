import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { fixture } from './event-status-trigger/fixture.mjs';

contract('EVENT-005', 'native disable returns the changed event while its copy-invalidation trigger removes a report', async t => {
  const f = await fixture(t);
  const event = await f.create('copied-event');
  const other = await f.create('untouched-event');
  await f.json(`/api/app/event-types/${event.id}/open-requests`, { body: {} });
  const report = await f.copy(event);
  assert.equal(report.eventTypeId, event.id);
  assert.equal((await f.reports()).length, 1, 'a genuine copy-report API write is persisted before disable');
  assert.equal((await f.json('/api/app/host-setup')).steps.find(step => step.id === 'copy').done, true);
  assert.equal((await f.send('/api/public/events/status-host/copied-event')).status, 200);
  const before = await f.snapshot();
  assert.equal((await f.send(`/api/app/event-types/${event.id}/disable`, { body: {}, anonymous: true })).status, 401);
  assert.deepEqual(await f.snapshot(), before, 'an unauthenticated disable changes nothing');

  const response = await f.send(`/api/app/event-types/${event.id}/disable`, { body: {} });
  const persisted = await f.json(`/api/app/event-types/${event.id}`);
  assert.equal(persisted.status, 'disabled', 'the target mutation persisted even if a trigger inflated D1 changes');
  assert.deepEqual(await f.reports(), [], 'the same statement invalidates the persisted copy');
  assert.deepEqual(await f.json(`/api/app/event-types/${other.id}`), other, 'the other event is untouched');
  assert.equal(response.status, 200, 'successful native mutation must not be reported as event_not_found');
  assert.deepEqual(await response.json(), persisted, 'response identifies the exact persisted target');

  const repeated = await f.json(`/api/app/event-types/${event.id}/disable`, { body: {} });
  assert.equal(repeated.id, event.id); assert.equal(repeated.status, 'disabled');
  assert.deepEqual(await f.reports(), []);
  const overview = await f.json('/api/app/host-setup');
  assert.equal(overview.steps.find(step => step.id === 'copy').done, false);
  assert.equal(overview.steps.find(step => step.id === 'publication').done, false);
  assert.deepEqual(overview.links, []);
  for (const path of ['/api/public/events/status-host/copied-event', '/api/public/book/status-host/copied-event/availability?week=2030-01-01']) {
    assert.equal((await f.send(path)).status, 404, `${path} is unavailable after disable`);
  }
  const composition = { inviteeName: 'Invitee', inviteeEmail: 'invitee@dial.test', inviteeTimezone: 'UTC', note: '', windows: [{ date: '2030-01-01', startMinute: 600, endMinute: 660 }] };
  assert.equal((await f.send('/api/public/events/status-host/copied-event/request/review', { body: composition })).status, 404);
  assert.equal((await f.send('/api/public/book/status-host/copied-event/selection', { body: { startAt: '2030-01-01T10:00:00Z', inviteeTimezone: 'UTC' } })).status, 404);
  const after = await f.snapshot();
  const missing = await f.json('/api/app/event-types/00000000000000000000000000/disable', { body: {} }, 404);
  assert.equal(missing.error.code, 'event_not_found');
  assert.deepEqual(await f.snapshot(), after, 'a missing ID mutates no product record');
});
