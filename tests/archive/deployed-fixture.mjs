import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '@runeditrun/rer/internal/modules/deploy-kit/migrations.mjs';
import { hash, quote, restoreStatements } from '../../scripts/archive/schema.mjs';
import { exported, excluded } from '../../scripts/archive/policy.mjs';
import { fixture } from './fixture.mjs';

// Run Edit Run Platform's runner (service src/integrations/cloudflare-migrations.ts)
// creates this exact trusted ledger and commits each file's name/hash with its SQL.
export const platformLedgerDdl = 'CREATE TABLE IF NOT EXISTS rer_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)';
function platformInstall(db, migrations) {
  db.exec(platformLedgerDdl);
  for (const { name, sha256, sql } of migrations) {
    db.exec('BEGIN');
    try { db.prepare('INSERT INTO rer_migrations(name,sha256) VALUES (?,?)').run(name, sha256); db.exec(sql); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}

// Only the provider transport is synthetic: Base (or, with platform, the
// Platform runner's ledger) owns the ledger DDL, claims, migration execution
// and applied hashes, using the product's actual SQL bytes.
export async function deployedFixture(t, { populated = false, install = 'destination', localLedger = false, platform = false } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const imports = [];
  const api = { async importSql(id, sql) {
    assert.equal(id, 'archive-test'); imports.push(sql);
    db.exec('BEGIN');
    try { db.exec(sql); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }, async request(path, options) {
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
  const table = platform ? 'rer_migrations' : 'd1_migrations';
  if (platform) platformInstall(db, migrations);
  else {
    await migrate(api, 'archive-test', migrations);
    assert.equal(imports.length, migrations.length, 'published migration runner sends each SQL body through importSql');
    assert.deepEqual((await migrate(api, 'archive-test', migrations, { apply: false })).applied, []);
    assert.equal(imports.length, migrations.length, 'read-only verification does not import SQL');
    assert.deepEqual(db.prepare('SELECT name,sha256,state FROM d1_migrations ORDER BY id').all().map(row => ({ ...row })), migrations.map(({ name, sha256 }) => ({ name, sha256, state: 'applied' })));
  }
  // Installer timestamps belong to each installation, and must not be replaced
  // by source timestamps during restore. They do not invent product migrations.
  db.prepare(`UPDATE ${table} SET applied_at=?`).run(install === 'source' ? '2026-10-13 01:00:00' : '2026-10-14 01:00:00');
  if (localLedger) db.exec('ALTER TABLE d1_migrations DROP COLUMN sha256; ALTER TABLE d1_migrations DROP COLUMN state;');
  const ledger = () => db.prepare(`SELECT * FROM ${table} ORDER BY ${platform ? 'name' : 'id'}`).all();
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
