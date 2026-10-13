import assert from 'node:assert/strict';
import { bookingRuntime } from './booking-runtime.mjs';
import { saved } from './runtime.mjs';

/** Public imports and owner actions create every native command; only Google I/O is held. */
export async function cleanupOrdering() {
  const rt = await bookingRuntime();
  try {
    const rows = async (table, id) => (await (table.startsWith('wire_') ? rt.providerDb : rt.db).prepare(`SELECT * FROM ${table}${id ? ' WHERE booking_id = ?' : ''}`).bind(...(id ? [id] : [])).all()).results;
    const files = await saved('solo'), preview = await rt.upload('preview', files);
    let imported = await rt.upload('apply', files, { fingerprint: preview.report.fingerprint, acknowledged: true });
    for (let n = 0; imported.job.state !== 'completed' && n < 60; n++) imported = await rt.data(`/api/app/move-in/jobs/${imported.job.id}/resume`, {});
    assert.equal(imported.job.state, 'completed');
    const bookings = await rt.data('/api/app/bookings');
    await rt.data('/__fixtures/setup', {});
    const published = new Set();
    const cases = [
      { newer: 'failed' }, { newer: 'pending' }, { newer: 'processing' }, { newer: 'succeeded' },
      { newer: 'pending', oldFailure: true }, { newer: 'succeeded', oldFailure: true }, { newer: 'failed', oldFailure: true },
      { newer: 'succeeded', lostResponse: true },
    ];
    assert.ok(bookings.length >= cases.length);
    for (const [index, scenario] of cases.entries()) {
      const booking = bookings[index], label = scenario.lostResponse ? 'late provider response loss' : `${scenario.newer}/${scenario.oldFailure ? 'older failure' : 'older success'}`;
      await rt.data('/api/app/calendar/check', {});
      const event = await rt.data(`/api/app/event-types/${booking.eventTypeId}`);
      if (!published.has(event.id)) {
        await rt.data(`/api/app/event-types/${event.id}/availability`, { windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 200, 'PUT');
        await rt.data(`/api/app/event-types/${event.id}/publish`, {});
        published.add(event.id);
      }
      const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const available = await rt.data(`/api/public/book/dial-host/${event.slug}/availability?week=${week}`);
      assert.ok(available.slots.length);
      await rt.data(`/api/app/bookings/${booking.id}/reschedule`, { startAt: available.slots[0].startAt, inviteeTimezone: 'America/New_York', overridePublishedAvailability: false });
      const upsert = (await rows('delivery_outbox', booking.id)).find(row => row.kind === 'calendar_upsert');
      await rt.hold(`upsert-${index}`, upsert.id, 'upsert');
      assert.equal((await rt.data(`/api/app/bookings/${booking.id}`, undefined, 202, 'DELETE')).calendarCleanup, 'pending');
      const oldCleanup = (await rows('delivery_outbox', booking.id)).find(row => row.kind === 'calendar_cancel');
      if (scenario.lostResponse) {
        await rt.data('/__fixtures/deliver', { id: oldCleanup.id });
        assert.ok((await rt.data(`/api/app/erasures/${booking.id}`)).completedAt);
        await rt.data('/wire/control', { name: 'google-lost-response', value: 1 });
      } else await rt.hold(`old-${index}`, oldCleanup.id, 'lookup', scenario.oldFailure ? 403 : undefined);
      assert.equal(await rt.release(`upsert-${index}`), scenario.lostResponse ? 'retrying' : 'succeeded');
      const latest = (await rows('delivery_outbox', booking.id)).find(row => row.kind === 'calendar_cancel' && row.id !== oldCleanup.id);
      assert.ok(latest, `${label}: late native completion created repair`);
      const status = () => rt.data(`/api/app/erasures/${booking.id}`);
      const effects = async () => (await rows('wire_events')).map(row => JSON.parse(row.payload)).filter(event => event.extendedProperties.private['dial-booking-id'] === booking.id);
      assert.equal((await status()).completedAt, null, `${label}: late effect reopened cleanup`);
      assert.equal((await effects()).filter(event => event.status !== 'cancelled').length, 1);
      if (scenario.newer === 'processing') await rt.hold(`latest-${index}`, latest.id, 'lookup');
      if (scenario.newer === 'failed') await rt.data('/wire/control', { name: 'google-mutation-status', value: 400 });
      if (['failed', 'succeeded'].includes(scenario.newer)) await rt.data('/__fixtures/deliver', { id: latest.id });
      assert.equal((await rows('delivery_outbox', booking.id)).find(row => row.id === latest.id).state, scenario.newer);
      const before = await status();
      assert.equal(Boolean(before.completedAt), scenario.newer === 'succeeded', label);
      assert.equal(Boolean(before.lastErrorCode), scenario.newer === 'failed', label);
      if (!scenario.lostResponse) assert.equal(await rt.release(`old-${index}`), scenario.oldFailure ? 'failed' : 'succeeded');
      const after = await status();
      assert.equal(after.completedAt, before.completedAt, `${label}: obsolete completion cannot own cleanup status`);
      assert.equal(after.lastErrorCode, before.lastErrorCode, `${label}: obsolete outcome cannot erase or replace the latest error`);
      if (scenario.newer !== 'succeeded') assert.equal((await effects()).filter(event => event.status !== 'cancelled').length, 1);
      await rt.data('/wire/control', { name: 'google-mutation-status', value: 0 });
      if (scenario.newer === 'failed') {
        const retry = await rt.data(`/api/app/erasures/${booking.id}/deliveries/${latest.id}/retry`, {}, 202);
        assert.equal(retry.state, 'pending');
        await rt.data('/__fixtures/deliver', { id: retry.id });
      } else if (scenario.newer === 'processing') assert.equal(await rt.release(`latest-${index}`), 'succeeded');
      else if (scenario.newer === 'pending') await rt.data('/__fixtures/deliver', { id: latest.id });
      const done = await status();
      assert.ok(done.completedAt, `${label}: newest successful cleanup completes`);
      assert.equal(done.lastErrorCode, null);
      assert.ok((await effects()).every(event => event.status === 'cancelled'), `${label}: provider event removed`);
      assert.equal((await rt.api(`/api/app/bookings/${booking.id}`)).status, 404);
      for (const table of ['booking_occurrences', 'booking_answers', 'booking_manage_tokens']) assert.equal((await rows(table, booking.id)).length, 0);
      const commands = await rows('delivery_outbox', booking.id);
      assert.ok(commands.every(row => row.kind === 'calendar_cancel' && !row.payload_json.includes(booking.inviteeEmail) && !row.payload_json.includes(booking.inviteeName)));
      assert.equal((await rows('wire_calls')).filter(row => new URL(row.url).hostname === 'api.sendgrid.com' && row.method === 'POST').length, 0, 'Erasure sends no Dial email');
    }
    // Repair and explicit retry cannot reconstruct erased import custody or undo payloads.
    assert.equal((await rt.db.prepare('SELECT count(*) AS count FROM ik_originals WHERE bytes IS NOT NULL').first()).count, 0);
    assert.equal((await rt.db.prepare('SELECT count(*) AS count FROM ik_d1_original_chunks').first()).count, 0);
    for (const booking of bookings.slice(0, cases.length)) {
      const tables = (await rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'ik_*'").all()).results;
      for (const { name } of tables) assert.equal(JSON.stringify(await rows(name)).includes(booking.inviteeEmail), false, `${name}: erased personal copy reappeared`);
    }
  } finally { await rt.close(); }
}
