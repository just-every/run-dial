import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingMail, textBody, wireMail } from './mail-contracts.mjs';

export async function bookingPolicyJourney({ data, call, state, deliver, checks }) {
  const event = await data('/api/app/event-types', {
    slug: 'new-york-visit', title: 'New York studio visit', description: 'Meet at the studio.',
    durationMinutes: 30, color: '#176b5a', locationType: 'in_person', locationLabel: 'Studio', locationValue: 'Manhattan studio',
    listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
    beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [],
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
  }, 201);
  const policy = { lockedTimezone: 'America/New_York', rescheduleCutoffMinutes: 1440, cancellationCutoffMinutes: 1440, maxInviteeReschedules: 2 };
  await data(`/api/app/event-types/${event.id}/booking-policy`, policy, 200, 'PUT');
  await call(`/api/app/event-types/${event.id}/booking-policy`, { ...policy, lockedTimezone: 'not/a-zone' }, 400, 'PUT');
  assert.deepEqual(await data(`/api/app/event-types/${event.id}/booking-policy`), policy);
  const copy = await data(`/api/app/event-types/${event.id}/duplicate`, {}, 201);
  assert.deepEqual(copy.bookingPolicy, policy);
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const base = `/api/public/book/dial-host/${event.slug}`;
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const offers = await data(`${base}/availability?week=${tomorrow}`);
  const within = (low, high) => offers.slots.filter(slot => { const hours = (Date.parse(slot.startAt) - Date.now()) / 3600000; return hours > low && hours < high; });
  const next = within(25, 28);
  assert.ok(next.length >= 4);
  const book = async (slot, email) => {
    const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: 'America/Los_Angeles' }, 201);
    return data(`${base}/confirm`, { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: 'America/Los_Angeles', name: 'Taylor Morgan', email, answers: {} }, 201);
  };
  const receipt = await book(next[0], 'locked-visit@dial.test');
  const token = new URL(receipt.manageUrl).pathname.split('/').at(-1), manage = `/api/public/manage/${token}`;
  assert.equal(receipt.lockedTimezone, policy.lockedTimezone); assert.equal(receipt.browserTimezone, 'America/Los_Angeles');
  assert.equal(receipt.changePolicy.effectivePolicy.maxInviteeReschedules, 2);
  await deliver();
  let snap = await state();
  const booking = snap.bookings.find(row => row.invitee_email === 'locked-visit@dial.test');
  assert.deepEqual(snap.booking_presentation.find(row => row.booking_id === booking.id), { booking_id: booking.id, locked_timezone: policy.lockedTimezone, browser_timezone: 'America/Los_Angeles', created_at: booking.created_at, updated_at: booking.created_at });
  const confirmation = bookingMail(snap, booking.id).find(mail => mail.subject.startsWith('Confirmed:'));
  assert.ok(textBody(confirmation).includes('America/New_York')); assert.match(textBody(confirmation), /UTC-04:00/);
  assert.ok(textBody(confirmation).includes('America/Los_Angeles'));
  const reminder = snap.delivery_outbox.find(row => row.booking_id === booking.id && row.kind === 'reminder' && JSON.parse(row.payload_json).recipientRole === 'invitee');
  assert.ok(reminder);
  await call('/__fixtures/due', { id: reminder.id }, 204); await deliver();
  const reminderMail = wireMail(await state()).find(mail => mail.subject === `Reminder: ${event.title}`);
  assert.ok(reminderMail); assert.ok(textBody(reminderMail).includes('America/New_York')); assert.match(textBody(reminderMail), /UTC-04:00/);
  const ics = await (await call(new URL(receipt.icsUrl).pathname)).text();
  assert.ok(ics.includes('TZID:America/New_York')); assert.ok(ics.includes('DTSTART;TZID=America/New_York:'));
  assert.ok(ics.includes('TZOFFSETTO:-0400')); assert.ok(ics.includes('TZOFFSETTO:-0500'));
  let last;
  for (const slot of next.slice(1, 3)) {
    const selection = await data(`${manage}/reschedule/selection`, { startAt: slot.startAt, inviteeTimezone: 'America/Los_Angeles' }, 201);
    last = { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: 'America/Los_Angeles' };
    await data(`${manage}/reschedule`, last);
  }
  const beforeCap = await state();
  assert.equal((await data(`${manage}/reschedule/selection`, { startAt: next[3].startAt, inviteeTimezone: 'America/Los_Angeles' }, 409)).error.code, 'reschedule_limit');
  await data(`${manage}/reschedule`, last); // completed command remains replayable after reaching the cap
  assert.deepEqual((await state()).booking_history, beforeCap.booking_history);
  assert.equal((await data(manage)).changePolicy.rescheduleReason, 'reschedule_limit');

  const near = within(23, 24)[0]; assert.ok(near);
  const nearReceipt = await book(near, 'cutoff-visit@dial.test');
  const nearToken = new URL(nearReceipt.manageUrl).pathname.split('/').at(-1), nearManage = `/api/public/manage/${nearToken}`;
  const nearBooking = (await state()).bookings.find(row => row.invitee_email === 'cutoff-visit@dial.test');
  const beforeDenied = await state();
  for (const [path, body, reason] of [
    [`${nearManage}/reschedule/selection`, { startAt: next[3].startAt, inviteeTimezone: 'America/Los_Angeles' }, 'reschedule_cutoff'],
    [`${nearManage}/reschedule`, { nonce: 'unused', startAt: next[3].startAt, inviteeTimezone: 'America/Los_Angeles' }, 'reschedule_cutoff'],
    [`${nearManage}/cancel`, {}, 'cancellation_cutoff'],
  ]) assert.equal((await data(path, body, 409)).error.code, reason);
  const afterDenied = await state();
  for (const table of ['bookings', 'booking_occurrences', 'booking_history', 'delivery_outbox', 'wire_calls']) assert.deepEqual(afterDenied[table], beforeDenied[table], `cut-off refusal preserves ${table}`);
  assert.equal((await data(nearManage)).changePolicy.cancellationAllowed, false);
  const key = randomUUID();
  await data(`${nearManage}/contact-host`, { idempotencyKey: key, message: 'My flight changed; can we move this visit?' });
  await data(`${nearManage}/contact-host`, { idempotencyKey: key, message: 'My flight changed; can we move this visit?' });
  await deliver();
  snap = await state();
  const contact = wireMail(snap).filter(mail => mail.subject === `Message about ${event.title}`);
  assert.equal(contact.length, 1); assert.equal(contact[0].reply_to.email, 'cutoff-visit@dial.test');
  const moved = await data(`/api/app/bookings/${nearBooking.id}/reschedule`, { startAt: next[3].startAt, inviteeTimezone: 'America/Los_Angeles' });
  assert.equal(moved.id, nearBooking.id, 'operator bypasses invitee cut-off');
  let foldYear = new Date().getUTCFullYear();
  const foldDate = year => { const first = new Date(`${year}-11-01T12:00:00Z`); first.setUTCDate(1 + (7 - first.getUTCDay()) % 7); return first.toISOString().slice(0,10); };
  if (Date.parse(foldDate(foldYear) + 'T06:30:00Z') <= Date.now()) foldYear++;
  const foldStart = foldDate(foldYear) + 'T06:30:00.000Z';
  const foldBooking = await data('/api/app/bookings', { idempotencyKey: randomUUID(), eventTypeId: event.id, startAt: foldStart, inviteeTimezone: 'America/Los_Angeles', name: 'Jordan Rivera', email: 'second-fold@dial.test', answers: {}, overrideNoticeAndHorizon: true }, 201);
  const foldCommands = (await state()).delivery_outbox.filter(row => row.booking_id === foldBooking.id);
  const foldManage = JSON.parse(foldCommands.find(row => row.kind === 'mail_send' && JSON.parse(row.payload_json).recipientRole === 'invitee').payload_json).manageUrl;
  const foldIcs = await (await call(`/api/public/manage/${new URL(foldManage).pathname.split('/').at(-1)}/calendar.ics`)).text();
  assert.ok(foldIcs.includes('DTSTART:' + foldStart.slice(0,19).replaceAll('-','').replaceAll(':','') + 'Z'));
  assert.ok(foldIcs.includes('UTC-05:00'), 'later repeated wall-clock time preserves its UTC instant and explicit locked offset');
  // A newly edited lock never changes a previously booked location zone.
  await data(`/api/app/event-types/${event.id}/booking-policy`, { ...policy, lockedTimezone: 'Europe/London' }, 200, 'PUT');
  assert.equal((await data(manage)).lockedTimezone, 'America/New_York');
  checks.push('AVAIL-012 locked zone and browser zone persist; mail/ICS carry New York; BOOK-015 per-event cut-offs/cap refuse without effects, replay succeeds, direct contact sends once with invitee Reply-To, operator bypass and duplicate policy');
}
