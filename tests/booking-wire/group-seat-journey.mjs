import assert from 'node:assert/strict';
import { wireMail, recipient, textBody } from './mail-contracts.mjs';

const address = number => ['synthetic-dial-' + number, 'example.test'].join('@');
const tokenOf = receipt => new URL(receipt.manageUrl).pathname.split('/').at(-1);
const businessTables = ['bookings', 'booking_occurrences', 'booking_answers', 'booking_manage_tokens', 'booking_history', 'delivery_outbox', 'booking_payments', 'payment_holds', 'booking_approval_requests'];
const snapshot = async rt => Object.fromEntries(await Promise.all(businessTables.map(async table => [table, (await rt.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));

/** Native clients share a real slot ledger; only paid network edges are synthetic. */
export async function groupSeatJourney(rt, context) {
  await rt.data('/__fixtures/setup', {});
  const input = {
    slug: 'synthetic-dial-group', title: 'Group consultation', description: 'A shared consultation with private seat details.',
    durationMinutes: 30, groupCapacity: 3, color: '#176b5a', locationType: 'fixed_link',
    locationLabel: 'Meeting room', locationValue: 'https://meeting.example.test/synthetic-dial-601',
    listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30,
    minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0,
    hostDayBookingLimit: null, questions: [{ kind: 'text', label: 'Private preparation', private: true, required: true, options: [] }],
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
  };
  const connected = await rt.data('/api/app/event-types', input, 409);
  assert.equal(connected.error.code, 'group_calendar_unsupported');
  assert.equal((await rt.data('/api/app/event-types')).some(event => event.slug === input.slug), false);
  const disconnected = await rt.api('/api/app/calendar/connection', { method: 'DELETE' });
  assert.equal(disconnected.status, 204); await disconnected.arrayBuffer();
  for (const capacity of [1, 1001]) await rt.data('/api/app/event-types', { ...input, slug: `synthetic-dial-invalid-${capacity}`, groupCapacity: capacity }, 400);
  for (const capacity of [2, 1000]) {
    const configured = await rt.data('/api/app/event-types', { ...input, slug: `synthetic-dial-capacity-${capacity}`, groupCapacity: capacity }, 201);
    assert.equal(configured.groupCapacity, capacity);
    assert.equal((await rt.data(`/api/app/event-types/${configured.id}`)).groupCapacity, capacity);
  }
  const group = await rt.data('/api/app/event-types', input, 201);
  assert.equal(group.groupCapacity, 3);
  const ordinary = await rt.data('/api/app/event-types', { ...input, slug: 'synthetic-dial-ordinary', groupCapacity: null }, 201);
  const refusedCombinations = [
    ['price', { amountCents: 500, durationPrices: [] }, 'group_payment_unsupported'],
    ['approval', { required: true, windowHours: 24 }, 'group_approval_unsupported'],
    ['guests', { guestLimit: 1 }, 'group_guest_unsupported'],
    ['payment-terms', { deposit: { kind: 'none' }, balanceDueHours: 24, freeWindowHours: 24, lateCancelFeeCents: 500, noShowFeeCents: 0 }, 'group_payment_unsupported'],
  ];
  for (const [setting, value, code] of refusedCombinations) {
    const before = await rt.data(`/api/app/event-types/${group.id}/${setting}`);
    const refused = await rt.data(`/api/app/event-types/${group.id}/${setting}`, value, 409, 'PUT');
    assert.equal(refused.error.code, code);
    assert.deepEqual(await rt.data(`/api/app/event-types/${group.id}/${setting}`), before, 'unsupported group combinations preserve the existing configuration');
  }
  await rt.data(`/api/app/event-types/${group.id}/publish`, {});
  await rt.data(`/api/app/event-types/${ordinary.id}/publish`, {});
  const anonymous = await rt.api(`/api/app/event-types/${group.id}`, { method: 'PATCH', headers: { cookie: '', 'content-type': 'application/json' }, body: JSON.stringify({ ...input, groupCapacity: 2 }) });
  assert.equal(anonymous.status, 401); await anonymous.arrayBuffer();
  assert.equal((await rt.data(`/api/app/event-types/${group.id}`)).groupCapacity, 3);
  const publicCall = async (path, body, expected = 200, client = 1, method = body === undefined ? 'GET' : 'POST') => {
    const response = await rt.api(path, { method, headers: { cookie: '', 'CF-Connecting-IP': `192.0.2.${client}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} native group door: expected ${expected}, received ${response.status}`);
    return response;
  };
  const publicData = async (...args) => (await publicCall(...args)).json();
  const base = `/api/public/book/dial-host/${group.slug}`, ordinaryBase = `/api/public/book/dial-host/${ordinary.slug}`;
  const week = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  const offers = () => publicData(`${base}/availability?week=${week}`, undefined, 200, 220);
  const offered = async startAt => (await offers()).slots.some(slot => slot.startAt === startAt);
  const initialSlots = (await offers()).slots;
  assert.ok(initialSlots.length >= 8);
  const startAt = initialSlots[1].startAt;
  const select = (at, client, door = base) => publicData(`${door}/selection`, { startAt: at, inviteeTimezone: 'UTC' }, 201, client);
  const composition = (event, nonce, at, number) => ({ nonce, startAt: at, inviteeTimezone: 'UTC', name: `Seat holder ${number}`, email: address(number), answers: { [event.questions[0].key]: `Private seat answer ${number}` } });
  const selected = await Promise.all([1, 2, 3, 4].map(client => select(startAt, client)));
  const payloads = selected.map((selection, index) => composition(group, selection.nonce, startAt, 610 + index));
  const seats = [];
  for (let index = 0; index < 3; index++) {
    seats.push(await publicData(`${base}/confirm`, payloads[index], 201, index + 1));
    assert.equal(await offered(startAt), index < 2, 'the public slot stays offered exactly until its third seat fills');
  }
  assert.equal(new Set(seats.map(seat => seat.bookingReference)).size, 3);
  assert.equal(new Set(seats.map(tokenOf)).size, 3);
  const beforeFourth = await snapshot(rt);
  await publicData(`${base}/confirm`, payloads[3], 409, 4);
  assert.deepEqual(await snapshot(rt), beforeFourth, 'a fourth preselected claim changes no booking, answer, authority or delivery');
  assert.deepEqual(await publicData(`${base}/confirm`, payloads[0], 200, 1), seats[0], 'nonce replay returns the original seat and manage capability');
  await publicData(`${base}/confirm`, { ...payloads[0], email: address(699) }, 409, 1);
  assert.deepEqual(await snapshot(rt), beforeFourth, 'replay and changed-payload refusal create no additional seat or notice');
  for (const [index, seat] of seats.entries()) {
    const own = await rt.data(`/api/app/bookings/${seat.bookingReference}`);
    assert.deepEqual(own.answers.map(answer => answer.value), [`Private seat answer ${610 + index}`]);
    const managed = await publicData(`/api/public/manage/${tokenOf(seat)}?bookingId=${seats[(index + 1) % 3].bookingReference}`, undefined, 200, index + 1);
    assert.equal(managed.bookingReference, seat.bookingReference, 'a foreign booking identifier cannot widen the bearer capability');
    const serialized = JSON.stringify(managed);
    for (const [other, otherSeat] of seats.entries()) if (other !== index) {
      assert.equal(serialized.includes(tokenOf(otherSeat)), false);
      assert.equal(serialized.includes(`Private seat answer ${610 + other}`), false);
      assert.equal(serialized.includes(address(610 + other)), false);
    }
    assert.equal(seat.calendarState, 'not_required');
    assert.equal(seat.meetingState, 'not_required');
  }
  await publicData('/api/public/manage/synthetic-dial-unrecognized-capability', undefined, 404, 219);
  await publicData('/api/public/manage/synthetic-dial-unrecognized-capability/cancel', {}, 404, 219);
  await rt.data('/__fixtures/deliver', {}); await rt.data('/__fixtures/deliver', {});
  let state = await rt.data('/wire/state');
  for (let index = 0; index < 3; index++) {
    const messages = wireMail(state).filter(mail => recipient(mail).includes(address(610 + index)));
    assert.equal(messages.length, 1, 'one confirmation reaches each admitted invitee');
    const message = JSON.stringify(messages[0]);
    assert.ok(textBody(messages[0]).includes(`Private seat answer ${610 + index}`));
    assert.ok(message.includes(tokenOf(seats[index])));
    for (let other = 0; other < 3; other++) if (other !== index) {
      assert.equal(message.includes(address(610 + other)), false);
      assert.equal(message.includes(`Private seat answer ${610 + other}`), false);
      assert.equal(message.includes(tokenOf(seats[other])), false);
    }
    const reminders = state.delivery_outbox.filter(row => row.booking_id === seats[index].bookingReference && row.kind === 'reminder' && JSON.parse(row.payload_json).recipientRole === 'invitee');
    assert.equal(reminders.length, 2);
    assert.deepEqual(reminders.map(row => (Date.parse(startAt) - Date.parse(row.next_attempt_at)) / 3600000).sort((left, right) => left - right), [1, 24]);
    for (const reminder of reminders) {
      assert.equal(JSON.parse(reminder.payload_json).to, address(610 + index));
      const due = await rt.api('/__fixtures/due', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: reminder.id }) });
      assert.equal(due.status, 204); await due.arrayBuffer();
      await rt.data('/__fixtures/deliver', { id: reminder.id });
      await rt.data('/__fixtures/deliver', { id: reminder.id });
    }
  }
  state = await rt.data('/wire/state');
  for (let index = 0; index < 3; index++) {
    const reminders = wireMail(state).filter(mail => recipient(mail).includes(address(610 + index)) && /^Reminder:/.test(mail.subject));
    assert.equal(reminders.length, 2, 'two due reminders reach only their own seat holder and never repeat');
    for (const message of reminders) {
      assert.ok(JSON.stringify(message).includes(tokenOf(seats[index])), 'the reminder carries only its own manage authority');
      for (let other = 0; other < 3; other++) if (other !== index) {
        assert.equal(JSON.stringify(message).includes(tokenOf(seats[other])), false);
        assert.equal(JSON.stringify(message).includes(address(610 + other)), false);
        assert.equal(JSON.stringify(message).includes(`Private seat answer ${610 + other}`), false);
      }
    }
  }
  assert.equal(state.delivery_outbox.some(row => row.kind.startsWith('calendar_')), false, 'calendar-optional group admission creates no provider event commands');
  const ordinaryRefusal = await snapshot(rt);
  await publicData(`${ordinaryBase}/selection`, { startAt, inviteeTimezone: 'UTC' }, 409, 210);
  assert.deepEqual(await snapshot(rt), ordinaryRefusal, 'an ordinary booking cannot overlap an occupied group slot');
  const controlStart = initialSlots[4].startAt;
  const ordinarySelection = await select(controlStart, 211, ordinaryBase);
  const control = await publicData(`${ordinaryBase}/confirm`, composition(ordinary, ordinarySelection.nonce, controlStart, 620), 201, 211);
  await publicData(`${base}/selection`, { startAt: controlStart, inviteeTimezone: 'UTC' }, 409, 212);
  const concurrentStart = initialSlots[7].startAt;
  const concurrentSelections = await Promise.all(Array.from({ length: 50 }, (_, index) => select(concurrentStart, 50 + index)));
  const concurrentPayloads = concurrentSelections.map((selection, index) => composition(group, selection.nonce, concurrentStart, 700 + index));
  const results = await Promise.all(concurrentPayloads.map((payload, index) => publicCall(`${base}/confirm`, payload, [201, 409], 50 + index)));
  const admitted = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 201) admitted.push({ index, receipt: await result.json() });
    else await result.arrayBuffer();
  }
  assert.equal(admitted.length, 3, 'fifty concurrent confirmations admit exactly the three available seats');
  const current = await rt.db.prepare("SELECT b.id FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.event_type_id=? AND b.state IN ('confirmed','rescheduled') AND o.start_at=?").bind(group.id, concurrentStart).all();
  assert.deepEqual(new Set(current.results.map(row => row.id)), new Set(admitted.map(row => row.receipt.bookingReference)));
  assert.equal(await offered(concurrentStart), false);
  const full = await snapshot(rt);
  for (const winner of admitted) assert.deepEqual(await publicData(`${base}/confirm`, concurrentPayloads[winner.index], 200, 50 + winner.index), winner.receipt);
  assert.deepEqual(await snapshot(rt), full, 'replayed winning concurrent claims do not exceed the seat count');
  const reduction = await rt.data(`/api/app/event-types/${group.id}`, { ...input, questions: group.questions, groupCapacity: 2 }, 409, 'PATCH');
  assert.equal(reduction.error.code, 'group_capacity_conflict');
  assert.equal((await rt.data(`/api/app/event-types/${group.id}`)).groupCapacity, 3);
  const movingToken = tokenOf(seats[1]);
  const beforeFullMove = await snapshot(rt);
  await publicData(`/api/public/manage/${movingToken}/reschedule/selection`, { startAt: concurrentStart, inviteeTimezone: 'UTC' }, 409, 2);
  assert.deepEqual(await snapshot(rt), beforeFullMove, 'moving an existing seat cannot exceed a different full slot');
  const moveStart = initialSlots[10].startAt;
  const moveSelection = await publicData(`/api/public/manage/${movingToken}/reschedule/selection`, { startAt: moveStart, inviteeTimezone: 'UTC' }, 201, 2);
  const moved = await publicData(`/api/public/manage/${movingToken}/reschedule`, { nonce: moveSelection.nonce, startAt: moveStart, inviteeTimezone: 'UTC', reason: 'Move one seat' }, 200, 2);
  assert.equal(moved.bookingReference, seats[1].bookingReference);
  assert.equal(moved.occurrence.startAt, moveStart);
  assert.equal(await offered(startAt), true, 'moving one seat frees its former slot');
  assert.equal(await offered(moveStart), true, 'the new slot still offers its other two seats');
  const returnSelection = await publicData(`/api/public/manage/${movingToken}/reschedule/selection`, { startAt, inviteeTimezone: 'UTC' }, 201, 2);
  const returned = await publicData(`/api/public/manage/${movingToken}/reschedule`, { nonce: returnSelection.nonce, startAt, inviteeTimezone: 'UTC', reason: 'Return one seat' }, 200, 2);
  assert.equal(returned.bookingReference, seats[1].bookingReference);
  assert.equal(await offered(startAt), false);
  assert.deepEqual((await rt.data(`/api/app/bookings/${seats[1].bookingReference}`)).answers.map(answer => answer.value), ['Private seat answer 611']);
  const cancelled = await publicData(`/api/public/manage/${tokenOf(seats[0])}/cancel`, { reason: 'Release one seat' }, 200, 1);
  assert.equal(cancelled.state, 'cancelled'); assert.equal(await offered(startAt), true);
  const onceCancelled = await snapshot(rt);
  await publicData(`/api/public/manage/${tokenOf(seats[0])}/cancel`, { reason: 'Release one seat' }, 200, 1);
  assert.deepEqual(await snapshot(rt), onceCancelled, 'repeated seat cancellation changes no other seat and creates no duplicate notice');
  const replacement = await publicData(`${base}/confirm`, payloads[3], 201, 4);
  assert.equal(await offered(startAt), false, 'one cancellation releases exactly one seat');
  for (const [index, seat] of seats.slice(1).entries()) assert.equal((await publicData(`/api/public/manage/${tokenOf(seat)}`, undefined, 200, 221)).state, index === 0 ? 'rescheduled' : 'confirmed');
  const controls = await Promise.all([seats[2], replacement, control].map(seat => rt.data(`/api/app/bookings/${seat.bookingReference}`)));
  const preview = await rt.data('/api/app/privacy/preview', { email: address(611) });
  assert.equal(preview.bookings, 1);
  const erased = await rt.data('/api/app/privacy/erase', { email: address(611), confirmation: preview.confirmation, expiresAt: preview.expiresAt });
  assert.equal(erased.localComplete, true);
  await publicData(`/api/public/manage/${tokenOf(seats[1])}`, undefined, 404, 2);
  await publicData(`${base}/confirm`, payloads[1], [404, 410], 2);
  assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM bookings WHERE id=?').bind(seats[1].bookingReference).first()).n, 0);
  for (const [index, seat] of [seats[2], replacement, control].entries()) {
    assert.deepEqual(await rt.data(`/api/app/bookings/${seat.bookingReference}`), controls[index], 'person erasure preserves group and ordinary control bookings with their answers and authority');
    assert.equal((await publicData(`/api/public/manage/${tokenOf(seat)}`, undefined, 200, 222)).bookingReference, seat.bookingReference);
  }
  assert.equal(await offered(startAt), true, 'erasing one invitee releases their occupied seat');
  const afterErasure = await snapshot(rt);
  await publicData(`${base}/confirm`, payloads[1], [404, 410], 2);
  assert.deepEqual(await snapshot(rt), afterErasure, 'captured confirmation replay cannot resurrect an erased invitee');
  const fresh = await select(startAt, 213);
  await publicData(`${base}/confirm`, composition(group, fresh.nonce, startAt, 621), 201, 213);
  assert.equal(await offered(startAt), false);
  context.diagnostic('PROBE EVENT-007 configuration: owner native event creation -> capacities 2 and 1000 round-trip, out-of-range 400, anonymous edit 401, connected calendar 409 without writes.');
  context.diagnostic('PROBE EVENT-007 claims: public native selection and confirmation -> three independent seats, fourth claim 409 unchanged, fifty concurrent confirmations admit exactly three, nonce replay returns its original seat.');
  context.diagnostic('PROBE EVENT-007 privacy and delivery: own manage capability -> own booking only; native synthetic mail edge -> one confirmation and two reminders per admitted invitee, no other seat answers or capabilities.');
  context.diagnostic('PROBE EVENT-007 cancellation: own native manage cancel twice -> one cancellation, one freed place and one replacement; ordinary and group overlaps refuse in both directions.');
  context.diagnostic('PROBE EVENT-007 erasure: native owner preview and erase -> one seat removed, captured nonce and manage capability refused, other group seats and ordinary control unchanged.');
}
