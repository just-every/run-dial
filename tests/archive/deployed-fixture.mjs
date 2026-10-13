import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../modules/deploy-kit/migrations.mjs';
import { hash, quote, restoreStatements } from '../../scripts/archive/schema.mjs';
import { exported, excluded } from '../../scripts/archive/policy.mjs';
import { fixture } from './fixture.mjs';

// Only the provider transport is synthetic: Base owns the ledger DDL, claims,
// migration execution and applied hashes, using the product's actual SQL bytes.
export async function deployedFixture(t, { populated = false, install = 'destination' } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const api = { async request(path, options) {
    assert.equal(path, '/d1/database/archive-test/query');
    assert.equal(options.method, 'POST');
    const { sql } = options.body;
    if (/^SELECT /i.test(sql)) return [{ success: true, results: db.prepare(sql).all() }];
    db.exec('BEGIN');
    try { db.exec(sql); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    return [{ success: true, results: [] }];
  } };
  const directory = new URL('../../migrations/core/', import.meta.url);
  const migrations = [];
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    migrations.push({ name, sql, sha256: hash(sql) });
  }
  // Distinct test-only, schema-neutral installer receipts make a source-ledger
  // replacement observable. Neither changes product migration files or records.
  const probe = `-- Test-only installation receipt; no schema or product data changes.\nSELECT '${install.replaceAll("'", "''")}';`;
  const history = [...migrations, { name: '9999_archive_test_install.sql', sql: probe, sha256: hash(probe) }];
  await migrate(api, 'archive-test', history);
  assert.deepEqual((await migrate(api, 'archive-test', history, { apply: false })).applied, []);
  const ledger = () => db.prepare('SELECT name,sha256,state FROM _rer_deploy_migrations ORDER BY name').all();
  assert.deepEqual(ledger().map(row => ({ ...row })), history.map(({ name, sha256 }) => ({ name, sha256, state: 'applied' })));
  if (populated) {
    const data = await fixture();
    try {
      const tables = [...exported, ...Object.keys(excluded)].map(name => ({ name, rows: data.db.prepare(`SELECT * FROM ${quote(name)}`).all() }));
      const destinationFence = db.prepare('SELECT * FROM rer_portability_state').all();
      const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
      db.exec('PRAGMA foreign_keys=ON; BEGIN');
      try {
        for (const { sql, params } of restoreStatements(tables, triggers)) db.prepare(sql).run(...params);
        db.exec('COMMIT');
        assert.deepEqual(db.prepare('SELECT * FROM rer_portability_state').all(), destinationFence, 'populating product fixtures preserves the installed portability identity');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { data.db.close(); }
  }
  return { db, ledger, migrations: migrations.map(({ name, sha256 }) => ({ file: `core/${name}`, sha256 })) };
}
