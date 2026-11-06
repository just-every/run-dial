import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { evidencePath } from '../../scripts/evidence-path.mjs';
import { bookingMail, recipient } from './mail-contracts.mjs';

const origin = process.env.DIAL_REVIEW_ORIGIN;
let cookie;
async function call(path, body, expected = 200, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + path, {
    method, redirect: 'manual',
    headers: { origin, 'content-type': ['application', 'json'].join('/'), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, `${method} ${path.replace(/\/manage\/[^/?]+/gu, '/manage/[redacted]')}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const state = () => data('/wire/state');
const control = (name, value) => data('/wire/control', { name, value });
const deliver = id => data('/__fixtures/deliver', { id });
const due = id => call('/__fixtures/due', { id }, 204);
const eventFor = (snapshot, id) => JSON.parse(snapshot.wire_events.find(row => row.id === id).payload);
const eventsFor = (snapshot, id) => snapshot.wire_events.map(row => JSON.parse(row.payload)).filter(event => event.extendedProperties.private['dial-booking-id'] === id);
const active = (snapshot, id) => eventsFor(snapshot, id).filter(event => event.status !== 'cancelled');
const writes = snapshot => snapshot.wire_calls.filter(row => new URL(row.url).hostname === 'www.googleapis.com' && ['POST', 'PATCH', 'DELETE'].includes(row.method) && /\/events(?:\/[^/]+)?$/u.test(new URL(row.url).pathname));
const checks = [];
const boot = await call('/auth/bootstrap', { token: 'dial-test-only-setup-token-at-least-32', displayName: 'Synthetic Dial Owner', returnTo: '/app' }, 303);
cookie = boot.headers.get('set-cookie').split(';')[0];
await call('/api/app/profile', { handle: 'duplicate-host', name: 'Synthetic Host', title: 'Advisor', biography: 'Synthetic appointments.', timezone: 'UTC', focusAreas: [], socialProof: [] }, 200, 'PATCH');
const auth = new URL((await call('/api/app/calendar/oauth/start', undefined, 302)).headers.get('location'));
await call('/api/calendar/oauth/callback?' + new URLSearchParams({ state: auth.searchParams.get('state'), code: 'wire-consent' }), undefined, 302);
await data('/api/app/calendar/selection', { destinationCalendarId: 'synthetic-calendar', conflictCalendarIds: ['synthetic-calendar'] }, 200, 'PUT');
await data('/api/app/calendar/check', {});
await data('/api/app/mail/check', {});
const event = await data('/api/app/event-types', {
  slug: 'owned-duplicate', title: 'Synthetic studio visit', description: 'A fixed-location appointment.', durationMinutes: 30,
  color: '#176b5a', locationType: 'in_person', locationLabel: 'Studio', locationValue: 'Room 4', listed: true,
  alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
  beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null,
  questions: [{ kind: 'text', label: 'Visit goal', required: true, private: false, options: [] }, { kind: 'text', label: 'Private note', required: true, private: true, options: [] }],
  hours: { uses: 'own', windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })) },
}, 201);
await data(`/api/app/event-types/${event.id}/publish`, {});
const base = '/api/public/book/duplicate-host/owned-duplicate';
const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
let index = 1800;
async function book({ interrupted = true, emptyListing = false } = {}) {
  assert.equal((await data('/api/app/calendar/check', {})).kind, 'healthy');
  const email = [`synthetic-dial-${++index}`, 'example.test'].join('@');
  const availability = await data(`${base}/availability?week=${future}`);
  const slot = availability.slots[0]; assert.ok(slot, `available public slot: ${JSON.stringify(availability)}`);
  const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: 'UTC' }, 201);
  const input = { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: 'UTC', name: 'Synthetic Invitee', email,
    answers: { [event.questions[0].key]: 'A studio visit', [event.questions[1].key]: 'synthetic-dial-private-note' } };
  const receipt = await data(`${base}/confirm`, input, 201);
  await call(`${base}/confirm`, input, 200);
  let snapshot = await state();
  const booking = snapshot.bookings.find(row => row.id === receipt.bookingReference);
  const command = snapshot.delivery_outbox.find(row => row.booking_id === booking.id && row.kind === 'calendar_upsert');
  if (emptyListing) await control(`google-list-mode:${booking.id}`, 'empty-once');
  if (interrupted) await control('google-lost-response', 1);
  await deliver(command.id);
  snapshot = await state();
  const canonical = active(snapshot, booking.id)[0]; assert.ok(canonical);
  assert.equal(canonical.id, createHash('sha256').update(`dial-booking:${booking.id}`).digest('hex'));
  if (interrupted) {
    assert.equal(snapshot.delivery_outbox.find(row => row.id === command.id).state, 'pending');
    assert.equal(snapshot.bookings.find(row => row.id === booking.id).calendar_state, 'pending');
  }
  const manage = `/api/public/manage/${new URL(receipt.manageUrl).pathname.split('/').at(-1)}`;
  return { booking, command, canonical, manage, email, receipt, input };
}
async function pair() {
  const fixture = await book();
  const extra = { ...structuredClone(fixture.canonical), id: `deadbeef${index}`, etag: `"synthetic-dial-${index}"` };
  await data('/wire/event', { id: extra.id, payload: extra });
  return { ...fixture, extra };
}
function authority(snapshot, id) {
  return {
    occurrence: snapshot.booking_occurrences.filter(row => row.booking_id === id),
    answers: snapshot.booking_answers.filter(row => row.booking_id === id),
    manage: snapshot.booking_manage_tokens.filter(row => row.booking_id === id),
    history: snapshot.booking_history.filter(row => row.booking_id === id),
    identity: snapshot.bookings.filter(row => row.id === id).map(row => [row.id, row.event_type_id, row.current_occurrence_id, row.ical_uid, row.invitee_email, row.location_value]),
  };
}
const untouched = await book({ interrupted: false, emptyListing: true });
const controlSnapshot = await state();
assert.equal(controlSnapshot.bookings.find(row => row.id === untouched.booking.id).calendar_state, 'succeeded', 'an empty Google list without an items field still admits an ordinary booking');
const controlRows = snapshot => ({ authority: authority(snapshot, untouched.booking.id), booking: snapshot.bookings.find(row => row.id === untouched.booking.id), provider: eventsFor(snapshot, untouched.booking.id) });

for (const lost of [false, true]) {
  const fixture = await pair();
  if (lost) await control(`google-recovery-delete-lost:${fixture.extra.id}`, 1);
  const before = await state(), beforeAuthority = authority(before, fixture.booking.id), callCount = before.wire_calls.length;
  await due(fixture.command.id); await deliver(fixture.command.id);
  let snapshot = await state();
  assert.deepEqual(active(snapshot, fixture.booking.id).map(row => row.id), [fixture.canonical.id], 'only the deterministic canonical event stays active');
  assert.equal(eventFor(snapshot, fixture.extra.id).status, 'cancelled');
  const deletes = writes(snapshot).filter(row => row.method === 'DELETE' && new URL(row.url).pathname.endsWith('/' + fixture.extra.id));
  assert.equal(deletes.length, 1);
  assert.equal(JSON.parse(deletes[0].headers)['if-match'], fixture.extra.etag);
  assert.equal(new URL(deletes[0].url).searchParams.get('sendUpdates'), 'none', 'cleanup sends no extra provider notice');
  const recoveryCalls = snapshot.wire_calls.slice(callCount);
  for (const member of [fixture.canonical, fixture.extra]) {
    const read = recoveryCalls.find(row => row.method === 'GET' && new URL(row.url).pathname.endsWith('/' + member.id));
    assert.ok(read, 'both events are freshly read before deleting either');
    assert.equal(JSON.parse(read.headers)['if-match'], member.etag);
    assert.ok(read.id < deletes[0].id);
  }
  if (lost) {
    assert.equal(snapshot.delivery_outbox.find(row => row.id === fixture.command.id).state, 'pending', 'lost cleanup response is not completion proof');
    assert.equal(snapshot.bookings.find(row => row.id === fixture.booking.id).calendar_state, 'pending');
    await due(fixture.command.id); await deliver(fixture.command.id);
    snapshot = await state();
    assert.deepEqual(writes(snapshot).slice(writes(before).length).map(row => row.method), ['DELETE'], 'a lost cleanup response recovers by reading provider state without sending another invitation');
    assert.deepEqual(eventFor(snapshot, fixture.canonical.id), fixture.canonical, 'a lost cleanup response never rewrites the surviving canonical event');
  } else {
    const afterDelete = recoveryCalls.filter(row => row.id > deletes[0].id);
    assert.ok(afterDelete.some(row => row.method === 'GET' && new URL(row.url).searchParams.get('privateExtendedProperty') === `dial-booking-id=${fixture.booking.id}`), 'delivery verifies an exhaustive post-cleanup provider list');
    assert.ok(afterDelete.some(row => new URL(row.url).pathname.endsWith('/' + fixture.canonical.id)), 'the surviving event is re-read');
    assert.deepEqual(eventFor(snapshot, fixture.canonical.id), fixture.canonical, 'cleanup never patches the canonical event');
  }
  const completed = snapshot.bookings.find(row => row.id === fixture.booking.id);
  assert.equal(completed.calendar_provider_event_id, fixture.canonical.id);
  assert.equal(completed.calendar_state, 'succeeded');
  assert.equal(snapshot.delivery_outbox.find(row => row.id === fixture.command.id).state, 'succeeded');
  assert.deepEqual(authority(snapshot, fixture.booking.id), beforeAuthority, 'booking, occurrence, UID, answers, history and manage authority are unchanged');
  assert.equal((await data(fixture.manage)).occurrence.startAt, fixture.input.startAt);
  const confirmations = snapshot.delivery_outbox.filter(row => row.booking_id === fixture.booking.id && row.kind === 'mail_send');
  for (const mail of confirmations) await deliver(mail.id);
  snapshot = await state();
  const inviteeConfirmations = bookingMail(snapshot, fixture.booking.id).filter(mail => recipient(mail).includes(fixture.email));
  assert.equal(inviteeConfirmations.length, 1);
  const replay = await state();
  await call(`${base}/confirm`, fixture.input, 200);
  for (const command of [fixture.command, ...confirmations]) { await deliver(command.id); await deliver(command.id); }
  const repeated = await state();
  assert.deepEqual(repeated.wire_calls, replay.wire_calls, 'public nonce and Queue replay add no event or confirmation');
  assert.deepEqual(repeated.wire_events, replay.wire_events);
  assert.deepEqual(controlRows(repeated), controlRows(controlSnapshot));
  checks.push(`PROBE AGENT-004 owned duplicate${lost ? ' with cleanup response loss' : ''}: native booking and current delivery -> extra removed, canonical verified, original authority retained and replay inert`);
}

// A filtered list cannot prove that a previously identified extra was removed:
// an external marker edit can hide the still-active event after a transport loss.
for (const mode of ['missing marker', 'foreign marker']) {
  const fixture = await pair();
  await control(`google-recovery-delete-interrupted:${fixture.extra.id}`, 1);
  await due(fixture.command.id); await deliver(fixture.command.id);
  const interrupted = await state();
  assert.equal(interrupted.delivery_outbox.find(row => row.id === fixture.command.id).state, 'pending');
  assert.equal(eventFor(interrupted, fixture.extra.id).status, 'confirmed');
  const changed = structuredClone(fixture.extra);
  if (mode === 'missing marker') delete changed.extendedProperties.private['dial-booking-id'];
  else changed.extendedProperties.private['dial-booking-id'] = untouched.booking.id;
  changed.etag = '"synthetic-dial-extra-edited"';
  await data('/wire/event', { id: changed.id, payload: changed });
  const before = await state(), beforeAuthority = authority(before, fixture.booking.id);
  await due(fixture.command.id); await deliver(fixture.command.id);
  const after = await state();
  assert.notEqual(after.bookings.find(row => row.id === fixture.booking.id).calendar_state, 'succeeded', `${mode}: a hidden active extra is not completed cleanup`);
  assert.notEqual(after.delivery_outbox.find(row => row.id === fixture.command.id).state, 'succeeded');
  assert.deepEqual(writes(after), writes(before), `${mode}: ambiguous recovery changes neither provider event`);
  assert.deepEqual(eventFor(after, fixture.extra.id), changed);
  assert.deepEqual(eventFor(after, fixture.canonical.id), fixture.canonical);
  assert.deepEqual(authority(after, fixture.booking.id), beforeAuthority);
  assert.deepEqual(authority(after, untouched.booking.id), authority(controlSnapshot, untouched.booking.id));
  assert.deepEqual(after.bookings.find(row => row.id === untouched.booking.id), controlRows(controlSnapshot).booking);
  const extraRead = after.wire_calls.slice(before.wire_calls.length).find(row => row.method === 'GET' && new URL(row.url).pathname.endsWith('/' + fixture.extra.id));
  assert.ok(extraRead, 'the recorded extra is read even after its marker hides it from the list');
  assert.equal(JSON.parse(extraRead.headers)['if-match'], undefined, 'absence verification does not require the deleted revision');
  const calls = after.wire_calls;
  await deliver(fixture.command.id); await deliver(fixture.command.id);
  assert.deepEqual((await state()).wire_calls, calls, 'refused recovery stays inert on Queue replay');
  checks.push(`PROBE AGENT-004 uncertain cleanup and ${mode}: native delivery retry -> hidden extra read by recorded ID, completion refused and both events unchanged`);
  // Restore the synthetic marker so later control snapshots see only their own events.
  await data('/wire/event', { id: fixture.extra.id, payload: fixture.extra });
}

// Google can expose a deleted event as a changed-revision tombstone or absence.
for (const mode of ['tombstone', '404', '410', 'unavailable']) {
  const fixture = await pair();
  await control(`google-recovery-delete-lost:${fixture.extra.id}`, 1);
  await due(fixture.command.id); await deliver(fixture.command.id);
  if (mode === 'tombstone') await data('/wire/event', { id: fixture.extra.id, payload: { ...fixture.extra, status: 'cancelled', etag: '"synthetic-dial-deleted-revision"' } });
  else await control(`google-get-status:${fixture.extra.id}`, mode === 'unavailable' ? 503 : Number(mode));
  const before = await state(), beforeAuthority = authority(before, fixture.booking.id);
  await due(fixture.command.id); await deliver(fixture.command.id);
  let after = await state();
  if (mode === 'unavailable') {
    assert.equal(after.delivery_outbox.find(row => row.id === fixture.command.id).state, 'pending', 'an unavailable deletion check is not completion proof');
    assert.equal(after.bookings.find(row => row.id === fixture.booking.id).calendar_state, 'pending');
    await control(`google-get-status:${fixture.extra.id}`, 0);
    await due(fixture.command.id); await deliver(fixture.command.id);
    after = await state();
  }
  assert.equal(after.delivery_outbox.find(row => row.id === fixture.command.id).state, 'succeeded');
  assert.equal(after.bookings.find(row => row.id === fixture.booking.id).calendar_provider_event_id, fixture.canonical.id);
  assert.equal(after.bookings.find(row => row.id === fixture.booking.id).calendar_state, 'succeeded');
  assert.deepEqual(writes(after), writes(before), 'confirming deletion adds no provider write');
  assert.deepEqual(eventFor(after, fixture.canonical.id), fixture.canonical);
  assert.deepEqual(authority(after, fixture.booking.id), beforeAuthority);
  assert.deepEqual(controlRows(after), controlRows(controlSnapshot));
  checks.push(`PROBE AGENT-004 removed extra ${mode}: native delivery retry -> deletion verified before completion, canonical and authority unchanged`);
}

// Cleanup may have committed even though delivery is still pending. A later
// retry cannot overwrite changed provider facts or reuse expired command authority.
for (const mode of ['facts', 'supersede', 'archive', 'claim', 'pagination', 'supersede-before-list', 'archive-before-list', 'claim-before-list', 'command-before-list', 'identity-before-list', 'etag-before-list', 'missing-before-list']) {
  const fixture = await pair();
  await control(`google-recovery-delete-lost:${fixture.extra.id}`, 1);
  await due(fixture.command.id); await deliver(fixture.command.id);
  const removed = await state();
  assert.equal(active(removed, fixture.booking.id).length, 1);
  assert.equal(removed.delivery_outbox.find(row => row.id === fixture.command.id).state, 'pending');
  if (['command-before-list', 'identity-before-list', 'etag-before-list', 'missing-before-list'].includes(mode)) {
    const survivor = structuredClone(fixture.canonical);
    if (mode === 'command-before-list') survivor.extendedProperties.private['dial-idempotency-key'] = 'synthetic-dial-changed-command';
    if (mode === 'identity-before-list') delete survivor.extendedProperties.private['dial-booking-id'];
    if (mode === 'etag-before-list') survivor.etag = '"synthetic-dial-new-revision"';
    await data('/wire/event', { id: survivor.id, ...(mode === 'missing-before-list' ? { remove: true } : { payload: survivor }) });
  } else if (mode.endsWith('-before-list')) await control(`google-recovery-before-list:${fixture.booking.id}`, mode.split('-')[0]);
  else if (mode === 'pagination') await control(`google-list-mode:${fixture.booking.id}`, 'paginated');
  else await control(`google-recovery-read:${fixture.canonical.id}`, mode);
  const before = await state(), beforeAuthority = authority(before, fixture.booking.id);
  await due(fixture.command.id); await deliver(fixture.command.id);
  const after = await state();
  assert.notEqual(after.bookings.find(row => row.id === fixture.booking.id).calendar_state, 'succeeded', `${mode}: uncertain cleanup recovery is not completion`);
  assert.deepEqual(writes(after).map(row => [row.id, row.method]), writes(before).map(row => [row.id, row.method]), `${mode}: cleanup recovery never writes the canonical event`);
  assert.deepEqual(authority(after, fixture.booking.id), beforeAuthority);
  assert.deepEqual(controlRows(after), controlRows(controlSnapshot));
  if (mode.startsWith('archive')) {
    const calls = after.wire_calls;
    await due(fixture.command.id); await deliver(fixture.command.id);
    assert.deepEqual((await state()).wire_calls, calls, 'archived cleanup recovery stays inert on queue replay');
  }
  checks.push(`PROBE AGENT-004 cleanup response loss and ${mode}: native delivery retry -> refused without canonical writes or authority changes`);
}

const scenarios = [
  ['occurrence marker', extra => { extra.extendedProperties.private['dial-occurrence-id'] = 'synthetic-dial-other'; }],
  ['command marker', extra => { extra.extendedProperties.private['dial-idempotency-key'] = 'synthetic-dial-other'; }],
  ['UID marker', extra => { extra.extendedProperties.private['dial-ical-uid'] = 'synthetic-dial-other'; }],
  ['missing identity', extra => { delete extra.extendedProperties.private['dial-booking-id']; }, 'foreign'],
  ['changed title', extra => { extra.summary = 'Changed outside Dial'; }],
  ['changed canonical facts', () => {}, 'canonical-facts'],
  ['changed description', extra => { extra.description = 'Changed outside Dial'; }],
  ['changed location', extra => { extra.location = 'Another room'; }],
  ['changed time', extra => { extra.start.dateTime = new Date(Date.parse(extra.start.dateTime) + 60000).toISOString(); }],
  ['changed attendee', extra => { extra.attendees[0].email = ['synthetic-dial-other', 'example.test'].join('@'); }],
  ['conference', extra => { extra.conferenceData = { createRequest: {} }; }],
  ['missing ETag', extra => { delete extra.etag; }],
  ['extra candidate', () => {}, 'third'],
  ['pagination', () => {}, 'pagination'],
  ['missing deterministic canonical', () => {}, 'canonical'],
  ['fresh changed facts', () => {}, 'facts'],
  ['canonical read ETag conflict', () => {}, 'canonical-etag'],
  ['extra read ETag conflict', () => {}, 'extra-etag'],
  ['delete ETag conflict', () => {}, 'etag'],
  ['superseded command', () => {}, 'supersede'],
  ['archived command', () => {}, 'archive'],
  ['reclaimed command', () => {}, 'claim'],
];
for (const [label, mutate, mode] of scenarios) {
  console.log(`Checking refusal: ${label}`);
  const fixture = await pair();
  mutate(fixture.extra);
  await data('/wire/event', { id: fixture.extra.id, payload: fixture.extra });
  if (mode === 'canonical-facts') {
    fixture.canonical.summary = 'Canonical changed outside Dial';
    await data('/wire/event', { id: fixture.canonical.id, payload: fixture.canonical });
  }
  if (mode === 'foreign') await control(`google-list-mode:${fixture.booking.id}`, `include:${fixture.extra.id}`);
  if (mode === 'third') await data('/wire/event', { id: `cafebeef${index}`, payload: { ...fixture.extra, id: `cafebeef${index}` } });
  if (mode === 'pagination') await control(`google-list-mode:${fixture.booking.id}`, 'paginated');
  if (mode === 'canonical') {
    await data('/wire/event', { id: fixture.canonical.id, remove: true });
    await data('/wire/event', { id: `feedbeef${index}`, payload: { ...fixture.canonical, id: `feedbeef${index}` } });
  }
  if (['facts', 'supersede', 'archive', 'claim'].includes(mode)) await control(`google-recovery-read:${fixture.extra.id}`, mode);
  if (['canonical-etag', 'extra-etag'].includes(mode)) await control(`google-recovery-read:${mode === 'canonical-etag' ? fixture.canonical.id : fixture.extra.id}`, 'revision');
  if (mode === 'etag') await control(`google-recovery-delete-conflict:${fixture.extra.id}`, 1);
  const before = await state(), beforeWrites = writes(before), beforeAuthority = authority(before, fixture.booking.id);
  await due(fixture.command.id); await deliver(fixture.command.id);
  const after = await state();
  const command = after.delivery_outbox.find(row => row.id === fixture.command.id);
  if (mode !== 'claim') assert.notEqual(command.state, 'succeeded', `${label}: refuses delivery completion`);
  assert.notEqual(after.bookings.find(row => row.id === fixture.booking.id).calendar_state, 'succeeded', `${label}: not marked delivered`);
  assert.deepEqual(authority(after, fixture.booking.id), beforeAuthority, `${label}: original booking authority unchanged`);
  const newWrites = writes(after).slice(beforeWrites.length);
  assert.equal(newWrites.filter(row => row.method !== 'DELETE').length, 0, `${label}: no canonical event mutation`);
  assert.equal(newWrites.filter(row => row.method === 'DELETE').length, mode === 'etag' ? 1 : 0, `${label}: unsafe deletion refused`);
  assert.equal(eventFor(after, fixture.extra.id).status, 'confirmed', `${label}: extra event retained`);
  if (mode !== 'canonical') assert.deepEqual(eventFor(after, fixture.canonical.id), mode === 'canonical-etag' ? { ...fixture.canonical, etag: '"synthetic-dial-changed"' } : fixture.canonical);
  assert.deepEqual(controlRows(after), controlRows(controlSnapshot), `${label}: unrelated booking preserved`);
  if (mode === 'archive') {
    const archivedCalls = after.wire_calls;
    await due(fixture.command.id); await deliver(fixture.command.id);
    assert.deepEqual((await state()).wire_calls, archivedCalls, 'an archived command cannot be revived by queue replay');
  }
  checks.push(`PROBE AGENT-004 ${label}: native delivery recovery -> refused, canonical and booking authority unchanged`);
}

// Post-delete uncertainty cannot mark the command delivered.
const unverifiable = await pair();
await control(`google-recovery-verify:${unverifiable.extra.id}`, 1);
await due(unverifiable.command.id); await deliver(unverifiable.command.id);
let snapshot = await state();
assert.notEqual(snapshot.delivery_outbox.find(row => row.id === unverifiable.command.id).state, 'succeeded');
assert.notEqual(snapshot.bookings.find(row => row.id === unverifiable.booking.id).calendar_state, 'succeeded');
checks.push('PROBE AGENT-004 provider verification: cleanup followed by paginated verification -> delivery not completed');

// A hidden committed canonical event still takes the existing deterministic-ID conflict path.
const conflict = await book();
await control(`google-list-mode:${conflict.booking.id}`, 'hidden-once');
await due(conflict.command.id); await deliver(conflict.command.id);
snapshot = await state();
assert.equal(snapshot.delivery_outbox.find(row => row.id === conflict.command.id).last_error_code, 'provider_write_conflict');
assert.equal(active(snapshot, conflict.booking.id).length, 1, '409 creates no second event');
await due(conflict.command.id); await deliver(conflict.command.id);
assert.equal((await state()).bookings.find(row => row.id === conflict.booking.id).calendar_provider_event_id, conflict.canonical.id);
checks.push('PROBE AGENT-004 deterministic conflict: hidden canonical produces 409; retry retains the original provider ID');

// Ordinary cancellation must retain its original ambiguity refusal instead of using duplicate recovery.
const cancelled = await pair();
await data(`${cancelled.manage}/cancel`, { reason: 'Synthetic cancellation' });
snapshot = await state();
const cancellation = snapshot.delivery_outbox.find(row => row.booking_id === cancelled.booking.id && row.kind === 'calendar_cancel');
const beforeCancel = writes(snapshot);
await deliver(cancellation.id);
assert.deepEqual(writes(await state()), beforeCancel);
assert.equal(active(await state(), cancelled.booking.id).length, 2);
const staleCalls = (await state()).wire_calls;
await due(cancelled.command.id); await deliver(cancelled.command.id);
assert.deepEqual((await state()).wire_calls, staleCalls, 'a stale upsert cannot touch the cancelled booking provider pair');
checks.push('PROBE AGENT-004 cancellation and stale upsert: native cancellation keeps ambiguous pair lookup; stale original upsert makes no provider request');

await writeFile(evidencePath('google-duplicate-recovery-wire.json'), JSON.stringify({ checks, scope: 'Native public booking and actual production delivery with Google synthetic at the HTTP edge. No UI or live provider qualification.' }, null, 2));
for (const check of checks) console.log(check);
console.log('Google duplicate recovery public-door journey passed.');
