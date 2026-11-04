import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { contract } from './contract.mjs';
import { fixture } from './event-status-trigger/fixture.mjs';
import { fixture as archiveFixture, sqliteBinding, testPlatform } from './archive/fixture.mjs';
import { createArchive, restoreArchive } from './archive/artifact.mjs';
import { schemaModel, quote } from '../scripts/archive/schema.mjs';

const eventId = index => `synthetic-dial-${String(index).padStart(11, '0')}`;
const creation = (defaults, slug) => ({ ...defaults, slug, title: slug, description: 'Synthetic capacity event',
  color: '#dcab3c', locationType: 'phone', locationLabel: 'Phone', locationValue: '+1 202 555 0100' });

// Populate all lifecycle states without thousands of unrelated HTTP operations.
async function populate(db, total) {
  const columns = (await db.prepare('PRAGMA table_info(event_types)').all()).results.map(row => row.name);
  const select = columns.map(name => name === 'id' ? "printf('synthetic-dial-%011d',n)" :
    name === 'slug' ? "printf('synthetic-dial-%d',n)" :
    name === 'status' ? "CASE n%3 WHEN 0 THEN 'published' WHEN 1 THEN 'disabled' ELSE 'draft' END" : `source.${quote(name)}`).join(',');
  await db.prepare(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<?)
    INSERT INTO event_types (${columns.map(quote).join(',')}) SELECT ${select} FROM numbers CROSS JOIN (SELECT * FROM event_types LIMIT 1) source`).bind(total - 1).run();
}

async function snapshot(db) {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
  const result = {};
  for (const { name } of tables) result[name] = (await db.prepare(`SELECT * FROM ${quote(name)}`).all()).results.map(row => JSON.stringify(row)).sort();
  return result;
}

function refused(body, limit, value, currentUse) {
  assert.deepEqual(body, { error: { code: 'workspace_capacity_reached',
    message: `The ${limit} limit of ${value} has been reached.`, limit, value, currentUse } });
}

contract('OPER-007', 'owner event creation counts every status, admits the last host place atomically and refuses without side effects', async t => {
  const f = await fixture(t);
  const original = await f.create('synthetic-dial-control');
  await populate(f.db, 49);
  const statuses = (await f.db.prepare('SELECT status,count(*) AS n FROM event_types GROUP BY status').all()).results;
  assert.equal(statuses.length, 3, 'draft, disabled and published records consume capacity');
  const body = slug => ({ ...creation(f.defaults, slug), availability: undefined, hours: { uses: 'yours' } });
  // Also cover creation of the first default schedule in the admitted transaction.
  await f.db.batch([f.db.prepare('DELETE FROM event_schedule_bindings'), f.db.prepare('DELETE FROM availability_schedules')]);
  const [a, b] = await Promise.all(['synthetic-dial-last-a', 'synthetic-dial-last-b'].map(slug => f.send('/api/app/event-types', { body: body(slug) })));
  assert.deepEqual([a.status, b.status].sort(), [201, 409], 'exactly one concurrent create admits the 50th event');
  const winner = await (a.status === 201 ? a : b).json();
  refused(await (a.status === 409 ? a : b).json(), 'event_types_per_host', 50, 50);
  assert.equal(winner.status, 'draft');
  assert.equal(winner.questions.length, f.defaults.questions.length);
  assert.deepEqual(winner.availability, [1, 2, 3, 4, 5].map(weekday => ({ weekday, startMinute: 540, endMinute: 1020 })));
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM event_types').first()).n, 50);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM availability_schedules WHERE is_default=1').first()).n, 1);
  const before = await snapshot(f.db);
  refused(await f.json('/api/app/event-types', { body: body('synthetic-dial-51') }, 409), 'event_types_per_host', 50, 50);
  const own = { ...body('synthetic-dial-own'), hours: { uses: 'own', windows: [{ weekday: 1, startMinute: 540, endMinute: 600 }] } };
  refused(await f.json('/api/app/event-types', { body: own }, 409), 'event_types_per_host', 50, 50);
  assert.equal((await f.send('/api/app/event-types', { body: body('synthetic-dial-anonymous'), anonymous: true })).status, 401);
  assert.deepEqual(await snapshot(f.db), before, 'refusals leave every event child, identity, booking, schedule and outbox unchanged');
  // A full install without Your hours must also refuse without creating them.
  await f.db.batch([f.db.prepare('DELETE FROM event_schedule_bindings'), f.db.prepare('DELETE FROM availability_schedules')]);
  const withoutHours = await snapshot(f.db);
  refused(await f.json('/api/app/event-types', { body: body('synthetic-dial-no-hours') }, 409), 'event_types_per_host', 50, 50);
  assert.deepEqual(await snapshot(f.db), withoutHours);
  assert.deepEqual(await f.json(`/api/app/event-types/${original.id}`), original, 'the control event stays readable at capacity');
  assert.equal(f.outboundCalls(), 0);
});

contract('OPER-007', 'raised manifest limits admit within capacity and a full workspace refuses with deterministic precedence', async t => {
  const f = await fixture(t, { limits: { maxEventTypesPerHost: 6000, maxEventTypes: 5000 } });
  await f.create('synthetic-dial-workspace');
  await populate(f.db, 4999);
  const event = await f.create('synthetic-dial-5000');
  assert.equal(event.status, 'draft', 'raised host capacity permits creation beyond 50');
  const before = await snapshot(f.db);
  const input = creation(f.defaults, 'synthetic-dial-over-workspace');
  refused(await f.json('/api/app/event-types', { body: input }, 409), 'event_types_per_workspace', 5000, 5000);
  assert.equal((await f.send('/api/app/event-types', { body: input, anonymous: true })).status, 401);
  assert.deepEqual(await snapshot(f.db), before);
  const raised = await fixture(t, { limits: { maxEventTypesPerHost: 6000, maxEventTypes: 5001 } });
  await raised.create('synthetic-dial-raised');
  await populate(raised.db, 5000);
  await raised.create('synthetic-dial-5001');
  refused(await raised.json('/api/app/event-types', { body: input }, 409), 'event_types_per_workspace', 5001, 5001);
  const both = await fixture(t);
  await both.create('synthetic-dial-both');
  await populate(both.db, 5000);
  const full = await snapshot(both.db);
  refused(await both.json('/api/app/event-types', { body: input }, 409), 'event_types_per_host', 50, 5000);
  assert.deepEqual(await snapshot(both.db), full, 'existing records above the host floor remain intact');
  assert.equal(f.outboundCalls(), 0); assert.equal(raised.outboundCalls(), 0); assert.equal(both.outboundCalls(), 0);
});

contract(['OPER-007', 'DATA-001'], 'pre-existing over-capacity events remain readable, editable, deletable and survive the real archive', async () => {
  const source = await archiveFixture(), target = await schemaModel();
  try {
    const original = source.db.prepare('SELECT * FROM event_types LIMIT 1').get();
    const columns = Object.keys(original);
    const insert = source.db.prepare(`INSERT INTO event_types (${columns.map(quote)}) VALUES (${columns.map(() => '?')})`);
    for (let index = 1; index <= 51; index++) insert.run(...columns.map(name => name === 'id' ? eventId(index) : name === 'slug' ? `synthetic-dial-${index}` : original[name]));
    const expected = source.db.prepare('SELECT * FROM event_types ORDER BY id').all();
    const archive = await createArchive(testPlatform(source.db));
    assert.equal(archive.tables.find(table => table.name === 'event_types').rows.length, 52);
    await restoreArchive(testPlatform(target.db), archive);
    assert.deepEqual(target.db.prepare('SELECT * FROM event_types ORDER BY id').all(), expected, 'archive preserves every over-capacity record');
    const compiled = await build({ stdin: { contents: `
      import { createApp } from './src/core/app/hono.ts';
      export const app = createApp();`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm' });
    const { app } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
    const { runtime, token, operators, captures, request } = await import('./archive/auth.mjs');
    const binding = sqliteBinding(target.db), auth = await operators(binding);
    await auth.requestMagicLink(request('/auth/magic-link', {}), target.db.prepare("SELECT email FROM oa_operators WHERE id='owner'").get().email);
    const mail = (await captures(binding)).at(-1).message;
    const signedIn = await auth.handle(request('/auth/confirm', { token: token(mail) }));
    assert.equal(signedIn.status, 303);
    const cookie = signedIn.headers.get('set-cookie').split(';')[0];
    const queued = [];
    const native = async (path, method = 'GET', body, anonymous = false) => {
      const pending = [];
      const response = await app.request(runtime.APP_URL + path, {
        method, headers: { ...anonymous ? {} : { cookie }, origin: runtime.APP_URL, host: new URL(runtime.APP_URL).host, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, { ...runtime, DB: binding, JOBS: { async send(message) { queued.push(message); } } },
      { waitUntil(promise) { pending.push(promise); }, passThroughOnException() {} });
      await Promise.all(pending);
      return response;
    };
    const read = await native('/api/app/event-types/' + eventId(1));
    assert.equal(read.status, 200);
    const event = await read.json();
    const input = creation(event, 'synthetic-dial-refused-populated');
    const beforeRefusal = await snapshot(binding);
    const refusal = await native('/api/app/event-types', 'POST', input);
    assert.equal(refusal.status, 409, await refusal.clone().text());
    refused(await refusal.json(), 'event_types_per_host', 50, 52);
    assert.equal((await native('/api/app/event-types', 'POST', input, true)).status, 401);
    assert.deepEqual(await snapshot(binding), beforeRefusal, 'refusal preserves populated bookings, delivery, identities, schedules and all other product tables');
    assert.deepEqual(queued, [], 'refusals issue no outbound commands');
    const edit = await native('/api/app/event-types/' + event.id, 'PATCH', { ...creation(event, event.slug), title: 'Edited above capacity' });
    assert.equal(edit.status, 200, await edit.clone().text());
    assert.equal((await edit.json()).title, 'Edited above capacity');
    assert.equal((await native('/api/app/event-types/' + event.id, 'DELETE')).status, 204);
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM event_types').get().n, 51);
    assert.deepEqual(target.db.prepare('SELECT * FROM event_types WHERE id=?').get(original.id), original);
  } finally { source.db.close(); target.db.close(); }
});
