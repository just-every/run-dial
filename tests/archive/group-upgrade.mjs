import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { fixture, sqliteBinding, testPlatform } from './fixture.mjs';
import { createArchive, restoreArchive } from './artifact.mjs';
import { canonicalRow } from '../../scripts/archive/policy.mjs';
import { runtime } from './auth.mjs';
import { migrationFiles, schemaModel, tableQuery, quote } from '../../scripts/archive/schema.mjs';

async function populatedUpgrade(source) {
  const prior = new DatabaseSync(':memory:');
  try {
    const migrations = await migrationFiles();
    const added = migrations.find(row => row.file === 'core/0099_group_seat_capacity.sql');
    assert.ok(added, 'the additive group migration is present');
    for (const migration of migrations.filter(row => row !== added)) prior.exec(migration.sql);
    prior.exec('PRAGMA foreign_keys=OFF');
    const triggers = prior.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
    for (const trigger of triggers) prior.exec(`DROP TRIGGER ${quote(trigger.name)}`);
    const before = new Map();
    for (const { name } of prior.prepare(tableQuery).all()) {
      if (name === 'sqlite_sequence') continue;
      const columns = prior.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
      const selected = columns.map(quote).join(',');
      const rows = source.prepare(`SELECT ${selected} FROM ${quote(name)}`).all();
      prior.exec(`DELETE FROM ${quote(name)}`);
      for (const row of rows) prior.prepare(`INSERT INTO ${quote(name)} (${selected}) VALUES (${columns.map(() => '?')})`).run(...columns.map(column => row[column]));
      before.set(name, { selected, rows });
    }
    for (const trigger of triggers) prior.exec(trigger.sql);
    prior.exec(added.sql);
    for (const [name, { selected, rows }] of before) assert.deepEqual(prior.prepare(`SELECT ${selected} FROM ${quote(name)}`).all(), rows, `${name}: capacity upgrade preserves every populated prior value`);
    assert.ok(prior.prepare('SELECT group_capacity FROM event_types').all().every(row => row.group_capacity === null), 'existing event types keep ordinary appointment admission');
    assert.deepEqual(prior.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { prior.close(); }
}

function insert(db, name, original, changes) {
  const row = { ...original, ...changes };
  db.prepare(`INSERT INTO ${quote(name)} (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map(() => '?')})`).run(...Object.values(row));
}

async function ownerRoutes(db) {
  const compiled = await build({ stdin: { contents: `
    import { Hono } from 'hono';
    import { createServices } from './src/core/app/services';
    import { eventTypeRoutes } from './src/core/features/event-types/routes';
    import { bookingOperatorRoutes } from './src/core/features/bookings/routes';
    export function routes(db, runtime) {
      const services = createServices(db, runtime);
      return new Hono().use('*', async (context, next) => { context.set('services', services); await next(); }).route('/', eventTypeRoutes).route('/', bookingOperatorRoutes);
    }`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const { routes } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const app = routes(sqliteBinding(db), runtime);
  return async path => {
    const response = await app.request(path);
    assert.equal(response.status, 200, 'restored native owner read');
    return response.json();
  };
}

export async function groupSeatArchiveJourney() {
  const source = await fixture(), target = await schemaModel();
  try {
    await populatedUpgrade(source.db);
    const control = Object.fromEntries(['bookings', 'booking_occurrences', 'booking_answers'].map(name => [name, source.db.prepare(`SELECT * FROM ${quote(name)}`).all()]));
    source.db.exec("UPDATE calendar_connections SET status='disconnected'");
    const eventId = 'synthetic-dial-2200'.padEnd(26, '0'), ids = ['synthetic-dial-2201', 'synthetic-dial-2202'].map(id => id.padEnd(26, '0'));
    const originalEvent = source.db.prepare('SELECT * FROM event_types LIMIT 1').get();
    insert(source.db, 'event_types', originalEvent, { id: eventId, slug: 'group-capacity', title: 'Group capacity', group_capacity: 3, duration_options_json: '[30]', location_type: 'fixed_link', location_label: 'Workshop', location_value: 'https://workshop.example.test/join', locations_json: null, approval_required: 0, guest_limit: 0 });
    const originalBooking = control.bookings[0], originalOccurrence = control.booking_occurrences[0], originalAnswer = control.booking_answers[0];
    const instant = originalBooking.created_at;
    const startAt = new Date(Date.parse(originalOccurrence.start_at) + 7 * 86400000).toISOString();
    const endAt = new Date(Date.parse(startAt) + 30 * 60000).toISOString();
    for (const [index, id] of ids.entries()) {
      const occurrenceId = id + '-occurrence';
      const email = ['synthetic-dial-' + (2203 + index), 'example.test'].join('@');
      insert(source.db, 'bookings', originalBooking, { id, event_type_id: eventId, event_slug: 'group-capacity', event_title: 'Group capacity', location_type: 'fixed_link', location_label: 'Workshop', location_value: 'https://workshop.example.test/join', invitee_name: 'Group person ' + index, invitee_email: email, invitee_name_folded: 'group person ' + index, invitee_email_folded: email, ical_uid: id, calendar_required: 0, calendar_state: 'pending', calendar_provider_event_id: null, meeting_state: 'not_required', current_occurrence_id: occurrenceId, guest_limit: 0 });
      insert(source.db, 'booking_occurrences', originalOccurrence, { id: occurrenceId, booking_id: id, start_at: startAt, end_at: endAt, occupied_start_at: startAt, occupied_end_at: endAt, host_date: startAt.slice(0, 10) });
      insert(source.db, 'booking_answers', originalAnswer, { id: id + '-answer', booking_id: id, value_json: JSON.stringify('Private group answer ' + index) });
      insert(source.db, 'delivery_outbox', source.db.prepare('SELECT * FROM delivery_outbox LIMIT 1').get(), { id: id + '-reminder', booking_id: id, occurrence_id: occurrenceId, kind: 'reminder', idempotency_key: id + ':reminder', payload_json: JSON.stringify({ recipientRole: 'invitee', to: email, subject: 'Workshop reminder', text: 'Your seat is reserved.' }) });
      source.db.prepare('INSERT INTO booking_manage_tokens(id,booking_id,token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id + '-manage', id, id + '-private-manage', '2099-01-01T00:00:00.000Z', instant, instant);
      source.db.prepare("INSERT INTO booking_nonces(id,nonce_hash,purpose,event_type_id,booking_id,selection_start_at,selection_end_at,invitee_timezone,expires_at,created_at) VALUES(?,?,'confirm',?,?,?,?,?,?,?)").run(id + '-nonce', id + '-private-nonce', eventId, id, startAt, endAt, 'UTC', '2099-01-01T00:00:00.000Z', instant);
    }
    assert.deepEqual(source.db.prepare('PRAGMA foreign_key_check').all(), []);
    const archive = await createArchive(testPlatform(source.db));
    assert.equal(archive.tables.some(table => ['booking_manage_tokens', 'booking_nonces'].includes(table.name)), false, 'group seats inherit the ordinary authority exclusions');
    assert.equal(JSON.stringify(archive).includes('private-manage'), false);
    assert.equal(JSON.stringify(archive).includes('private-nonce'), false);
    await restoreArchive(testPlatform(target.db), archive);
    assert.equal(target.db.prepare('SELECT group_capacity FROM event_types WHERE id=?').get(eventId).group_capacity, 3);
    const activeSeats = db => db.prepare("SELECT booking.id,booking.invitee_email,occurrence.start_at,occurrence.end_at FROM bookings booking JOIN booking_occurrences occurrence ON occurrence.booking_id=booking.id WHERE booking.event_type_id=? AND booking.state IN ('confirmed','rescheduled') AND occurrence.is_current=1 AND occurrence.blocks_time=1 ORDER BY booking.id").all(eventId);
    assert.equal(activeSeats(target.db).length, 2);
    assert.deepEqual(activeSeats(target.db), activeSeats(source.db), 'restoration retains the same occupied seats and invitees');
    for (const [name, rows] of Object.entries(control)) assert.deepEqual(target.db.prepare(`SELECT * FROM ${quote(name)} WHERE ${name === 'bookings' ? 'id' : 'booking_id'}=?`).all(originalBooking.id).map(row => ({ ...row })), rows.map(row => canonicalRow(name, row)), 'the original control booking survives group restoration');
    for (const id of ids) {
      assert.deepEqual(target.db.prepare('SELECT * FROM booking_answers WHERE booking_id=?').all(id), source.db.prepare('SELECT * FROM booking_answers WHERE booking_id=?').all(id));
      const reminder = target.db.prepare('SELECT state,payload_json FROM delivery_outbox WHERE booking_id=?').get(id);
      assert.equal(reminder.state, 'failed', 'restored group reminders cannot replay outbound mail');
      assert.equal(JSON.parse(reminder.payload_json).archiveHistorical, true);
    }
    for (const name of ['booking_manage_tokens', 'booking_nonces']) assert.equal(target.db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get().n, 0, 'restoration never revives source capabilities');
    const read = await ownerRoutes(target.db);
    const event = await read('/api/app/event-types/' + eventId);
    assert.equal(event.groupCapacity, 3);
    const bookings = await read('/api/app/bookings?eventTypeId=' + eventId);
    for (const id of ids) {
      const booking = bookings.find(row => row.id === id);
      assert.ok(booking, 'the restored owner can read each reserved seat');
      assert.equal(booking.answers[0].value, 'Private group answer ' + ids.indexOf(id));
    }
  } finally { source.db.close(); target.db.close(); }
}
