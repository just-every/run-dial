import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contract } from './contract.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';
import { buildDocumentationWorker } from './agent-door/documentation-journey.mjs';
import exceptionProposalsJourney from './agent-door/exception-proposals-journey.mjs';

const zone = ['America', 'New_York'].join('/');
const email = number => [`synthetic-dial-${number}`, 'example.test'].join('@');
const hours = (startMinute, endMinute) => Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute, endMinute }));
const eventInput = {
  slug: 'synthetic-dial-exceptions', title: 'Consultation', description: 'Synthetic exception request.', durationMinutes: 30,
  color: '#176b5a', locationType: 'in_person', locationLabel: 'Office', locationValue: 'Synthetic room', listed: true,
  alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 365,
  beforeBufferMinutes: 15, afterBufferMinutes: 15, hostDayBookingLimit: null, questions: [], availability: hours(540, 720),
};
const emptyLimits = { dayCount: null, weekCount: null, monthCount: null, dayMinutes: null, weekMinutes: null, monthMinutes: null, inviteeGapMinutes: 0 };
const firstWindow = { date: '2030-02-25', startMinute: 780, endMinute: 960 };
const door = id => `/api/app/availability-requests/${id}/exception-proposals`;

async function runtime(context) {
  const directory = await mkdtemp(join(tmpdir(), 'dial-exception-clock-')), workerEntry = join(directory, 'worker.ts');
  const wireConfig = await readFile(new URL('./booking-wire/worker.wrangler.toml', import.meta.url), 'utf8');
  const paymentBindings = Object.fromEntries([...wireConfig.matchAll(/^(STRIPE_[A-Z_]+) = "([^"]+)"$/gm)].map(([, key, value]) => [key, value]));
  await writeFile(workerEntry, `
    import worker, { BookingCoordinator as NativeCoordinator } from ${JSON.stringify(new URL('./move-in/booking-worker.ts', import.meta.url).pathname)};
    const paymentBindings = ${JSON.stringify(paymentBindings)};
    export class BookingCoordinator extends NativeCoordinator { services(env) { return super.services({...env, ...paymentBindings}); } }
    const NativeDate = Date; let fixed = NativeDate.parse('2030-02-18T12:00:00.000Z');
    globalThis.Date = class extends NativeDate {
      constructor(...values) { super(...(values.length ? values : [fixed])); }
      static now() { return fixed; }
    };
    export default { fetch(request, env, ctx) {
      if (new URL(request.url).pathname === '/__exception-clock') { fixed += 1000; return Response.json({ok:true}); }
      return worker.fetch(request, {...env, ...paymentBindings}, ctx);
    } };
  `);
  context.after(() => rm(directory, { recursive: true, force: true }));
  const rt = await bookingRuntime({ workerEntry });
  context.after(() => rt.close());
  await rt.data('/__fixtures/setup', {});
  const profile = await rt.data('/api/app/profile');
  await rt.data('/api/app/profile', { ...profile, timezone: zone }, 200, 'PATCH');
  const disconnect = await rt.api('/api/app/calendar/connection', { method: 'DELETE' });
  assert.equal(disconnect.status, 204); await disconnect.arrayBuffer();
  rt.public = async (path, body, expected = 200) => {
    const response = await rt.api(path, { headers: { cookie: '', 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    assert.equal(response.status, expected, 'public request or booking door: ' + path.split('?')[0]);
    return response.json();
  };
  rt.create = async (overrides = {}, publish = true) => {
    const event = await rt.data('/api/app/event-types', { ...eventInput, ...overrides }, 201);
    if (publish) await rt.data(`/api/app/event-types/${event.id}/publish`, {});
    return event;
  };
  rt.saveHours = async (overrides = {}) => {
    await rt.data('/api/app/hours/closures', { blockUsHolidays: false, reopenedHolidays: [], timeOff: [] }, 200, 'PUT');
    await rt.data('/__exception-clock', {});
    const schedule = (await rt.data('/api/app/availability-schedules')).find(row => row.isDefault);
    return rt.data(`/api/app/availability-schedules/${schedule.id}`, { name: 'Your hours', windows: hours(480, 1080), blockUsHolidays: false, reopenedHolidays: [], timeOff: [], ...overrides }, 200, 'PUT');
  };
  rt.submit = async (event, windows = [firstWindow], inviteeTimezone = zone, number = 420) => {
    const body = { inviteeName: 'Synthetic invitee', inviteeEmail: email(number), inviteeTimezone, windows, note: 'Please consider an afternoon time.' };
    const base = `/api/public/events/dial-host/${event.slug}/request`;
    const review = await rt.public(base + '/review', body, 201);
    await rt.public(base + '?' + new URLSearchParams({ nonce: review.nonce }), body, 201);
    const requests = await rt.data('/api/app/availability-requests');
    const found = requests.find(row => row.inviteeEmail === body.inviteeEmail && row.eventTypeId === event.id);
    assert.ok(found, 'real public review and submission persisted the requested windows');
    assert.deepEqual(found.windows.map(({ date, startMinute, endMinute }) => ({ date, startMinute, endMinute })), windows);
    return { ...found, replay: { base, review, body } };
  };
  rt.book = async (event, startAt, number = 421, expected = 201) => {
    const base = `/api/public/book/dial-host/${event.slug}`;
    const selected = await rt.public(base + '/selection', { startAt, inviteeTimezone: zone }, 201);
    return rt.public(base + '/confirm', { nonce: selected.nonce, startAt, inviteeTimezone: zone, name: 'Synthetic control', email: email(number), answers: {} }, expected);
  };
  rt.propose = async (request, expected = 200) => {
    const response = await rt.api(door(request.id));
    assert.equal(response.status, expected, 'owner advisory exception read');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return response.json();
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

contract('AGENT-002', 'owner exception reads intersect stored windows and saved host hours with fresh native constraints without execution', async context => {
  await buildDocumentationWorker();
  await exceptionProposalsJourney();
  const rt = await runtime(context), event = await rt.create(), request = await rt.submit(event);
  const missing = await snapshot(rt);
  assert.equal((await rt.propose(request, 409)).error.code, 'host_hours_required');
  assert.equal(await snapshot(rt), missing, 'missing host hours are refused rather than manufactured');
  await rt.data(`/api/app/event-types/${event.id}/hours`, { uses: 'yours' }, 200, 'PUT');
  assert.equal((await rt.propose(request, 409)).error.code, 'host_hours_required', 'automatically installed starting hours do not authorize exceptions');
  await rt.data(`/api/app/event-types/${event.id}/hours`, { uses: 'own' }, 200, 'PUT');
  await rt.data(`/api/app/event-types/${event.id}/availability`, { windows: eventInput.availability }, 200, 'PUT');
  const saved = await rt.saveHours();
  const before = await snapshot(rt), result = await rt.propose(request);
  assert.equal(result.advisory, true);
  assert.deepEqual([result.hostTimezone, result.inviteeTimezone], [zone, zone]);
  assert.deepEqual(result.proposals.map(slot => slot.startAt), ['2030-02-25T18:00:00.000Z', '2030-02-25T18:30:00.000Z', '2030-02-25T19:00:00.000Z']);
  assert.equal(result.sources.hostHours.id, saved.id);
  assert.equal(result.sources.calendar, 'not_connected');
  for (const proposal of result.proposals) {
    assert.equal(Date.parse(proposal.endAt) - Date.parse(proposal.startAt), 30 * 60000);
    assert.deepEqual(proposal.tradeOff.inviteeWindow, firstWindow);
    assert.deepEqual(proposal.tradeOff.hostHours, { scheduleId: saved.id, startMinute: 480, endMinute: 1080 });
    assert.equal(proposal.tradeOff.kind, 'outside_event_recurring_hours');
    assert.equal(proposal.tradeOff.publishedWindows[0].endMinute, 720);
  }
  for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(await rt.propose(request), result);
  assert.equal(await snapshot(rt), before, 'repeated reads create no nonce, booking, proposal record, hold, offered link, send or command');
  const anonymous = await rt.api(door(request.id), { headers: { cookie: '' } });
  assert.equal(anonymous.status, 401); await anonymous.body.cancel();
  const wide = await rt.create({ slug: 'synthetic-dial-wide', availability: hours(480, 1080) });
  const booked = await rt.book(wide, result.proposals[0].startAt);
  await rt.data('/__fixtures/deliver', {});
  const occupied = await snapshot(rt), fresh = await rt.propose(request);
  assert.deepEqual(fresh.proposals.map(slot => slot.startAt), ['2030-02-25T19:00:00.000Z', '2030-02-25T19:30:00.000Z', '2030-02-25T20:00:00.000Z'], 'fresh booking and both occupied buffers exclude the first two starts');
  assert.equal(await snapshot(rt), occupied);
  assert.equal((await rt.data(`/api/app/bookings/${booked.bookingReference}`)).occurrence.startAt, result.proposals[0].startAt);
  const nativeBase = `/api/public/book/dial-host/${event.slug}`;
  await rt.public(nativeBase + '/confirm', { startAt: fresh.proposals[0].startAt, inviteeTimezone: zone, name: 'Synthetic no authority', email: email(422), answers: {} }, 404);
  assert.equal(await snapshot(rt), occupied, 'advisory times grant no public booking authority');
  context.diagnostic('PROBE AGENT-002 advisory: public request review and submit then owner GET -> three concrete outside-event, inside-host times; repeated reads change nothing and a fresh buffered booking removes two candidates.');
});

contract('AGENT-002', 'exception reads retain closures date bounds notice increment caps invitee gaps holds and DST', async context => {
  const rt = await runtime(context), event = await rt.create(), request = await rt.submit(event);
  await rt.saveHours();
  const baseline = await rt.propose(request); assert.equal(baseline.proposals.length, 3);
  await rt.saveHours({ timeOff: [{ startDate: firstWindow.date, endDate: firstWindow.date }] });
  assert.deepEqual((await rt.propose(request)).proposals, [], 'host time off closes exception time');
  await rt.saveHours();
  await rt.data(`/api/app/event-types/${event.id}/availability-overrides/${firstWindow.date}`, { hostDate: firstWindow.date, mode: 'closed', windows: [] }, 200, 'PUT');
  assert.deepEqual((await rt.propose(request)).proposals, [], 'closed event date is retained');
  await rt.data(`/api/app/event-types/${event.id}/availability-overrides/${firstWindow.date}`, { hostDate: firstWindow.date, mode: 'open', windows: [{ startMinute: 840, endMinute: 900 }] }, 200, 'PUT');
  assert.deepEqual((await rt.propose(request)).proposals.map(row => row.startAt), ['2030-02-25T19:00:00.000Z', '2030-02-25T19:30:00.000Z'], 'event date opening restricts exceptions');
  const removed = await rt.api(`/api/app/event-types/${event.id}/availability-overrides/${firstWindow.date}`, { method: 'DELETE' });
  assert.equal(removed.status, 204); await removed.arrayBuffer();
  const holidayRequest = await rt.submit(event, [{ date: '2030-07-04', startMinute: 780, endMinute: 900 }], zone, 423);
  await rt.saveHours({ blockUsHolidays: true });
  assert.deepEqual((await rt.propose(holidayRequest)).proposals, [], 'saved host holiday closes a date on an event with its own hours');
  await rt.saveHours();
  for (const [number, config] of [
    [1, { bookingHorizonDays: 2 }],
    [2, { minimumNoticeMinutes: 10080 }],
    [3, { bookingHorizonMode: 'fixed_range', bookingStartDate: '2030-02-26', bookingEndDate: '2030-03-01' }],
    [4, { slotIncrementMinutes: 45 }],
  ]) {
    const configured = await rt.create({ slug: `synthetic-dial-bound-${number}`, ...config });
    const composed = await rt.submit(configured, [{ ...firstWindow, ...(number === 2 ? { date: '2030-02-24' } : {}) }], zone, 430 + number);
    const starts = (await rt.propose(composed)).proposals.map(slot => slot.startAt);
    if (number < 3) assert.deepEqual(starts, [], 'horizon or notice cannot be bypassed');
    else if (number === 3) assert.deepEqual(starts, [], 'fixed date bounds cannot be bypassed');
    else assert.deepEqual(starts, ['2030-02-25T18:15:00.000Z', '2030-02-25T19:00:00.000Z', '2030-02-25T19:45:00.000Z'], 'start grid remains anchored to the real host window');
  }
  const inside = await rt.submit(event, [{ date: firstWindow.date, startMinute: 540, endMinute: 720 }], zone, 440);
  assert.deepEqual((await rt.propose(inside)).proposals, [], 'ordinary recurring event times are not exception proposals');
  const narrow = await rt.submit(event, [{ date: firstWindow.date, startMinute: 780, endMinute: 800 }], zone, 441);
  assert.deepEqual((await rt.propose(narrow)).proposals, [], 'a full duration must fit one stored window');
  const beyondHost = await rt.submit(event, [{ date: firstWindow.date, startMinute: 1080, endMinute: 1200 }], zone, 442);
  assert.deepEqual((await rt.propose(beyondHost)).proposals, [], 'invitee windows cannot widen saved host hours');
  const control = await rt.book(event, '2030-02-25T15:00:00.000Z', 420);
  for (const scope of ['host', event.id]) for (const [key, value] of Object.entries({ dayCount: 1, weekCount: 1, monthCount: 1, dayMinutes: 30, weekMinutes: 30, monthMinutes: 30 })) {
    await rt.data(`/api/app/booking-limits/${scope}`, { ...emptyLimits, [key]: value }, 200, 'PUT');
    assert.deepEqual((await rt.propose(request)).proposals, [], `${scope === 'host' ? 'host' : 'event'} ${key} is preserved`);
    await rt.data(`/api/app/booking-limits/${scope}`, emptyLimits, 200, 'PUT');
  }
  await rt.data('/api/app/booking-limits/host', { ...emptyLimits, inviteeGapMinutes: 240 }, 200, 'PUT');
  assert.deepEqual((await rt.propose(request)).proposals.map(slot => slot.startAt), ['2030-02-25T19:30:00.000Z', '2030-02-25T20:00:00.000Z', '2030-02-25T20:30:00.000Z'], 'gap uses the stored invitee identity without excluding its existing booking');
  await rt.data('/api/app/booking-limits/host', emptyLimits, 200, 'PUT');
  const dayCap = await rt.create({ slug: 'synthetic-dial-host-day-cap', hostDayBookingLimit: 1 });
  assert.deepEqual((await rt.propose(await rt.submit(dayCap, [firstWindow], zone, 443))).proposals, [], 'host-day cap includes another event booking');
  assert.equal((await rt.data(`/api/app/bookings/${control.bookingReference}`)).occurrence.startAt, '2030-02-25T15:00:00.000Z');
  const wide = await rt.create({ slug: 'synthetic-dial-held-wide', availability: hours(480, 1080) });
  const offer = await rt.data('/api/app/booking-links', { eventTypeId: wide.id, kind: 'single_use', offeredStarts: ['2030-02-25T18:00:00.000Z'], holdHours: 48, expiresAt: '2030-02-27T12:00:00.000Z' }, 201);
  assert.deepEqual((await rt.propose(request)).proposals.map(slot => slot.startAt), ['2030-02-25T19:00:00.000Z', '2030-02-25T19:30:00.000Z', '2030-02-25T20:00:00.000Z'], 'native offered-time hold and its buffers remain occupied');
  await rt.data(`/api/app/booking-links/${offer.id}/revoke`, {});
  const approval = await rt.create({ slug: 'synthetic-dial-held-approval', availability: hours(480, 1080) });
  await rt.data(`/api/app/event-types/${approval.id}/approval`, { required: true, windowHours: 168 }, 200, 'PUT');
  await rt.book(approval, '2030-02-25T18:00:00.000Z', 444, 202);
  assert.deepEqual((await rt.propose(request)).proposals.map(slot => slot.startAt), ['2030-02-25T19:00:00.000Z', '2030-02-25T19:30:00.000Z', '2030-02-25T20:00:00.000Z'], 'native approval holds retain occupied buffers');
  const authorize = await rt.api('/api/app/payments/stripe/oauth/start');
  assert.equal(authorize.status, 302); await authorize.body?.cancel();
  const state = new URL(authorize.headers.get('location')).searchParams.get('state');
  const callback = await rt.api('/api/payments/stripe/oauth/callback?' + new URLSearchParams({ code: 'wire-stripe-consent', state }));
  assert.equal(callback.status, 302); await callback.body?.cancel();
  const paid = await rt.create({ slug: 'synthetic-dial-held-payment', availability: hours(480, 1080) });
  await rt.data(`/api/app/event-types/${paid.id}/price`, { amountCents: 500, durationPrices: [] }, 200, 'PUT');
  const checkout = await rt.book(paid, '2030-02-25T19:00:00.000Z', 448, 202);
  assert.ok(checkout.payment.checkoutUrl, 'native public paid confirmation creates an active payment hold');
  const held = await snapshot(rt);
  assert.deepEqual((await rt.propose(request)).proposals.map(slot => slot.startAt), ['2030-02-25T20:00:00.000Z', '2030-02-25T20:30:00.000Z'], 'payment and approval holds each retain their buffered occupied interval');
  assert.equal(await snapshot(rt), held, 'reading payment constraints never recovers, releases or executes payment commands');
  await rt.saveHours({ windows: hours(60, 240) });
  const spring = await rt.submit(event, [{ date: '2030-03-10', startMinute: 120, endMinute: 180 }], 'UTC', 445);
  assert.deepEqual((await rt.propose(spring)).proposals, [], 'cross-zone stored window does not become a nonexistent host spring time');
  const springActual = await rt.submit(event, [{ date: '2030-03-10', startMinute: 60, endMinute: 240 }], zone, 446);
  assert.deepEqual((await rt.propose(springActual)).proposals.map(slot => slot.startAt), ['2030-03-10T06:00:00.000Z', '2030-03-10T06:30:00.000Z', '2030-03-10T07:00:00.000Z'], 'spring skip contains only real instants inside both wall-clock windows');
  const fold = await rt.submit(event, [{ date: '2030-11-03', startMinute: 90, endMinute: 120 }], zone, 447);
  assert.deepEqual((await rt.propose(fold)).proposals.map(slot => slot.startAt), ['2030-11-03T05:30:00.000Z', '2030-11-03T06:30:00.000Z'], 'a repeated-hour window has disjoint UTC spans; duration cannot cross its intervening gap');
  context.diagnostic('PROBE AGENT-002 constraints: owner GET after native closures, date restrictions, notice, horizon, increment, count and minute caps, invitee gap, offered and approval holds, spring and fall requests -> invalid candidates excluded.');
});

contract('AGENT-002', 'unsupported exception requests and revoked native authority refuse without recovery or side effects', async context => {
  const rt = await runtime(context), event = await rt.create();
  await rt.saveHours();
  const request = await rt.submit(event), before = await snapshot(rt);
  assert.equal((await rt.propose({ id: '0'.repeat(26) }, 404)).error.code, 'availability_request_not_found');
  const restricted = await rt.api(door(request.id) + '?link=synthetic-dial-restricted');
  // A caller cannot supply restricted-link windows or override the stored request via query fields.
  assert.equal(restricted.status, 400); assert.equal((await restricted.json()).error.code, 'invalid_request');
  assert.equal(await snapshot(rt), before);
  for (const [number, overrides, settings] of [
    [1, { groupCapacity: 3 }], [2, { durationOptionsMinutes: [30, 60] }],
    [3, { locations: [{ id: 'one', type: 'in_person', label: 'Office', value: 'Synthetic room' }, { id: 'two', type: 'phone', label: 'Phone', value: '+12025550123' }] }],
    [4, { locationType: 'invitee_phone', locationValue: '' }],
    [5, {}, ['approval', { required: true, windowHours: 24 }]], [6, {}, ['guests', { guestLimit: 1 }]],
    [7, {}, ['price', { amountCents: 500, durationPrices: [] }]],
    [8, {}, ['payment-terms', { deposit: { kind: 'none' }, balanceDueHours: 24, freeWindowHours: 24, lateCancelFeeCents: 500, noShowFeeCents: 0 }]],
  ]) {
    const unsupported = await rt.create({ slug: `synthetic-dial-unsupported-${number}`, ...overrides });
    const submitted = await rt.submit(unsupported, [firstWindow], zone, 450 + number);
    if (settings) await rt.data(`/api/app/event-types/${unsupported.id}/${settings[0]}`, settings[1], 200, 'PUT');
    const unchanged = await snapshot(rt);
    assert.equal((await rt.propose(submitted, 409)).error.code, 'exception_proposals_unsupported');
    assert.equal(await snapshot(rt), unchanged, 'unsupported reads change no database or provider state');
  }
  const teamEvent = await rt.create({ slug: 'synthetic-dial-team' }), teamRequest = await rt.submit(teamEvent, [firstWindow], zone, 460);
  await rt.data('/api/app/teams', { name: 'Synthetic team', eventTypeIds: [teamEvent.id] }, 201);
  assert.equal((await rt.propose(teamRequest, 409)).error.code, 'exception_proposals_unsupported');
  const erased = await rt.submit(event, [firstWindow], zone, 470);
  const preview = await rt.data('/api/app/privacy/preview', { email: email(470) });
  await rt.data('/api/app/privacy/erase', { email: email(470), confirmation: preview.confirmation, expiresAt: preview.expiresAt });
  const erasedBefore = await snapshot(rt);
  assert.equal((await rt.propose(erased, 404)).error.code, 'availability_request_not_found');
  await rt.public(erased.replay.base + '?' + new URLSearchParams({ nonce: erased.replay.review.nonce }), erased.replay.body, 404);
  assert.equal(await snapshot(rt), erasedBefore, 'an erased request and its captured review cannot resurrect or expose invitee windows');
  assert.equal((await rt.propose(request)).proposals.length, 3, 'erasure preserves the control request');
  await rt.data(`/api/app/availability-requests/${request.id}/state`, { state: 'closed' });
  assert.equal((await rt.propose(request, 409)).error.code, 'availability_request_resolved');
  const connectedRequest = await rt.submit(event, [firstWindow], zone, 461);
  await rt.data('/__fixtures/setup', {});
  const connected = await snapshot(rt);
  assert.equal((await rt.propose(connectedRequest, 409)).error.code, 'exception_proposals_unsupported');
  assert.equal(await snapshot(rt), connected, 'healthy connected calendar is refused before provider access');
  await rt.data('/wire/control', { name: 'calendar-health-failure', value: 1 });
  await rt.db.prepare("UPDATE calendar_connections SET status='unhealthy', unhealthy_code='selection_required' WHERE singleton_key='default'").run();
  const unhealthy = await snapshot(rt);
  assert.equal((await rt.propose(connectedRequest, 409)).error.code, 'exception_proposals_unsupported');
  assert.equal(await snapshot(rt), unhealthy, 'unhealthy connection is refused before recovery');
  const signout = await rt.api('/api/auth/sign-out', { method: 'POST' });
  assert.ok([204, 303].includes(signout.status)); await signout.arrayBuffer();
  const revoked = await rt.api(door(connectedRequest.id));
  assert.equal(revoked.status, 401); await revoked.body.cancel();
  context.diagnostic('PROBE AGENT-002 refusal: anonymous, revoked session, unsupported configurations, resolved request and connected or unhealthy calendar -> explicit refusals with no proposal execution, recovery or provider activity.');
});
