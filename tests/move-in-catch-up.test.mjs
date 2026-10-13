import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { saved } from './move-in/runtime.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';
import { savedUploader } from './move-in/upload.mjs';
import { assertReport } from './move-in/report-validator.mjs';
import { refreshManifest } from './move-in/capacity.mjs';

const first = '2027-01-01T00:00:00.000Z', later = '2027-01-02T00:00:00.000Z';
const effectTables = ['delivery_outbox', 'delivery_attempts', 'base_mail_dispatch', 'calendar_deletion_probes'];

async function catchUpRuntime() {
  const rt = await bookingRuntime();
  const rows = async (sql, ...params) => (await rt.db.prepare(sql).bind(...params).all()).results;
  const count = async (sql, ...params) => (await rt.db.prepare(sql).bind(...params).first()).n;
  const effects = async () => ({ ...Object.fromEntries(await Promise.all(effectTables.map(async table => [table, await count(`SELECT count(*) AS n FROM ${table}`)]))), wire: await (async () => (await rt.providerDb.prepare('SELECT count(*) AS n FROM wire_calls').first()).n)(), queue: (await rt.data('/__queue-count')).queueCalls });
  const snapshot = async () => { const tables = (await rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name")).map(row => row.name); return Object.fromEntries(await Promise.all(tables.map(async name => [name, await rows(`SELECT * FROM "${name}" ORDER BY rowid`)]))); };
  const complete = async current => { for (let n = 0; !['completed', 'undone'].includes(current.job.state) && n < 80; n++) current = await rt.data(`/api/app/move-in/jobs/${current.job.id}/resume`, {}); assert.ok(['completed', 'undone'].includes(current.job.state)); return current; };
  const submit = savedUploader(rt.api, first);
  const importFirst = async () => { const files = await saved('solo'), preview = await rt.upload('preview', files); assertReport(preview.report); assert.equal(preview.report.mode, 'first'); return complete(await rt.upload('apply', files, { fingerprint: preview.report.fingerprint, acknowledged: true })); };
  const bookingFor = async email => (await rows('SELECT id FROM bookings WHERE invitee_email=?', email))[0]?.id;
  return { rt, rows, count, effects, snapshot, complete, submit, importFirst, bookingFor };
}

contract('DATA-003', 'a newer capture of the same account catches up: repeats untouched, edits kept, new records silent, source differences listed, undo limited to the catch-up', async () => {
  const { rt, rows, count, effects, snapshot, complete, submit, importFirst, bookingFor } = await catchUpRuntime();
  try {
    const original = await importFirst();
    // An owner edit between captures: a private annotation on an imported booking.
    const edited = await bookingFor('guest-1@example.test');
    const field = await rt.data('/api/app/custom-fields', { entity: 'booking', label: 'Owner note', kind: 'text' }, 201);
    await rt.data(`/api/app/custom-fields/booking/${edited}/${field.id}`, { value: 'Prefers mornings' }, 200, 'PUT');
    const editedBefore = { booking: await rows('SELECT * FROM bookings WHERE id=?', edited), note: await rows('SELECT * FROM ext_custom_field_values WHERE booking_id=?', edited) };
    const importedBefore = await rows('SELECT * FROM bookings ORDER BY id'), effectsBefore = await effects(), before = await snapshot();

    const files = await saved('solo-later');
    const preview = await rt.upload('preview', files, { asOf: later });
    assertReport(preview.report);
    assert.deepEqual(await snapshot(), before, 'catch-up preview writes nothing');
    assert.equal(preview.report.mode, 'catch-up');
    assert.deepEqual(preview.report.alreadyHere, { profile: 1, eventTypes: 4, bookings: 6 });
    assert.equal(preview.report.capturedAt, later);
    assert.equal(preview.report.bookingCounts.toImport, 2);
    assert.equal(preview.report.bookingCounts.movedAtSource, 1);
    assert.equal(preview.report.counts.eventTypes.read, 1, 'only the new event type is reviewed');
    const kinds = Object.fromEntries(preview.report.differences.map(item => [item.name, item.kind]));
    assert.deepEqual(kinds, { 'Guest 1': 'unchanged', 'Guest 2': 'unchanged', 'Guest 3': 'unchanged', 'Guest 4': 'moved', 'Guest 5': 'cancelled', 'Guest 6': 'invitee_changed', 'Guest 7': 'missing', 'Guest 8': 'missing', 'Guest 9': 'missing', 'Guest 10': 'missing' });
    assert.equal(preview.report.differences.find(item => item.kind === 'moved').sourceStartAt, '2027-01-20T15:00:00.000Z');
    assert.ok(preview.report.differences.every(item => item.resolved === (item.kind === 'unchanged')));

    let applied = await complete(await rt.upload('apply', files, { fingerprint: preview.report.fingerprint, acknowledged: true }));
    assert.notEqual(applied.job.id, original.job.id);
    assertReport(applied.report);
    // Repeats are matched by source identity: never duplicated or overwritten, the owner edit included.
    assert.deepEqual(await rows('SELECT * FROM bookings WHERE id=?', edited), editedBefore.booking);
    assert.deepEqual(await rows('SELECT * FROM ext_custom_field_values WHERE booking_id=?', edited), editedBefore.note);
    for (const before of importedBefore) assert.deepEqual(await rows('SELECT * FROM bookings WHERE id=?', before.id), [before], 'first-import bookings are untouched');
    assert.equal(await count('SELECT count(*) AS n FROM bookings'), importedBefore.length + 2);
    assert.equal(await count("SELECT count(*) AS n FROM event_types WHERE id IN (SELECT id FROM move_in_targets WHERE kind='event')"), 5);
    // The two new bookings hold their time, silently, with unsent capabilities.
    for (const email of ['guest-15@example.test', 'guest-16@example.test']) {
      const [booking] = await rows("SELECT b.state,b.imported,o.is_current FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.invitee_email=?", email);
      assert.deepEqual(booking, { state: 'confirmed', imported: 1, is_current: 1 });
      assert.equal(await count('SELECT count(*) AS n FROM booking_manage_tokens WHERE booking_id=?', await bookingFor(email)), 1);
    }
    assert.equal(await count("SELECT count(*) AS n FROM bookings WHERE invitee_email='guest-4@example.test'"), 1, 'the source reschedule is a difference, not a second booking');
    assert.deepEqual(await effects(), effectsBefore, 'no mail, calendar command, reminder or queue message');
    assert.equal(applied.report.differences.length, 10, 'the applied report keeps the differences list');
    const reloaded = await rt.data(`/api/app/move-in/jobs/${applied.job.id}`);
    assert.deepEqual(reloaded.report.differences, applied.report.differences, 'the list survives reload');

    // Undo removes only what the catch-up added.
    const firstRows = await rows("SELECT * FROM bookings WHERE id IN (SELECT id FROM move_in_targets WHERE kind='booking') AND invitee_email NOT IN ('guest-15@example.test','guest-16@example.test') ORDER BY id");
    applied = await complete(await rt.data(`/api/app/move-in/jobs/${applied.job.id}/undo`, {}));
    assert.equal(applied.job.state, 'undone');
    assert.ok(applied.undo.dispositions.every(item => item.disposition === 'reversed'));
    assert.deepEqual(await rows('SELECT * FROM bookings ORDER BY id'), firstRows);
    assert.deepEqual(await rows('SELECT * FROM ext_custom_field_values WHERE booking_id=?', edited), editedBefore.note);
    assert.equal((await rt.data(`/api/app/move-in/jobs/${original.job.id}`)).job.state, 'completed');
    assert.equal(await count('SELECT count(*) AS n FROM move_in_differences WHERE job_id=?', applied.job.id), 0);
    assert.deepEqual(await effects(), effectsBefore);

    // A different source account, and records kept by a retained undo, are refused without writes.
    const stranger = files.map(file => ({ ...file, bytes: Buffer.from(file.bytes) }));
    const user = stranger.find(file => file.name === 'user-1.json'), parsed = JSON.parse(user.bytes);
    parsed.resource.uri = 'https://api.calendly.com/users/stranger'; parsed.resource.slug = 'stranger'; user.bytes = Buffer.from(JSON.stringify(parsed)); refreshManifest(stranger);
    const unchanged = await snapshot(), refused = await submit('preview', stranger, { asOf: later });
    assert.equal(refused.status, 400); assert.match((await refused.json()).error.message, /different source account \(stranger\).*Nothing was saved/u);
    assert.deepEqual(await snapshot(), unchanged);
    // A new booking on an event the owner has since opened for requests only is rejected at review, not at apply.
    const target = (await rows("SELECT event_type_id AS id FROM bookings WHERE invitee_email='guest-6@example.test'"))[0].id;
    await rt.db.prepare('UPDATE event_types SET request_only=1 WHERE id=?').bind(target).run();
    const requestOnly = await rt.upload('preview', files, { asOf: later });
    assert.equal(requestOnly.report.bookingCounts.toImport, 1);
    assert.ok(requestOnly.report.items.some(item => item.name === 'Guest 15' && item.outcome === 'rejected' && /requests only/u.test(item.reason)));
    await rt.db.prepare('UPDATE event_types SET request_only=0 WHERE id=?').bind(target).run();
  } finally { await rt.close(); }
});

contract('DATA-003', 'release this time frees the slot and sends nothing; the ordinary cancel still sends one email; keep records a decision; erasing a person removes their difference', async () => {
  const { rt, rows, count, effects, complete, importFirst, bookingFor } = await catchUpRuntime();
  try {
    await importFirst();
    const setup = await rt.data('/__fixtures/setup', {});
    const files = await saved('solo-later'), preview = await rt.upload('preview', files, { asOf: later });
    const job = (await complete(await rt.upload('apply', files, { fingerprint: preview.report.fingerprint, acknowledged: true }))).job;
    const released = await bookingFor('guest-5@example.test'), [occurrence] = await rows('SELECT o.start_at AS startAt FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.id=?', released);
    const week = occurrence.startAt.slice(0, 10), offered = async () => (await rt.data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`)).slots.some(slot => slot.startAt === occurrence.startAt);
    assert.equal(await offered(), false, 'the imported booking holds its time');

    // Release: only for a source cancellation, never for another kind of difference.
    assert.equal((await rt.api(`/api/app/bookings/${await bookingFor('guest-6@example.test')}/release-imported`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 409);
    const effectsBefore = await effects();
    const result = await rt.data(`/api/app/bookings/${released}/release-imported`, { reason: 'Guest cancelled in Calendly' });
    assert.equal(result.state, 'cancelled');
    await rt.data('/__fixtures/deliver', {});
    assert.deepEqual(await effects(), effectsBefore, 'release sends no email and queues no calendar command or reminder');
    assert.equal(await offered(), true, 'the released time is bookable again');
    const [history] = await rows("SELECT actor_type,actor_id,reason FROM booking_history WHERE booking_id=? AND action='cancelled'", released);
    assert.deepEqual(history, { actor_type: 'operator', actor_id: (await rt.data('/api/app/session')).operator.id, reason: 'Guest cancelled in Calendly' });
    assert.equal((await rt.api(`/api/app/bookings/${released}/release-imported`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 409, 'a decided difference cannot be released again');

    // The ordinary operator cancellation beside it still emails the invitee exactly once.
    const cancelled = await bookingFor('guest-7@example.test');
    await rt.data(`/api/app/bookings/${cancelled}/cancel`, { reason: 'Owner cancelled' });
    await rt.data('/__fixtures/deliver', {}); await rt.data('/__fixtures/deliver', {});
    const mail = (await rt.providerDb.prepare("SELECT body FROM wire_calls WHERE url LIKE '%/v3/mail/send'").all()).results.map(row => JSON.parse(row.body)).filter(body => body.personalizations.some(item => item.to.some(to => to.email === 'guest-7@example.test')));
    assert.equal(mail.length, 1);

    // Keep: recorded, nothing else changes.
    const moved = await bookingFor('guest-4@example.test'), movedBefore = await rows('SELECT * FROM bookings WHERE id=?', moved);
    assert.deepEqual(await rt.data(`/api/app/move-in/differences/${moved}/keep`, {}), { decision: 'kept' });
    assert.deepEqual(await rows('SELECT * FROM bookings WHERE id=?', moved), movedBefore);
    for (const email of ['guest-8@example.test', 'guest-9@example.test', 'guest-10@example.test']) await rt.data(`/api/app/move-in/differences/${await bookingFor(email)}/keep`, {});
    const report = (await rt.data(`/api/app/move-in/jobs/${job.id}`)).report;
    assertReport(report);
    assert.deepEqual(Object.fromEntries(report.differences.filter(item => item.decision).map(item => [item.name, item.decision])), { 'Guest 4': 'kept', 'Guest 5': 'released', 'Guest 7': 'cancelled', 'Guest 8': 'kept', 'Guest 9': 'kept', 'Guest 10': 'kept' });
    assert.deepEqual(report.differences.filter(item => !item.resolved).map(item => item.name), ['Guest 6']);

    // Erasing the person withdraws their difference row and keeps everyone else's.
    const person = await bookingFor('guest-6@example.test');
    const erasure = await rt.data('/api/app/privacy/preview', { email: 'guest-6@example.test' });
    await rt.data('/api/app/privacy/erase', { email: 'guest-6@example.test', confirmation: erasure.confirmation, expiresAt: erasure.expiresAt });
    assert.equal(await count('SELECT count(*) AS n FROM move_in_differences WHERE booking_id=?', person), 0);
    assert.equal(await count('SELECT count(*) AS n FROM move_in_differences WHERE job_id=?', job.id), 9);
    const after = (await rt.data(`/api/app/move-in/jobs/${job.id}`)).report;
    assert.ok(!JSON.stringify(after).includes('Guest 6'));
    assert.ok(after.differences.every(item => item.resolved));
    assert.ok(setup.eventId);
  } finally { await rt.close(); }
});

contract('DATA-003', 'the switch-over checklist states links, the safe close date, open differences, provider health and capture age from live data', async () => {
  const { rt, rows, complete, importFirst, bookingFor } = await catchUpRuntime();
  try {
    await importFirst();
    let state = await rt.data('/api/app/move-in/switch-over');
    assert.equal(state.imported, true);
    assert.deepEqual(state.eventTypes.map(event => event.oldLink).sort(), ['https://schedule.example.test/solo/example-1', 'https://schedule.example.test/solo/example-2', 'https://schedule.example.test/solo/example-3', 'https://schedule.example.test/solo/example-4']);
    assert.ok(state.eventTypes.every(event => event.status === 'blocked' && event.reasons.some(reason => reason.code === 'destination_calendar')));
    assert.deepEqual(state.open, ['eventTypes', 'bookings', 'providers'], 'no catch-up yet, so no differences row is open');
    assert.equal(state.lastCapture.capturedAt, first);
    const future = await rows("SELECT o.end_at AS endAt FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.imported=1 AND b.state IN ('confirmed','rescheduled') ORDER BY o.end_at");
    const last = future.at(-1).endAt, closable = new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: state.hostZone }).format(new Date(last))}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(state.bookings, { future: future.filter(row => Date.parse(row.endAt) > Date.now()).length, lastEndAt: last, closableOn: closable });

    await rt.data('/__fixtures/setup', {});
    const files = await saved('solo-later'), preview = await rt.upload('preview', files, { asOf: later });
    await complete(await rt.upload('apply', files, { fingerprint: preview.report.fingerprint, acknowledged: true }));
    state = await rt.data('/api/app/move-in/switch-over');
    assert.equal(state.eventTypes.length, 5);
    assert.equal(state.eventTypes.find(event => event.title === 'Example 5').oldLink, 'https://schedule.example.test/solo/example-5');
    assert.ok(state.eventTypes.every(event => event.dialLink.includes('/book/dial-host/')));
    assert.equal(state.providers.calendar, null); assert.equal(state.providers.mail, null);
    assert.deepEqual(state.differences, { latestCatchUp: { capturedAt: later, asOf: later }, unresolved: 7, total: 10 });
    assert.equal(state.lastCapture.capturedAt, later);
    assert.ok(state.open.includes('differences') && !state.open.includes('providers'));

    const csv = await rt.api('/api/app/move-in/switch-over/links.csv');
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /^text\/csv/u);
    const lines = (await csv.text()).trim().split('\r\n');
    assert.equal(lines.length, 6);
    assert.ok(lines.some(line => line.includes('https://schedule.example.test/solo/example-5') && line.includes('/book/dial-host/example-5')));

    // Deciding every difference clears that row; nothing here contacts the source.
    for (const email of ['guest-4@example.test', 'guest-6@example.test', 'guest-7@example.test', 'guest-8@example.test', 'guest-9@example.test', 'guest-10@example.test']) await rt.data(`/api/app/move-in/differences/${await bookingFor(email)}/keep`, {});
    await rt.data(`/api/app/bookings/${await bookingFor('guest-5@example.test')}/release-imported`, {});
    state = await rt.data('/api/app/move-in/switch-over');
    assert.equal(state.differences.unresolved, 0);
    assert.ok(!state.open.includes('differences'));
  } finally { await rt.close(); }
});
