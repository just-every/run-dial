import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { migrationFiles, tableQuery, quote } from '../../scripts/archive/schema.mjs';
import { sqliteBinding } from './fixture.mjs';
import { runtime } from './auth.mjs';

export async function clientUpgrade(source) {
  const prior = new DatabaseSync(':memory:');
  try {
    const migrations = await migrationFiles(), added = migrations.find(row=>row.file.endsWith('_client_records.sql'));
    for (const migration of migrations.filter(row=>row!==added)) prior.exec(migration.sql);
    prior.exec('PRAGMA foreign_keys=OFF');
    const triggers = prior.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
    for (const trigger of triggers) prior.exec(`DROP TRIGGER ${quote(trigger.name)}`);
    const before = new Map();
    for (const {name} of prior.prepare(tableQuery).all()) {
      if (name==='sqlite_sequence') continue;
      const columns = prior.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row=>row.name);
      const selected = columns.map(quote).join(','), rows = source.prepare(`SELECT ${selected} FROM ${quote(name)}`).all();
      prior.exec(`DELETE FROM ${quote(name)}`);
      for (const row of rows) prior.prepare(`INSERT INTO ${quote(name)}(${selected}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]));
      before.set(name,{selected,rows});
    }
    for (const trigger of triggers) prior.exec(trigger.sql);
    prior.exec(added.sql);
    for (const [name,{selected,rows}] of before) assert.deepEqual(prior.prepare(`SELECT ${selected} FROM ${quote(name)}`).all(),rows,`${name}: client migration preserves populated prior rows`);
    for (const table of ['client_profiles','client_aliases','client_notes','client_fields','client_remember_links']) assert.equal(prior.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
    const token=randomBytes(32).toString('base64url'),hash=randomBytes(32).toString('base64url');
    source.prepare("INSERT INTO client_remember_links(id,event_type_id,booking_id,email,token_hash,expires_at,created_at,updated_at) VALUES('synthetic-dial-1010','event_types-1','bookings-1','invitee@example.test',?,'2099-01-01T00:00:00.000Z','2026-10-07T00:00:00.000Z','2026-10-07T00:00:00.000Z')").run(hash);
    source.prepare("UPDATE delivery_outbox SET payload_json=json_set(payload_json,'$.clientRememberUrl',?)").run(`https://dial.example.test/book/host/event?remember=${token}`);
    const guest = source.prepare('SELECT email FROM booking_guests LIMIT 1').get().email;
    source.prepare("INSERT INTO client_aliases(email,client_id,created_at,updated_at) SELECT ?,id,created_at,updated_at FROM client_profiles LIMIT 1").run(guest);
    const solo = ['synthetic-dial-211', 'example.test'].join('@');
    source.prepare("INSERT INTO booking_guests(id,booking_id,email,created_at,updated_at) SELECT 'synthetic-dial-212',booking_id,?,created_at,updated_at FROM booking_guests LIMIT 1").run(solo);
    source.prepare("INSERT INTO client_profiles(id,email,created_at,updated_at) SELECT 'synthetic-dial-213',?,created_at,updated_at FROM client_profiles LIMIT 1").run(solo);
    source.exec("INSERT INTO client_aliases(email,client_id,created_at,updated_at) SELECT email,id,created_at,updated_at FROM client_profiles WHERE id='synthetic-dial-213'; INSERT INTO client_notes(id,client_id,body,operator_id,created_at,updated_at) SELECT 'synthetic-dial-214','synthetic-dial-213','Guest archive preparation',operator_id,created_at,updated_at FROM client_notes LIMIT 1; INSERT INTO client_fields(id,client_id,label,value,created_at,updated_at) SELECT 'synthetic-dial-215','synthetic-dial-213','Guest archive reference','synthetic-dial-216',created_at,updated_at FROM client_fields LIMIT 1");
    return {token,hash,guest,solo};
  } finally { prior.close(); }
}

export async function clientProjectionRestored(source, target, { guest, solo }) {
  const compiled = await build({ stdin: { contents: `
    import { Hono } from 'hono';
    import { createServices } from './src/core/app/services';
    import { clientRoutes } from './src/core/features/clients/routes';
    export function routes(db, runtime) {
      const services = createServices(db, runtime);
      return new Hono().use('*', async (context, next) => { context.set('services', services); await next(); }).route('/', clientRoutes);
    }`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const { routes } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const read = async (db, path) => {
    const response = await routes(sqliteBinding(db), runtime).request(path);
    assert.equal(response.status, 200, 'restored native client route'); return response.json();
  };
  const clients = await read(target, '/api/app/clients');
  assert.equal(clients.totalCount, 2);
  assert.deepEqual(clients, await read(source, '/api/app/clients'));
  for (const email of [guest, solo]) {
    const path = '/api/app/clients/history?' + new URLSearchParams({ email });
    const before = await read(source, path), after = await read(target, path);
    assert.equal(after.totalCount, 1, 'a merged primary and guest alias still counts one booking');
    assert.deepEqual(after.bookings.map(row => row.id), ['bookings-1']);
    for (const field of ['email', 'aliases', 'notes', 'fields']) assert.deepEqual(after[field], before[field], `restored client ${field}`);
    assert.equal(after.notes.length, 1); assert.equal(after.fields.length, 1);
  }
}
