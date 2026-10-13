import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { saved } from './move-in/runtime.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';
import { cleanupOrdering } from './move-in/cleanup-ordering.mjs';

contract('BOOK-009', '[DATA-002] import stays inert; native reschedule authority survives undo and erasure fences queued and late calendar effects', async () => {
  const rt = await bookingRuntime();
  try {
    const rows = async (table, bookingId) => (await (table.startsWith("wire_") ? rt.providerDb : rt.db).prepare(`SELECT * FROM ${table}${bookingId ? ' WHERE booking_id = ?' : ''}`).bind(...(bookingId ? [bookingId] : [])).all()).results;
    const complete = async current => { for (let n = 0; !['completed', 'undone'].includes(current.job.state) && n < 60; n++) current = await rt.data(`/api/app/move-in/jobs/${current.job.id}/resume`, {}); assert.ok(['completed', 'undone'].includes(current.job.state)); return current; };
    const files = await saved('solo');
    const preview = await rt.upload('preview', files);
    const applied = await complete(await rt.upload('apply', files, { fingerprint: preview.report.fingerprint, acknowledged: true }));
    for (const table of ['delivery_outbox', 'delivery_attempts', 'base_mail_dispatch', 'wire_calls', 'calendar_connections']) assert.equal((await rows(table)).length, 0, `import must not create ${table}`);
    assert.equal((await rt.data('/__queue-count')).queueCalls, 0);
    const imported = await rt.data('/api/app/bookings');
    assert.ok(imported.length > 1 && imported.every(booking => booking.state === 'confirmed'));
    assert.ok((await rows('bookings')).every(booking => booking.imported === 1));
    const booking = imported.find(booking => booking.locationType === 'in_person') ?? imported[0];
    const inert = imported.find(other => other.eventTypeId !== booking.eventTypeId);
    assert.ok(inert);
    const inertErase = await rt.data(`/api/app/bookings/${inert.id}`, undefined, 202, 'DELETE');
    assert.equal(inertErase.calendarCleanup, 'completed');
    assert.equal((await rows('erased_calendar_targets', inert.id)).length, 0);
    for (const table of ['delivery_outbox', 'delivery_attempts', 'wire_calls']) assert.equal((await rows(table)).length, 0);
    assert.equal((await rt.data('/__queue-count')).queueCalls, 0);
    const originalTokens = await rows('booking_manage_tokens', booking.id);
    assert.equal(originalTokens.length, 1);

    // Real credentials are synthetic at the Google/SendGrid wire boundary only.
    await rt.data('/__fixtures/setup', {});
    const event = await rt.data(`/api/app/event-types/${booking.eventTypeId}`);
    await rt.data(`/api/app/event-types/${event.id}/availability`, { windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 200, 'PUT');
    await rt.data(`/api/app/event-types/${event.id}/publish`, {});
    const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const availability = await rt.data(`/api/public/book/dial-host/${event.slug}/availability?week=${week}`);
    assert.ok(availability.slots.length > 6);
    const move = { startAt: availability.slots[0].startAt, inviteeTimezone: 'America/New_York', reason: 'Owner moved imported booking', overridePublishedAvailability: false };
    const endpoint = `/api/app/bookings/${booking.id}/reschedule`;
    const unauthorised = await rt.api(endpoint, { method: 'POST', headers: { cookie: '', 'content-type': 'application/json' }, body: JSON.stringify(move) });
    assert.equal(unauthorised.status, 401);

    // Failure inside the native transaction cannot publish a replacement token or mail.
    await rt.db.prepare(`CREATE TRIGGER refuse_test_reschedule BEFORE INSERT ON delivery_outbox WHEN NEW.booking_id = '${booking.id}' BEGIN SELECT RAISE(ABORT, 'test outbox unavailable'); END`).run();
    const failed = await rt.api(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(move) });
    assert.equal(failed.status, 503);
    assert.deepEqual(await rows('booking_manage_tokens', booking.id), originalTokens);
    assert.equal((await rt.data(`/api/app/bookings/${booking.id}`)).occurrence.id, booking.occurrence.id);
    assert.equal((await rows('delivery_outbox', booking.id)).length, 0);
    await rt.db.prepare('DROP TRIGGER refuse_test_reschedule').run();

    const changed = await rt.data(endpoint, move);
    assert.equal(changed.occurrence.startAt, move.startAt);
    assert.equal(changed.imported, 1);
    assert.ok(changed.history.some(entry => entry.action === 'rescheduled' && entry.actorType === 'operator'));
    const tokens = await rows('booking_manage_tokens', booking.id);
    assert.equal(tokens.length, 2); assert.ok(tokens.find(token => token.id === originalTokens[0].id).rotated_at);
    assert.equal(tokens.filter(token => !token.rotated_at && !token.invalidated_at).length, 1);
    const outbox = await rows('delivery_outbox', booking.id);
    assert.equal(outbox.filter(row => row.kind === 'calendar_upsert').length, 1);
    const messages = outbox.filter(row => row.kind === 'mail_send').map(row => JSON.parse(row.payload_json));
    assert.ok(messages.some(mail => mail.recipientRole === 'operator'));
    const invitee = messages.find(mail => mail.recipientRole === 'invitee');
    assert.ok(invitee?.manageUrl);
    const token = new URL(invitee.manageUrl).pathname.split('/').at(-1);
    const manage = `/api/public/manage/${token}`;
    assert.equal((await rt.data(manage)).occurrence.startAt, move.startAt);
    assert.equal((await rt.api(`${manage}/calendar.ics`)).status, 200);

    // Existing holder reschedules through the native nonce and keeps their link.
    const nextStart = availability.slots[2].startAt;
    const selection = await rt.data(`${manage}/reschedule/selection`, { startAt: nextStart, inviteeTimezone: 'America/New_York' }, 201);
    const request = { nonce: selection.nonce, startAt: nextStart, inviteeTimezone: 'America/New_York', reason: 'Invitee follows up' };
    await rt.data(`${manage}/reschedule`, request);
    const afterPublic = await rows('delivery_outbox', booking.id);
    await rt.data(`${manage}/reschedule`, request);
    assert.equal(JSON.stringify(await rows('delivery_outbox', booking.id)) === JSON.stringify(afterPublic), true, 'nonce replay must not enqueue another delivery');
    assert.equal((await rt.data(manage)).occurrence.startAt, nextStart);
    assert.equal((await rows('booking_manage_tokens', booking.id)).length, 2);
    assert.ok(afterPublic.filter(row => row.kind === 'mail_send').map(row => JSON.parse(row.payload_json)).filter(mail => mail.recipientRole === 'invitee').every(mail => mail.manageUrl === invitee.manageUrl));

    // Rotation before the first notification also supports the public holder.
    const untouched = imported.find(other => other.id !== booking.id && other.eventTypeId === booking.eventTypeId);
    assert.ok(untouched, 'fixture has a second booking on the same event');
    {
      const rotated = await rt.data(`/api/app/bookings/${untouched.id}/manage-link/rotate`, {});
      const secondManage = `/api/public/manage/${new URL(rotated.manageUrl).pathname.split('/').at(-1)}`;
      const selected = await rt.data(`${secondManage}/reschedule/selection`, { startAt: availability.slots[4].startAt, inviteeTimezone: 'America/New_York' }, 201);
      await rt.data(`${secondManage}/reschedule`, { nonce: selected.nonce, startAt: availability.slots[4].startAt, inviteeTimezone: 'America/New_York' });
      assert.equal((await rt.data(secondManage)).occurrence.startAt, availability.slots[4].startAt);
    }
    // A queued native upsert is authority even before Google has returned an ID.
    const pending = (await rows('bookings')).find(row => row.id === untouched.id);
    assert.equal(pending.calendar_provider_event_id, null);
    assert.ok((await rows('delivery_outbox', pending.id)).some(row => row.kind === 'calendar_upsert' && row.state === 'pending'));
    const pendingErase = await rt.data(`/api/app/bookings/${pending.id}`, undefined, 202, 'DELETE');
    assert.equal(pendingErase.calendarCleanup, 'pending');
    assert.equal((await rows('erased_calendar_targets', pending.id)).length, 1);
    assert.deepEqual((await rows('delivery_outbox', pending.id)).map(row => row.kind), ['calendar_cancel']);

    // Hold the paid request after native claim, erase and finish initial cleanup,
    // then allow the old Google request to create its event after local deletion.
    const racing = imported.find(other => other.id !== booking.id && other.id !== pending.id && other.eventTypeId === booking.eventTypeId);
    assert.ok(racing);
    await rt.data(`/api/app/bookings/${racing.id}/reschedule`, { ...move, startAt: availability.slots[6].startAt });
    const raceCommand = (await rows('delivery_outbox', racing.id)).find(row => row.kind === 'calendar_upsert');
    await rt.hold('late-upsert', raceCommand.id, 'upsert');
    assert.equal((await rows('delivery_outbox', racing.id)).find(row => row.id === raceCommand.id).state, 'processing');
    assert.equal((await rows('bookings')).find(row => row.id === racing.id).calendar_provider_event_id, null);
    const raceErase = await rt.data(`/api/app/bookings/${racing.id}`, undefined, 202, 'DELETE');
    assert.equal(raceErase.calendarCleanup, 'pending');
    const raceCancel = (await rows('delivery_outbox', racing.id)).find(row => row.kind === 'calendar_cancel');
    await rt.data('/__fixtures/deliver', { id: raceCancel.id });
    assert.ok((await rt.data(`/api/app/erasures/${racing.id}`)).completedAt);
    assert.equal(await rt.release('late-upsert'), 'succeeded');
    assert.equal((await rt.data(`/api/app/erasures/${racing.id}`)).completedAt, null, 'late provider completion reopens cleanup');
    assert.equal((await rows('bookings')).some(row => row.id === racing.id), false);
    assert.equal((await rows('delivery_outbox', racing.id)).some(row => row.kind !== 'calendar_cancel'), false);
    await rt.data('/__fixtures/deliver', {});
    const racedEvent = (await rows('wire_events')).map(row => JSON.parse(row.payload)).find(event => event.extendedProperties.private['dial-booking-id'] === racing.id);
    assert.equal(racedEvent.status, 'cancelled');
    assert.ok((await rt.data(`/api/app/erasures/${racing.id}`)).completedAt);
    assert.ok((await rt.data(`/api/app/erasures/${pending.id}`)).completedAt);
    const sent = (await rows('wire_calls')).filter(call => new URL(call.url).pathname === '/v3/mail/send').map(call => JSON.parse(call.body));
    assert.ok(sent.some(mail => mail.personalizations.some(recipient => recipient.to.some(to => to.email === booking.inviteeEmail)) && mail.content.some(part => part.value.includes(invitee.manageUrl))), 'ordinary invitee notification delivers its active manage action');
    assert.ok((await rows('wire_events')).length > 0, 'ordinary reschedule creates the managed calendar event');
    await complete(await rt.data(`/api/app/move-in/jobs/${applied.job.id}/undo`, {}));
    const report = await rt.data(`/api/app/move-in/jobs/${applied.job.id}/undo`, {});
    const disposition = report.undo.dispositions.find(entry => entry.targetId === booking.id);
    assert.equal(disposition?.disposition, 'retained');
    assert.equal(disposition?.reason, 'edited');
    assert.equal((await rt.data(manage)).occurrence.startAt, nextStart);
    assert.equal((await rows('booking_occurrences', booking.id)).length, 3);

    const providerId = (await rows('bookings')).find(row => row.id === booking.id).calendar_provider_event_id;
    const beforeErase = await rt.data(`/api/app/move-in/jobs/${applied.job.id}`);
    const tombstonesBefore = await rows('ik_d1_erased_targets');
    // Failure in native cleanup must also roll back kit custody and deletion.
    await rt.db.prepare(`CREATE TRIGGER refuse_test_erasure BEFORE INSERT ON delivery_outbox WHEN NEW.booking_id = '${booking.id}' AND NEW.kind = 'calendar_cancel' BEGIN SELECT RAISE(ABORT, 'test cleanup unavailable'); END`).run();
    const refusedErase = await rt.api(`/api/app/bookings/${booking.id}`, { method: 'DELETE' });
    assert.ok(refusedErase.status >= 400);
    assert.equal((await rt.api(manage)).status, 200);
    assert.equal((await rows('erased_calendar_targets', booking.id)).length, 0);
    assert.equal(JSON.stringify(await rows('ik_d1_erased_targets')) === JSON.stringify(tombstonesBefore), true);
    assert.equal((await rt.data(`/api/app/move-in/jobs/${applied.job.id}`)).report.fingerprint, beforeErase.report.fingerprint);
    await rt.db.prepare('DROP TRIGGER refuse_test_erasure').run();

    const mailCount = (await rows('wire_calls')).filter(call => new URL(call.url).pathname === '/v3/mail/send').length;
    const erased = await rt.data(`/api/app/bookings/${booking.id}`, undefined, 202, 'DELETE');
    assert.equal(erased.calendarCleanup, 'pending');
    assert.equal((await rt.api(manage)).status, 404);
    assert.equal((await rows('booking_occurrences', booking.id)).length, 0);
    assert.equal((await rows('booking_manage_tokens', booking.id)).length, 0);
    assert.equal((await rows('delivery_outbox', booking.id)).some(row => row.kind !== 'calendar_cancel'), false);
    await rt.data('/__fixtures/deliver', {});
    const removedEvent = JSON.parse((await rows('wire_events')).find(row => row.id === providerId).payload);
    assert.equal(removedEvent.status, 'cancelled');
    assert.ok((await rt.data(`/api/app/erasures/${booking.id}`)).completedAt);
    assert.equal((await rows('wire_calls')).filter(call => new URL(call.url).pathname === '/v3/mail/send').length, mailCount);
    assert.equal((await rt.data(`/api/app/bookings/${booking.id}`, undefined, 202, 'DELETE')).calendarCleanup, 'completed');
    const erasedReport = await rt.data(`/api/app/move-in/jobs/${applied.job.id}/undo`, {});
    assert.equal(erasedReport.undo.dispositions.some(entry => entry.targetId === booking.id && entry.disposition === 'retained'), false, 'undo no longer retains erased personal evidence');
    assert.equal((await rows('bookings')).some(row => row.id === booking.id), false);
  } finally { await rt.close(); }
  await cleanupOrdering();
});
