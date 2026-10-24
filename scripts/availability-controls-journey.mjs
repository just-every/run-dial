import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { call, data, snapshot } from '../tests/availability-diagnostics/helpers.mjs';

const empty = { dayCount: null, weekCount: null, monthCount: null, dayMinutes: null, weekMinutes: null, monthMinutes: null, inviteeGapMinutes: 0 };
const plus = (day, offset) => new Date(Date.parse(day + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const at = (day, hour) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const config = event => Object.fromEntries(Object.entries(event).filter(([key]) => !['id', 'status', 'requestOnly', 'createdAt', 'updatedAt'].includes(key)));
const uses = (hours, id) => hours.events.find(event => event.id === id).uses;

/** Extend the existing native scheduling journey through operator and public HTTP doors. */
export async function verifyAvailabilityControls(eventId) {
  let first = await data(`/api/app/event-types/${eventId}`, undefined, 200, true);
  first = await data(`/api/app/event-types/${eventId}`, { ...config(first), questions: [], durationMinutes: 60, durationOptionsMinutes: [60], minimumNoticeMinutes: 0, bookingHorizonMode: 'indefinite', beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null }, 200, true, 'PATCH');
  const second = await data('/api/app/event-types', { ...config(first), slug: 'follow-up-controls', title: 'Follow-up consultation' }, 201, true);
  const windows = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 840 }));
  let schedule = await data('/api/app/availability-schedules', { name: 'Working hours', windows, blockUsHolidays: false, reopenedHolidays: [], timeOff: [] }, 201, true);
  for (const event of [first, second]) await data(`/api/app/event-types/${event.id}/hours`, { uses: schedule.id }, 200, true, 'PUT');
  await data(`/api/app/event-types/${second.id}/publish`, {}, 200, true);
  const edited = windows.map(window => ({ ...window, startMinute: 660 }));
  schedule = await data(`/api/app/availability-schedules/${schedule.id}`, { ...scheduleInput(schedule), windows: edited }, 200, true, 'PUT');
  for (const event of [first, second]) assert.deepEqual((await data(`/api/app/event-types/${event.id}`, undefined, 200, true)).availability, edited);
  await data(`/api/app/event-types/${first.id}/availability`, { windows }, 200, true, 'PUT');
  assert.deepEqual((await data(`/api/app/event-types/${second.id}`, undefined, 200, true)).availability, windows);
  await data(`/api/app/event-types/${first.id}/availability`, { windows: edited }, 200, true, 'PUT');
  first = await data(`/api/app/event-types/${eventId}`, undefined, 200, true);
  await data(`/api/app/event-types/${first.id}`, { ...config(first), title: 'Shared strategy consultation' }, 200, true, 'PATCH');
  assert.equal(uses(await data('/api/app/hours', undefined, 200, true), first.id), schedule.id);
  const sample = plus(new Date().toISOString().slice(0, 10), 40);
  for (const event of [first, second]) {
    const offers = await data(`/api/public/book/dial-host/${event.slug}/availability?week=${sample}`);
    assert.ok(offers.slots.length > 0);
    assert.ok(offers.slots.every(slot => slot.startAt.slice(11, 16) >= '11:00' && slot.endAt.slice(11, 16) <= '14:00'));
  }
  const year = Number(sample.slice(0, 4)), november = `${year}-11-01`;
  const thanksgiving = plus(november, (4 - new Date(november + 'T12:00:00Z').getUTCDay() + 7) % 7 + 21);
  const veterans = `${year}-11-11`;
  // Holidays and time off live with your hours and close dates on every event, these two on Working hours included.
  // A new event with no hours of its own makes your hours here; Working hours refuses them.
  const onYours = await data('/api/app/event-types', { ...config(first), availability: undefined, slug: 'your-hours-controls', title: 'Your hours consultation' }, 201, true);
  let hours = await data('/api/app/hours', undefined, 200, true);
  assert.equal(uses(hours, onYours.id), 'yours');
  let yours = { ...scheduleInput(hours.yours), name: 'Your hours' };
  assert.deepEqual((await (await call(`/api/app/availability-schedules/${schedule.id}`, { ...scheduleInput(schedule), blockUsHolidays: true }, 400, true, 'PUT')).json()).error.details, ['blockUsHolidays']);
  yours = scheduleInput(await data(`/api/app/availability-schedules/${hours.yours.id}`, { ...yours, blockUsHolidays: true }, 200, true, 'PUT'));
  const diagnosis = async (id, day, hour = 11) => data(`/api/app/event-types/${id}/availability-diagnostics?${new URLSearchParams({ startAt: at(day, hour), overrideNoticeAndHorizon: 'true' })}`, undefined, 200, true);
  for (const event of [first, second]) {
    assert.deepEqual((await diagnosis(event.id, thanksgiving)).exclusions, ['date_override']);
    assert.deepEqual((await diagnosis(event.id, veterans)).exclusions, ['date_override']);
  }
  yours = scheduleInput(await data(`/api/app/availability-schedules/${hours.yours.id}`, { ...yours, reopenedHolidays: [veterans], timeOff: [{ startDate: `${year}-12-23`, endDate: `${year}-12-27` }] }, 200, true, 'PUT'));
  assert.equal((await diagnosis(first.id, veterans)).valid, true);
  for (let day = 22; day <= 28; day++) assert.equal((await diagnosis(second.id, `${year}-12-${day}`)).valid, day === 22 || day === 28);
  const copied = await data(`/api/app/event-types/${first.id}/duplicate`, {}, 201, true);
  hours = await data('/api/app/hours', undefined, 200, true);
  assert.equal(uses(hours, copied.id), schedule.id);
  await call(`/api/app/event-types/${copied.id}`, undefined, 204, true, 'DELETE');
  const beforeInvalid = await snapshot();
  await call(`/api/app/availability-schedules/${hours.yours.id}`, { ...yours, timeOff: [{ startDate: `${year}-12-27`, endDate: `${year}-12-23` }] }, 400, true, 'PUT');
  assert.deepEqual((await snapshot()).availability_schedules, beforeInvalid.availability_schedules);

  // Separate future week avoids the prior diagnostics journey's bookings and holiday dates.
  const month = sample.slice(0, 7), day = `${month}-07`;
  let monday = day;
  while (new Date(monday + 'T12:00:00Z').getUTCDay() !== 1) monday = plus(monday, 1);
  yours = scheduleInput(await data(`/api/app/availability-schedules/${hours.yours.id}`, { ...yours, blockUsHolidays: false, timeOff: [] }, 200, true, 'PUT'));
  await data('/api/app/booking-limits/host', { ...empty, weekMinutes: 240, monthCount: 10 }, 200, true, 'PUT');
  const book = (event, date, hour, email = `limits-${randomUUID()}@dial.test`, expected = 201) => data('/api/app/bookings', { idempotencyKey: randomUUID(), eventTypeId: event.id, startAt: at(date, hour), inviteeTimezone: 'UTC', name: 'Jordan Rivera', email, answers: {}, overrideNoticeAndHorizon: true }, expected, true);
  const booked = [];
  for (let index = 0; index < 4; index++) booked.push(await book(index % 2 ? second : first, plus(monday, index), 11));
  assert.ok((await diagnosis(first.id, plus(monday, 4))).exclusions.includes('host_week_minutes'));
  await book(second, plus(monday, 4), 11, undefined, 409);
  const weekOffers = await data(`/api/public/book/dial-host/${second.slug}/availability?week=${monday}`);
  assert.equal(weekOffers.slots.length, 0);
  // Rescheduling excludes only its own old duration and keeps the total at the cap.
  const moved = await data(`/api/app/bookings/${booked[0].id}/reschedule`, { startAt: at(plus(monday, 4), 11), inviteeTimezone: 'UTC' }, 200, true);
  assert.equal(moved.id, booked[0].id);
  await data('/api/app/booking-limits/host', { ...empty, monthCount: 10 }, 200, true, 'PUT');
  for (let index = 0; index < 6; index++) await book(index % 2 ? first : second, plus(monday, index), 12);
  assert.ok((await diagnosis(second.id, plus(monday, 6))).exclusions.includes('host_month_count'));
  await book(first, plus(monday, 6), 11, undefined, 409);
  await data('/api/app/booking-limits/host', empty, 200, true, 'PUT');
  await data(`/api/app/booking-limits/${first.id}`, { ...empty, dayCount: 0 }, 200, true, 'PUT');
  assert.ok((await diagnosis(first.id, plus(monday, 8))).exclusions.includes('event_day_count'));
  assert.equal((await diagnosis(second.id, plus(monday, 8))).valid, true);
  await data(`/api/app/booking-limits/${first.id}`, empty, 200, true, 'PUT');
  await data('/api/app/booking-limits/host', { ...empty, inviteeGapMinutes: 120 }, 200, true, 'PUT');
  const repeatDay = plus(monday, 8);
  await book(first, repeatDay, 11, 'repeat-client@dial.test');
  const gapDenied = await book(second, repeatDay, 12, ' Repeat-Client@dial.test ', 409);
  assert.ok(gapDenied.error.details.includes('invitee_gap'));
  await book(second, repeatDay, 12, 'different-client@dial.test');
  // AVAIL-010: the gap needs the invitee's email, so it holds at public confirmation and in a manage reschedule offer.
  const publicBase = `/api/public/book/dial-host/${first.slug}`, gapStart = at(repeatDay, 13), otherDay = plus(monday, 9);
  const publicBook = async (date, hour, email) => {
    const startAt = at(date, hour), selection = await data(`${publicBase}/selection`, { startAt, inviteeTimezone: 'UTC' }, 201);
    return { startAt, selection, payload: { nonce: selection.nonce, startAt, inviteeTimezone: 'UTC', name: 'Repeat Client', email, answers: {} } };
  };
  const manageToken = async (date, hour, email) => new URL((await data(`${publicBase}/confirm`, (await publicBook(date, hour, email)).payload, 201)).manageUrl).pathname.split('/').at(-1);
  const repeatToken = await manageToken(otherDay, 11, 'Repeat-Client@dial.test'), controlToken = await manageToken(otherDay, 12, 'gap-control@dial.test');
  const manageOffers = async token => (await data(`/api/public/manage/${token}/reschedule/availability?week=${repeatDay}`)).slots.map(slot => slot.startAt);
  assert.ok(!(await manageOffers(repeatToken)).includes(gapStart), 'the repeat invitee is not offered a time inside the gap');
  assert.ok((await manageOffers(controlToken)).includes(gapStart), 'another invitee is offered the same time');
  await call(`/api/public/manage/${repeatToken}/reschedule/selection`, { startAt: gapStart, inviteeTimezone: 'UTC' }, 409);
  await data(`/api/public/manage/${controlToken}/reschedule/selection`, { startAt: gapStart, inviteeTimezone: 'UTC' }, 201);
  const gapAttempt = await publicBook(repeatDay, 13, 'Repeat-Client@dial.test'), beforeGap = (await snapshot()).bookings.length;
  await call(`${publicBase}/confirm`, gapAttempt.payload, 409);
  assert.equal((await snapshot()).bookings.length, beforeGap, 'a refused public confirmation books nothing');
  await data(`${publicBase}/confirm`, { ...gapAttempt.payload, email: 'gap-control-two@dial.test' }, 201);
  await data('/api/app/booking-limits/host', { ...empty, dayCount: 1 }, 200, true, 'PUT');
  const raceDay = plus(monday, 10);
  const racers = await Promise.all([11, 12].map(hour => call('/api/app/bookings', { idempotencyKey: randomUUID(), eventTypeId: second.id, startAt: at(raceDay, hour), inviteeTimezone: 'UTC', name: 'Casey Morgan', email: `race-${hour}@dial.test`, answers: {}, overrideNoticeAndHorizon: true }, [201, 409], true)));
  assert.equal(racers.filter(response => response.status === 201).length, 1);
  assert.equal(racers.filter(response => response.status === 409).length, 1);
  await data('/api/app/booking-limits/host', empty, 200, true, 'PUT');
  const profile = await data('/api/app/profile', undefined, 200, true);
  await data('/api/app/profile', { ...profile, timezone: 'America/New_York' }, 200, true, 'PATCH');
  const boundary = await data('/api/app/event-types', { ...config(first), slug: 'boundary-consultation', title: 'Late evening consultation', availability: windows.map(window => ({ ...window, startMinute: 0, endMinute: 1440 })) }, 201, true);
  await data(`/api/app/event-types/${boundary.id}/publish`, {}, 200, true);
  await data(`/api/app/booking-limits/${boundary.id}`, { ...empty, monthCount: 1 }, 200, true, 'PUT');
  // These UTC starts straddle the host's month boundary, not UTC midnight.
  await book(boundary, `${year}-12-01`, 3);
  await book(boundary, `${year}-12-01`, 5);
  const boundaryDenied = await book(boundary, `${year}-12-01`, 6, undefined, 409);
  assert.ok(boundaryDenied.error.details.includes('event_month_count'));
  console.log('PASS AVAIL-011 shared hours, your hours made by an event without its own, holidays and inclusive time off from your hours on events of another schedule, individual reopen, closures refused on another schedule, duplicate binding and invalid-input nonmutation; AVAIL-010 cross-event weekly minutes/monthly counts, scoped caps, own-duration reschedule, normalized invitee gap through the operator booking, public confirm and manage reschedule offer, and concurrent last-place admission');
}

function scheduleInput(schedule) { return Object.fromEntries(['name', 'windows', 'blockUsHolidays', 'reopenedHolidays', 'timeOff'].map(key => [key, schedule[key]])); }
