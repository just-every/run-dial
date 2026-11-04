import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { migrationFiles, tableQuery, quote } from '../../scripts/archive/schema.mjs';
import { sqliteBinding } from './fixture.mjs';
import { runtime } from './auth.mjs';

/** Apply the additive locale migration over the full populated previous schema. */
export async function localeUpgrade(source) {
  const prior = new DatabaseSync(':memory:');
  try {
    const migrations = await migrationFiles();
    const added = migrations.find(row => row.file === 'core/0104_confirmation_language.sql');
    assert.ok(added, 'the confirmation-language migration exists');
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
    assert.ok(before.get('event_types').rows.length, 'the upgrade starts with an existing event');
    assert.ok(before.get('bookings').rows.length, 'the upgrade starts with existing booking data');
    for (const trigger of triggers) prior.exec(trigger.sql);
    prior.exec(added.sql);
    for (const [name, { selected, rows }] of before) assert.deepEqual(prior.prepare(`SELECT ${selected} FROM ${quote(name)}`).all(), rows, `${name}: locale upgrade preserves every prior value`);
    assert.ok(prior.prepare('SELECT confirmation_language FROM event_types').all().every(row => row.confirmation_language === 'en'), 'existing events keep English confirmations');
    assert.deepEqual(prior.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { prior.close(); }
  source.prepare("UPDATE event_types SET confirmation_language='es' WHERE id='event_types-1'").run();
}

export async function localeProjectionRestored(source, target, duplicateId) {
  const language = db => db.prepare('SELECT id,confirmation_language FROM event_types ORDER BY id').all();
  assert.deepEqual(language(target), language(source), 'feature-scoped restoration preserves every configured confirmation language');
  assert.equal(target.prepare("SELECT confirmation_language FROM event_types WHERE id='event_types-1'").get().confirmation_language, 'es');
  assert.equal(target.prepare('SELECT confirmation_language FROM event_types WHERE id=?').get(duplicateId).confirmation_language, 'es', 'the actual draft duplicate retains Spanish through restoration');
  const compiled = await build({ stdin: { contents: `
    import { Hono } from 'hono';
    import { createServices } from './src/core/app/services';
    import { confirmationLanguageRoutes } from './src/core/features/locales/routes';
    export function routes(db, runtime) {
      const services = createServices(db, runtime);
      return new Hono().use('*', async (context, next) => { context.set('services', services); await next(); }).route('/', confirmationLanguageRoutes);
    }`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const { routes } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const response = await routes(sqliteBinding(target), runtime).request('/api/app/event-types/' + duplicateId + '/confirmation-language');
  assert.equal(response.status, 200, 'restored draft configuration is readable through the native route');
  assert.deepEqual(await response.json(), { confirmationLanguage: 'es' });
  console.log('PROBE LOCALE-001 archive: populated upgrade and actual Base export and restore -> prior event and booking values preserved, older events default English, Spanish source and draft duplicate retained');
}
