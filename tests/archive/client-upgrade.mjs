import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrationFiles, tableQuery, quote } from '../../scripts/archive/schema.mjs';

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
    for (const table of ['client_profiles','client_aliases','client_notes','client_fields']) assert.equal(prior.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
  } finally { prior.close(); }
}
