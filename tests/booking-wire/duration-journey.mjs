import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bookingMail, wireMail, recipient, textBody } from "./mail-contracts.mjs";

export async function durationJourney({ data, call, state, deliver, future, checks }) {
  const event = await data('/api/app/event-types', {
    slug: 'flexible-consultation', title: 'Flexible consultation', description: 'Choose the time you need.',
    durationMinutes: 30, durationOptionsMinutes: [30, 60], color: '#176b5a', locationType: 'google_meet',
    locationLabel: 'Google Meet', locationValue: '', listed: true, alternativeRequestsEnabled: true,
    slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
    beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [],
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 720 })),
  }, 201);
  await call(`/api/app/event-types/${event.id}/details`, { ...event, availability: undefined, alternativeRequestsEnabled: undefined, durationOptionsMinutes: [15, 30, 45, 60, 90] }, 400, 'PATCH');
  await call(`/api/app/event-types/${event.id}/details`, { ...event, availability: undefined, alternativeRequestsEnabled: undefined, durationOptionsMinutes: [] }, 400, 'PATCH');
  await call(`/api/app/event-types/${event.id}/details`, { ...event, availability: undefined, alternativeRequestsEnabled: undefined, durationOptionsMinutes: [60] }, 400, 'PATCH');
  await data('/wire/control', { name: 'google-conference', value: 'success' });
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const base = `/api/public/book/dial-host/${event.slug}`;
  const offers = duration => data(`${base}/availability?week=${future}&durationMinutes=${duration}`);
  const gap = (await offers(30)).slots[0].startAt;
  await data('/api/app/bookings', { idempotencyKey: randomUUID(), eventTypeId: event.id, startAt: new Date(Date.parse(gap) + 30 * 60000).toISOString(), durationMinutes: 30, inviteeTimezone: 'UTC', name: 'Short meeting', email: 'duration-gap@dial.test', answers: {}, overrideNoticeAndHorizon: false }, 201);
  assert.ok((await offers(30)).slots.some(slot => slot.startAt === gap));
  assert.ok(!(await offers(60)).slots.some(slot => slot.startAt === gap));
  await call(`${base}/availability?week=${future}&durationMinutes=45`, undefined, 400);
  const slot = (await offers(60)).slots[0];
  const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: 'UTC', durationMinutes: 60 }, 201);
  const lookup = await data(`${base}/selection?${new URLSearchParams({ nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: 'UTC' })}`);
  assert.equal(lookup.event.durationMinutes, 60);
  const payload = { nonce: selection.nonce, startAt: slot.startAt, durationMinutes: 60, inviteeTimezone: 'UTC', name: 'Long meeting', email: 'duration-long@dial.test', answers: {} };
  const before = await state();
  await call(`${base}/confirm`, { ...payload, durationMinutes: 45 }, 400);
  assert.equal((await state()).bookings.length, before.bookings.length);
  const receipt = await data(`${base}/confirm`, payload, 201);
  await call(`${base}/confirm`, payload, 200);
  assert.equal(receipt.event.durationMinutes, 60);
  assert.equal(Date.parse(receipt.occurrence.endAt) - Date.parse(receipt.occurrence.startAt), 60 * 60000);
  await deliver();
  let snapshot = await state();
  const booking = snapshot.bookings.find(row => row.invitee_email === payload.email);
  assert.equal(booking.duration_minutes, 60);
  const writes = snapshot.wire_calls.filter(row => ['POST', 'PATCH'].includes(row.method) && new URL(row.url).pathname.includes('/events'));
  assert.ok(writes.some(row => { const body = JSON.parse(row.body); return body.extendedProperties?.private?.["dial-booking-id"] === booking.id && Date.parse(body.end.dateTime) - Date.parse(body.start.dateTime) === 60 * 60000; }));
  const ics = await (await call(new URL(receipt.icsUrl).pathname)).text();
  const ical = value => new Date(value).toISOString().slice(0,19).replaceAll('-','').replaceAll(':','') + 'Z';
  assert.ok(ics.includes(`DTSTART:${ical(receipt.occurrence.startAt)}`));
  assert.ok(ics.includes(`DTEND:${ical(receipt.occurrence.endAt)}`));
  const confirmations = bookingMail(snapshot, booking.id).filter(mail => mail.subject.startsWith('Confirmed:'));
  assert.equal(confirmations.length, 1); assert.ok(textBody(confirmations[0]).includes('60 minutes'));
  const reminder = snapshot.delivery_outbox.find(row => row.booking_id === booking.id && row.kind === 'reminder');
  await call('/__fixtures/due', { id: reminder.id }, 204); await deliver();
  assert.ok(wireMail(await state()).some(mail => mail.subject === `Reminder: ${event.title}` && recipient(mail).includes(JSON.parse(reminder.payload_json).to) && textBody(mail).includes('60 minutes')));
  const token = new URL(receipt.manageUrl).pathname.split('/').at(-1);
  const available = await data(`/api/public/manage/${token}/reschedule/availability?week=${future}`);
  assert.ok(available.slots.every(row => Date.parse(row.endAt) - Date.parse(row.startAt) === 60 * 60000));
  const newSlot = available.slots.find(row => row.startAt !== slot.startAt);
  const selected = await data(`/api/public/manage/${token}/reschedule/selection`, { startAt: newSlot.startAt, inviteeTimezone: 'UTC' }, 201);
  const moved = await data(`/api/public/manage/${token}/reschedule`, { nonce: selected.nonce, startAt: newSlot.startAt, inviteeTimezone: 'UTC' });
  assert.equal(moved.event.durationMinutes, 60); assert.equal(moved.manageUrl, receipt.manageUrl);
  // EVENT-011: a reschedule may change the length only to another offered option, revalidated as a new slot.
  const manage = `/api/public/manage/${token}`, shortOffers = (await data(`${manage}/reschedule/availability?week=${future}&durationMinutes=30`)).slots;
  assert.ok(shortOffers.length && shortOffers.every(row => Date.parse(row.endAt) - Date.parse(row.startAt) === 30 * 60000));
  await call(`${manage}/reschedule/availability?week=${future}&durationMinutes=45`, undefined, 400);
  const shortSlot = shortOffers[0], shortChange = { startAt: shortSlot.startAt, inviteeTimezone: 'UTC' };
  await call(`${manage}/reschedule/selection`, { startAt: new Date(Date.parse(gap) + 30 * 60000).toISOString(), inviteeTimezone: 'UTC', durationMinutes: 30 }, 409);
  const unchanged = snap => JSON.stringify([snap.bookings, snap.booking_occurrences, snap.delivery_outbox.length]), beforeCrafted = unchanged(await state());
  await call(`${manage}/reschedule/selection`, { ...shortChange, durationMinutes: 45 }, 400);
  const shortSelected = await data(`${manage}/reschedule/selection`, { ...shortChange, durationMinutes: 30 }, 201);
  await call(`${manage}/reschedule`, { ...shortChange, nonce: shortSelected.nonce, durationMinutes: 45 }, 400);
  assert.equal(unchanged(await state()), beforeCrafted);
  const shortened = await data(`${manage}/reschedule`, { ...shortChange, nonce: shortSelected.nonce, durationMinutes: 30 });
  assert.equal(shortened.event.durationMinutes, 30);
  assert.equal(Date.parse(shortened.occurrence.endAt) - Date.parse(shortened.occurrence.startAt), 30 * 60000);
  assert.equal((await state()).bookings.find(row => row.id === booking.id).duration_minutes, 30);
  await deliver();
  // EVENT-001: an edited slug is not retained, the old one answers per PUBLIC-005, and existing manage links keep working.
  const renamed = await data(`/api/app/event-types/${event.id}/details`, { ...event, availability: undefined, alternativeRequestsEnabled: undefined, slug: 'flexible-renamed' }, 200, 'PATCH');
  assert.equal(renamed.slug, 'flexible-renamed');
  await call(`/api/public/events/dial-host/${event.slug}`, undefined, 404);
  await call(`${base}/availability?week=${future}`, undefined, 404);
  assert.equal((await data('/api/public/events/dial-host/flexible-renamed')).eventType.slug, 'flexible-renamed');
  assert.equal((await data(manage)).state, 'rescheduled');
  assert.ok((await data(`${manage}/reschedule/availability?week=${future}`)).slots.length);
  const overrideDate = new Date(Date.parse(future + 'T12:00:00Z') + 2 * 86400000).toISOString().slice(0,10);
  await data(`/api/app/event-types/${event.id}/availability-overrides/${overrideDate}`, { mode: 'open', windows: [{ startMinute: 600, endMinute: 660 }] }, 200, 'PUT');
  const copy = await data(`/api/app/event-types/${event.id}/duplicate`, {}, 201);
  assert.equal(copy.status, 'draft'); assert.equal(copy.title, event.title + ' (copy)'); assert.notEqual(copy.slug, event.slug);
  assert.deepEqual(copy.durationOptionsMinutes, [30,60]); assert.deepEqual(copy.availability, event.availability);
  const overrides = await data(`/api/app/event-types/${copy.id}/availability-overrides`);
  assert.deepEqual(overrides.map(({hostDate,mode,windows}) => ({hostDate,mode,windows})), [{hostDate:overrideDate,mode:'open',windows:[{startMinute:600,endMinute:660}]}]);
  await call(`/api/public/events/dial-host/${copy.slug}`, undefined, 404);
  snapshot = await state();
  assert.equal(snapshot.bookings.filter(row => row.event_type_id === copy.id).length, 0);
  assert.equal(snapshot.availability_requests.filter(row => row.event_type_id === copy.id).length, 0);
  checks.push('EVENT-011: offered duration drives gaps, nonce binding, stored length, Google/Meet interval, mail, reminders, reschedule to the other offered length revalidated as a new slot and an unoffered 45 refused with no change; EVENT-001: an edited slug answers 404 under the old one while the existing manage link keeps working; EVENT-001: duplicate is a private draft with settings and remapped overrides but no history');
}
