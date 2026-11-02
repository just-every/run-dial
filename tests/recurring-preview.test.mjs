import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contract } from './contract.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';

const input = {
  slug: 'synthetic-dial-weekly', title: 'Weekly consultation', description: 'Synthetic weekly availability.',
  durationMinutes: 30, color: '#176b5a', locationType: 'in_person', locationLabel: 'Office', locationValue: 'Synthetic room',
  listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0,
  bookingHorizonDays: 365, beforeBufferMinutes: 15, afterBufferMinutes: 15, hostDayBookingLimit: null,
  questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 720 })),
};
const proposal = { startAt: '2030-02-25T15:00:00.000Z', inviteeTimezone: 'America/New_York', count: 6 };
const starts = ['2030-02-25T15:00:00.000Z', '2030-03-04T15:00:00.000Z', '2030-03-11T14:00:00.000Z', '2030-03-18T14:00:00.000Z', '2030-03-25T14:00:00.000Z', '2030-04-01T14:00:00.000Z'];
const baseOf = event => `/api/public/book/dial-host/${event.slug}`;

async function runtime(context) {
  const directory = await mkdtemp(join(tmpdir(), 'dial-recurring-clock-'));
  const workerEntry = join(directory, 'worker.ts');
  // Pin the actual Worker clock, including native sessions and availability.
  await writeFile(workerEntry, `
    const NativeDate = Date, fixed = NativeDate.parse('2030-02-18T12:00:00.000Z');
    globalThis.Date = class extends NativeDate {
      constructor(...values) { super(...(values.length ? values : [fixed])); }
      static now() { return fixed; }
    };
    export { default, BookingCoordinator } from ${JSON.stringify(new URL('./move-in/booking-worker.ts', import.meta.url).pathname)};
  `);
  context.after(() => rm(directory, { recursive: true, force: true }));
  const rt = await bookingRuntime({ workerEntry });
  context.after(() => rt.close());
  await rt.data('/__fixtures/setup', {});
  const profile = await rt.data('/api/app/profile');
  await rt.data('/api/app/profile', { ...profile, timezone: 'America/New_York' }, 200, 'PATCH');
  const disconnected = await rt.api('/api/app/calendar/connection', { method: 'DELETE' });
  assert.equal(disconnected.status, 204); await disconnected.arrayBuffer();
  rt.public = async (path, body, expected = 200) => {
    const response = await rt.api(path, { headers: { cookie: '', 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    assert.equal(response.status, expected, `native public door: ${response.status}, expected ${expected}`);
    if (path.includes('/recurring-preview')) assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return response.json();
  };
  rt.preview = (event, values = proposal, expected = 200) => rt.public(`${baseOf(event)}/recurring-preview?${new URLSearchParams(values)}`, undefined, expected);
  rt.create = async (overrides = {}, publish = true) => {
    const event = await rt.data('/api/app/event-types', { ...input, ...overrides }, 201);
    if (publish) await rt.data(`/api/app/event-types/${event.id}/publish`, {});
    return event;
  };
  rt.book = async (event, startAt, number) => {
    const selected = await rt.public(`${baseOf(event)}/selection`, { startAt, inviteeTimezone: proposal.inviteeTimezone }, 201);
    return rt.public(`${baseOf(event)}/confirm`, { nonce: selected.nonce, startAt, inviteeTimezone: proposal.inviteeTimezone, name: `Synthetic person ${number}`, email: [`synthetic-dial-${number}`, 'example.test'].join('@'), answers: {} }, 201);
  };
  return rt;
}

async function snapshot(rt) {
  const contents = [];
  for (const database of [rt.db, rt.providerDb]) {
    const tables = (await database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
    for (const { name } of tables) contents.push([name, (await database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()).results]);
  }
  contents.push(await rt.data('/__queue-count'));
  return createHash('sha256').update(JSON.stringify(contents)).digest('hex');
}

function onlyTimes(preview, count) {
  assert.deepEqual(Object.keys(preview), ['occurrences']);
  assert.equal(preview.occurrences.length, count);
  for (const occurrence of preview.occurrences) {
    assert.deepEqual(Object.keys(occurrence).sort(), ['alternatives', 'available', 'proposed']);
    assert.equal(typeof occurrence.available, 'boolean');
    assert.ok(occurrence.alternatives.length <= 3);
    for (const time of [occurrence.proposed, ...occurrence.alternatives]) {
      assert.deepEqual(Object.keys(time).sort(), ['endAt', 'startAt']);
      assert.equal(Date.parse(time.endAt) - Date.parse(time.startAt), 30 * 60_000);
    }
  }
}

contract('EVENT-010', 'weekly public preview offers fresh alternates without booking authority or side effects', async context => {
  const rt = await runtime(context), event = await rt.create();
  const control = await rt.book(event, '2030-02-26T16:00:00.000Z', 901);
  const blocked = await rt.book(event, starts[2], 902);
  await rt.data('/__fixtures/deliver', {});
  const before = await snapshot(rt);
  const preview = await rt.preview(event);
  onlyTimes(preview, 6);
  assert.deepEqual(preview.occurrences.map(row => row.proposed.startAt), starts, 'weekly wall time survives the spring offset change');
  assert.deepEqual(preview.occurrences.map(row => row.available), [true, true, false, true, true, true]);
  const alternatives = preview.occurrences[2].alternatives;
  assert.ok(alternatives.length > 0);
  const ordinary = await rt.public(`${baseOf(event)}/availability?week=2030-03-11`);
  for (const alternative of alternatives) assert.ok(ordinary.slots.some(slot => slot.startAt === alternative.startAt && slot.endAt === alternative.endAt), 'an alternate is also an ordinary public offer with buffers applied');
  for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(await rt.preview(event), preview);
  assert.equal(await snapshot(rt), before, 'previews change no table, nonce, hold, history, delivery, queue or provider call');
  const freshBooking = await rt.book(event, alternatives[0].startAt, 903);
  await rt.data('/__fixtures/deliver', {});
  const occupied = await snapshot(rt);
  const refreshed = await rt.preview(event);
  assert.equal(refreshed.occurrences[2].available, false);
  assert.equal(refreshed.occurrences[2].alternatives.some(slot => slot.startAt === alternatives[0].startAt), false, 'a newly occupied alternate disappears immediately');
  for (const alternative of refreshed.occurrences[2].alternatives) assert.ok((await rt.public(`${baseOf(event)}/availability?week=2030-03-11`)).slots.some(slot => slot.startAt === alternative.startAt));
  assert.equal(await snapshot(rt), occupied);
  const controlToken = new URL(control.manageUrl).pathname.split('/').at(-1);
  assert.equal((await rt.public(`/api/public/manage/${controlToken}`)).bookingReference, control.bookingReference);
  assert.equal((await rt.data(`/api/app/bookings/${blocked.bookingReference}`)).occurrence.startAt, starts[2]);
  assert.equal((await rt.data(`/api/app/bookings/${freshBooking.bookingReference}`)).occurrence.startAt, alternatives[0].startAt);
  const noAuthority = await snapshot(rt);
  const refused = await rt.public(`${baseOf(event)}/confirm`, { startAt: starts[0], inviteeTimezone: proposal.inviteeTimezone, name: 'Synthetic preview', email: ['synthetic-dial-904', 'example.test'].join('@'), answers: {} }, 404);
  assert.equal(refused.error.code, 'booking_nonce_not_found');
  assert.equal(await snapshot(rt), noAuthority, 'proposed times alone cannot confirm a booking');
  context.diagnostic('PROBE EVENT-010 weekly availability: sessionless GET recurring-preview for six weeks -> five available originals, blocked third week, ordinary public alternates; newly occupied alternate removed on next read.');
  context.diagnostic('PROBE EVENT-010 read-only authority: repeated sessionless previews -> all database, queue and provider snapshots unchanged; ordinary control bookings retained; confirmation without a nonce refused.');
});

contract('EVENT-010', 'weekly preview bounds proposals and refuses hidden events and unsupported configurations without writes', async context => {
  const rt = await runtime(context), event = await rt.create();
  const before = await snapshot(rt);
  for (const count of [2, 24]) onlyTimes(await rt.preview(event, { ...proposal, count }), count);
  for (const values of [
    { count: 1 }, { count: 25 }, { count: 0 }, { count: -2 }, { count: 2.5 }, { count: 'invalid' },
    { startAt: 'not-a-time' }, { startAt: '2030-02-30T15:00:00Z' }, { startAt: '2030-02-25T15:00:01Z' },
    { startAt: '2030-02-25T15:00:00.0001Z' }, { startAt: '2030-02-25T15:00:00' }, { inviteeTimezone: 'not-a-zone' },
    { frequency: 'monthly' }, { link: 'synthetic-dial-restricted' }, { count: '' },
  ]) assert.equal((await rt.preview(event, { ...proposal, ...values }, 400)).error.code, 'invalid_request');
  assert.equal((await rt.preview(event, { startAt: proposal.startAt, inviteeTimezone: proposal.inviteeTimezone }, 400)).error.code, 'invalid_request');
  assert.equal((await rt.preview(event, { ...proposal, startAt: '2030-03-03T07:30:00.000Z', count: 2 }, 400)).error.code, 'invalid_weekly_time', 'a weekly proposal cannot silently shift a nonexistent spring-forward time');
  const unknown = { slug: 'synthetic-dial-unknown' };
  const absent = await rt.preview(unknown, proposal, 404);
  assert.equal(absent.error.code, 'event_not_available');
  const wrongHandle = await rt.public(`${baseOf(event).replace('dial-host', 'synthetic-dial-unknown')}/recurring-preview?${new URLSearchParams(proposal)}`, undefined, 404);
  assert.deepEqual(wrongHandle, absent);
  assert.equal(await snapshot(rt), before, 'bounded successful reads and invalid input all change nothing');
  const draft = await rt.create({ slug: 'synthetic-dial-draft' }, false);
  const disabled = await rt.create({ slug: 'synthetic-dial-disabled' });
  await rt.data(`/api/app/event-types/${disabled.id}/disable`, {});
  const hiddenBefore = await snapshot(rt);
  for (const hidden of [draft, disabled]) assert.deepEqual(await rt.preview(hidden, proposal, 404), absent);
  assert.equal(await snapshot(rt), hiddenBefore, 'draft and disabled events disclose the same response as unknown events');

  // Each shape is exercised through native configuration and its public read door.
  for (const [number, overrides, settings] of [
    [1, { groupCapacity: 3 }],
    [2, { durationOptionsMinutes: [30, 60] }],
    [3, { locations: [{ id: 'one', type: 'in_person', label: 'Office', value: 'Synthetic room' }, { id: 'two', type: 'phone', label: 'Phone', value: '+12025550123' }] }],
    [4, { locationType: 'invitee_phone', locationValue: '' }],
    [5, {}, ['approval', { required: true, windowHours: 24 }]],
    [6, {}, ['guests', { guestLimit: 1 }]],
    [7, {}, ['price', { amountCents: 500, durationPrices: [] }]],
    [8, {}, ['payment-terms', { deposit: { kind: 'none' }, balanceDueHours: 24, freeWindowHours: 24, lateCancelFeeCents: 500, noShowFeeCents: 0 }]],
  ]) {
    const unsupported = await rt.create({ slug: `synthetic-dial-unsupported-${number}`, ...overrides });
    if (settings) await rt.data(`/api/app/event-types/${unsupported.id}/${settings[0]}`, settings[1], 200, 'PUT');
    const unchanged = await snapshot(rt);
    assert.equal((await rt.preview(unsupported, proposal, 409)).error.code, 'recurring_preview_unsupported');
    assert.equal(await snapshot(rt), unchanged, 'unsupported combinations refuse before any effect');
  }
  const teamEvent = await rt.create({ slug: 'synthetic-dial-team' });
  await rt.data('/api/app/teams', { name: 'Synthetic team', eventTypeIds: [teamEvent.id] }, 201);
  const teamBefore = await snapshot(rt);
  assert.equal((await rt.preview(teamEvent, proposal, 409)).error.code, 'recurring_preview_unsupported');
  assert.equal(await snapshot(rt), teamBefore);
  const requestOnly = await rt.create({ slug: 'synthetic-dial-request-only', alternativeRequestsEnabled: true }, false);
  await rt.data(`/api/app/event-types/${requestOnly.id}/open-requests`, {});
  const requestBefore = await snapshot(rt);
  assert.equal((await rt.preview(requestOnly, proposal, 409)).error.code, 'recurring_preview_unsupported');
  assert.equal(await snapshot(rt), requestBefore);
  await rt.data('/__fixtures/setup', {});
  const connected = await snapshot(rt);
  assert.equal((await rt.preview(event, proposal, 409)).error.code, 'recurring_preview_unsupported');
  assert.equal(await snapshot(rt), connected, 'connected calendars refuse without contacting a provider');
  context.diagnostic('PROBE EVENT-010 bounds and privacy: sessionless native GET -> counts 2 and 24 accepted; invalid counts, malformed times, restricted links and unsupported modes refused; hidden events return identical 404.');
  context.diagnostic('PROBE EVENT-010 supported scope: native group, variable duration or location, invitee phone, approval, guests, price, fee, team and connected-calendar fixtures -> explicit 409 and no database, queue or provider change.');
});
