import assert from 'node:assert/strict';
import { bookingMail, textBody, recipient } from './mail-contracts.mjs';

export async function correspondenceJourney({ data, call, state, deliver, future, checks }) {
  const event = await data('/api/app/event-types', { slug: 'commission-planning', title: 'Commission planning', description: 'Plan a piece for your space.', durationMinutes: 30, color: '#176b5a', locationType: 'fixed_link', locationLabel: 'Video call', locationValue: 'https://meet.example.test/commission', listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [{ kind: 'text', label: 'Project goals', required: true, private: false, options: [] }, { kind: 'text', label: 'Private budget', required: false, private: true, options: [] }], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 780, endMinute: 1020 })) }, 201);
  const [goal, budget] = event.questions;
  const config = { inviteeConfirmationEnabled: true, templates: { rescheduleRequestSubject: null, rescheduleRequestBody: null, rescheduleRequestReminderSubject: null, rescheduleRequestReminderBody: null, calendarTitle: '{invitee full name} & {host name}', calendarDescription: `Project: {event name}\nWhen: {date and time}\nJoin: {location}\nGoals: {answer.${goal.key}}`, confirmationSubject: 'Your studio session, {invitee first name}', confirmationBody: `Hello {invitee first name},\nWe are looking forward to {event name}.\n{date and time}\n{location}\nBudget: {answer.${budget.key}}\n{manage link}`, rescheduleSubject: 'Updated studio time for {invitee first name}', rescheduleBody: 'The new studio time is {date and time}.\n{message}\n{manage link}', cancellationSubject: 'Studio session cancelled for {invitee first name}', cancellationBody: 'Your studio session is cancelled.\n{message}\n{manage link}', reminderSubject: 'See you soon, {invitee first name}', reminderBody: 'Your studio session starts at {date and time}.\n{location}\n{manage link}' } };
  const saved = await data(`/api/app/event-types/${event.id}/correspondence`, config, 200, 'PUT');
  assert.deepEqual(saved, config);
  const beforeInvalid = (await state()).event_correspondence;
  const unknown = await data(`/api/app/event-types/${event.id}/correspondence`, { templates: { ...config.templates, confirmationBody: 'Hello {unknown}' } }, 400, 'PUT');
  assert.ok(unknown.error.message.includes('unknown'));
  const secret = await data(`/api/app/event-types/${event.id}/correspondence`, { templates: { ...config.templates, calendarDescription: `{answer.${budget.key}}` } }, 400, 'PUT');
  assert.ok(secret.error.message.includes('private'));
  const sharedCapability = await data(`/api/app/event-types/${event.id}/correspondence`, { templates: { ...config.templates, calendarDescription: '{manage link}' } }, 400, 'PUT');
  assert.ok(sharedCapability.error.message.includes('manage link'));
  assert.deepEqual((await state()).event_correspondence, beforeInvalid);
  const removeQuestion = await data(`/api/app/event-types/${event.id}/details`, { ...event, questions: [budget], availability: undefined, alternativeRequestsEnabled: undefined }, 400, 'PATCH');
  assert.equal(removeQuestion.error.code, 'template_question_in_use');
  const duplicate = await data(`/api/app/event-types/${event.id}/duplicate`, {}, 201);
  assert.deepEqual(await data(`/api/app/event-types/${duplicate.id}/correspondence`), config);
  await data(`/api/app/event-types/${event.id}/booking-policy`, { lockedTimezone: "America/New_York" }, 200, "PUT");
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const base = `/api/public/book/dial-host/${event.slug}`;
  const offers = await data(`${base}/availability?week=${future}`), slot = offers.slots[0]; assert.ok(slot);
  const selected = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: 'America/Los_Angeles' }, 201);
  const receipt = await data(`${base}/confirm`, { nonce: selected.nonce, startAt: slot.startAt, inviteeTimezone: 'America/Los_Angeles', name: 'Taylor Morgan', email: 'templates@dial.test', answers: { [goal.key]: 'A sculpture for our library', [budget.key]: 'Private budget 4200' } }, 201);
  await deliver(); let snap = await state();
  const booking = snap.bookings.find(row => row.invitee_email === 'templates@dial.test');
  assert.ok(snap.booking_correspondence.some(row => row.booking_id === booking.id));
  const confirmations = bookingMail(snap, booking.id).filter(mail => recipient(mail).includes('templates@dial.test'));
  assert.equal(confirmations.length, 1); assert.equal(confirmations[0].subject, 'Your studio session, Taylor');
  assert.ok(textBody(confirmations[0]).startsWith('Hello Taylor,')); assert.ok(textBody(confirmations[0]).includes('America/New_York')); assert.match(textBody(confirmations[0]), /UTC-04:00/); assert.ok(textBody(confirmations[0]).includes('Private budget 4200')); assert.ok(!textBody(confirmations[0]).includes('Invitee time:'));
  const calendarWrite = snap.wire_calls.find(row => row.method === 'POST' && new URL(row.url).pathname.includes('/events') && JSON.parse(row.body).extendedProperties?.private?.['dial-booking-id'] === booking.id);
  assert.ok(calendarWrite); const calendar = JSON.parse(calendarWrite.body);
  assert.equal(calendar.summary, `Taylor Morgan & ${receipt.host.name}`); assert.equal(calendar.start.timeZone, 'America/New_York'); assert.ok(calendar.description.includes('A sculpture for our library')); assert.ok(calendar.description.includes('https://meet.example.test/commission')); assert.ok(!calendar.description.includes('Private budget 4200')); assert.ok(!calendar.description.includes('/manage/'));
  const reminder = snap.delivery_outbox.find(row => row.booking_id === booking.id && row.kind === 'reminder' && JSON.parse(row.payload_json).recipientRole === 'invitee');
  await call('/__fixtures/due', { id: reminder.id }, 204); await deliver(); snap = await state();
  const reminderSend = snap.wire_calls.filter(row => new URL(row.url).pathname === '/v3/mail/send').map(row => JSON.parse(row.body)).find(mail => mail.subject === 'See you soon, Taylor');
  assert.ok(reminderSend); assert.ok(textBody(reminderSend).includes('America/New_York'));
  const token = new URL(receipt.manageUrl).pathname.split('/').at(-1), manage = `/api/public/manage/${token}`;
  const availability = await data(`${manage}/reschedule/availability?week=${future}`), newSlot = availability.slots.find(candidate => candidate.startAt !== slot.startAt); assert.ok(newSlot);
  const newSelection = await data(`${manage}/reschedule/selection`, { startAt: newSlot.startAt, inviteeTimezone: 'America/Los_Angeles' }, 201);
  await data(`${manage}/reschedule`, { nonce: newSelection.nonce, startAt: newSlot.startAt, inviteeTimezone: 'America/Los_Angeles', reason: 'A new delivery date' }); await deliver(); snap = await state();
  const changed = bookingMail(snap, booking.id).filter(mail => mail.subject === 'Updated studio time for Taylor'); assert.equal(changed.length, 1); assert.ok(textBody(changed[0]).includes('A new delivery date'));
  const patches = snap.wire_calls.filter(row => row.method === 'PATCH' && new URL(row.url).pathname.includes('/events') && JSON.parse(row.body).extendedProperties?.private?.['dial-booking-id'] === booking.id);
  assert.equal(patches.length, 1); const patch = JSON.parse(patches[0].body); assert.equal(patch.summary, calendar.summary); assert.notEqual(patch.description, calendar.description);
  // The last saved templates survive offer deletion for the booking's later cancellation.
  await call(`/api/app/event-types/${event.id}`, undefined, 204, 'DELETE');
  assert.deepEqual(JSON.parse((await state()).booking_correspondence.find(row => row.booking_id === booking.id).templates_json), config);
  await data(`${manage}/cancel`, { reason: 'Travel plans changed' }); await deliver(); snap = await state();
  const cancelled = bookingMail(snap, booking.id).filter(mail => mail.subject === 'Studio session cancelled for Taylor'); assert.equal(cancelled.length, 1); assert.ok(textBody(cancelled[0]).includes('Travel plans changed'));
  checks.push('NOTIFY-009/CAL-003 configured calendar title/description and invitee confirmation/reminder/change/cancel replace built-ins; private calendar answers and shared manage capabilities refuse; unknown variables and question removal refuse without mutation; duplicate and deleted-offer retention persist');
}

/** NOTIFY-001: use the public booking door, including mail-first queue order. */
export async function confirmationChoiceJourney({ data, call, state, deliver, future, checks }) {
  await data('/wire/control', { name: 'mail-ambiguous', value: 0 });
  const event = await data('/api/app/event-types', {
    slug: 'confirmation-choice', title: 'Design consultation', description: 'Discuss your next design.',
    durationMinutes: 30, color: '#176b5a', locationType: 'fixed_link', locationLabel: 'Video call', locationValue: 'https://meet.example.test/design',
    listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
    beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [],
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 240, endMinute: 480 })),
  }, 201);
  const path = `/api/app/event-types/${event.id}/correspondence`;
  const config = await data(path);
  assert.equal(config.inviteeConfirmationEnabled, true, 'NOTIFY-001: existing and new offers send Dial confirmation by default');
  config.inviteeConfirmationEnabled = false;
  await data(path, config, 200, 'PUT');
  const copy = await data(`/api/app/event-types/${event.id}/duplicate`, {}, 201);
  assert.equal((await data(`/api/app/event-types/${copy.id}/correspondence`)).inviteeConfirmationEnabled, false);
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const base = `/api/public/book/dial-host/${event.slug}`;
  for (const kind of ['connected', 'failed', 'optional']) {
    if (kind === 'optional') await call('/api/app/calendar/connection', undefined, 204, 'DELETE');
    const slot = (await data(`${base}/availability?week=${future}`)).slots[0]; assert.ok(slot);
    const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: 'America/Los_Angeles' }, 201);
    const email = `confirmation-${kind}@dial.test`;
    const receipt = await data(`${base}/confirm`, { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: 'America/Los_Angeles', name: 'Avery Chen', email, answers: {} }, 201);
    let snap = await state();
    const booking = snap.bookings.find(row => row.id === receipt.bookingReference); assert.ok(booking);
    const mail = snap.delivery_outbox.find(row => row.booking_id === booking.id && row.kind === 'mail_send' && JSON.parse(row.payload_json).recipientRole === 'invitee'); assert.ok(mail);
    if (kind === 'failed') await data('/wire/control', { name: 'google-mutation-status', value: 403 });
    // The invitee command deliberately arrives before the calendar command.
    await data('/__fixtures/deliver', { id: mail.id });
    if (kind === 'failed') await data('/wire/control', { name: 'google-mutation-status', value: 0 });
    await deliver(); snap = await state();
    const sends = bookingMail(snap, booking.id);
    const invitee = sends.filter(message => recipient(message).includes(email));
    assert.equal(invitee.length, kind === 'connected' ? 0 : 1, `NOTIFY-001: ${kind} calendar invitee confirmation count`);
    assert.equal(sends.filter(message => recipient(message).includes('operator@dial.test')).length, 1, 'the switch never mutes host confirmation');
    assert.ok(snap.delivery_outbox.some(row => row.booking_id === booking.id && row.kind === 'reminder' && JSON.parse(row.payload_json).recipientRole === 'invitee'), 'the switch preserves invitee reminders');
    const deliveries = await data(`/api/app/bookings/${booking.id}/deliveries`);
    assert.equal(deliveries.find(row => row.id === mail.id).state, kind === 'connected' ? 'suppressed' : 'succeeded');
    if (kind === 'connected') {
      const write = snap.wire_calls.find(row => row.method === 'POST' && new URL(row.url).pathname.includes('/events') && JSON.parse(row.body).extendedProperties?.private?.['dial-booking-id'] === booking.id); assert.ok(write);
      assert.equal(new URL(write.url).searchParams.get('sendUpdates'), 'all');
      assert.ok(JSON.parse(write.body).attendees.some(attendee => attendee.email === email));
      assert.ok(!snap.base_mail_dispatch.some(row => row.delivery_id === mail.idempotency_key), 'suppression never invokes mail transport');
    } else {
      assert.ok(textBody(invitee[0]).includes('/manage/'));
      assert.ok(invitee[0].attachments.some(attachment => attachment.filename === 'booking.ics'));
      const managePath = new URL(receipt.manageUrl).pathname.replace('/manage/', '/api/public/manage/');
      assert.equal((await data(managePath)).calendarState, kind === 'failed' ? 'failed' : 'not_required');
    }
    const sent = snap.wire_calls.length;
    await data('/__fixtures/deliver', { id: mail.id });
    assert.equal((await state()).wire_calls.length, sent, 'queue redelivery never repeats confirmation or its calendar write');
  }
  checks.push('NOTIFY-001 default-on and duplicated per-event switch; mail-first calendar success suppresses Dial invitee mail with honest status, failed writes and no-calendar bookings each send one confirmation with manage link and .ics; host mail and reminders survive');
}
