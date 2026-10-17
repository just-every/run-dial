import { foldBookingSearch } from '../../src/core/features/bookings/search/case-fold.mjs';
import { redirectConfigIssue, redirectUrlIssue } from '../../src/core/features/event-types/redirect-policy.mjs';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { exported, assertCoverage } from './policy.mjs';
import { validateCustomFields } from './custom-fields.mjs';
import { validSqlValue } from './json-values.mjs';
import { quote, tableQuery, catalogQuery, applicationCatalog } from './catalog.mjs';
export { quote, tableQuery, catalogQuery, applicationCatalog } from './catalog.mjs';
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function schemaModel() {
  const db = new DatabaseSync(':memory:');
  const migrations = [];
  try {
    for (const directory of ['core', 'ext']) {
      const path = new URL(`../../migrations/${directory}/`, import.meta.url);
      const files = await readdir(path).catch(error => { if (directory === 'ext' && error.code === 'ENOENT') return []; throw error; });
      for (const file of files.filter(name => name.endsWith('.sql')).sort()) {
        const sql = await readFile(new URL(file, path), 'utf8');
        db.exec(sql); migrations.push({ file: `${directory}/${file}`, sha256: hash(sql) });
      }
    }
    assertCoverage(db.prepare(tableQuery).all().map(row => row.name));
    return { db, migrations, catalog: applicationCatalog(db.prepare(catalogQuery).all()), columns: Object.fromEntries(exported.map(name => [name, db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(column => column.name)])) };
  } catch (error) { db.close(); throw error; }
}
export async function assertSchema(platform, model) {
  const names = await platform.query(tableQuery);
  assertCoverage(names.map(row => row.name));
  const catalog = await platform.query(catalogQuery);
  if (JSON.stringify(applicationCatalog(catalog)) !== JSON.stringify(model.catalog)) throw new Error('archive-schema-mismatch');
  return catalog;
}
export function restoreStatements(tables, triggers) {
  return [
    { sql: 'PRAGMA defer_foreign_keys=ON', params: [] },
    ...triggers.map(trigger => ({ sql: `DROP TRIGGER ${quote(trigger.name)}`, params: [] })),
    ...tables.flatMap(({ name, rows }) => rows.map(row => ({ sql: `INSERT INTO ${quote(name)} (${Object.keys(row).map(quote).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, params: Object.values(row) }))),
    ...triggers.map(trigger => ({ sql: trigger.sql, params: [] })),
  ];
}
export function validateRows(archive, model) {
  if (JSON.stringify(archive.migrations) !== JSON.stringify(model.migrations) || !Array.isArray(archive.tables) || JSON.stringify(archive.tables.map(table => table.name)) !== JSON.stringify(exported)) throw new Error('archive-schema-mismatch');
  for (const table of archive.tables) {
    if (JSON.stringify(Object.keys(table).sort()) !== JSON.stringify(['name', 'rows']) || !Array.isArray(table.rows)) throw new Error('archive-invalid-rows');
    for (const row of table.rows) {
      if (!row || Array.isArray(row) || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...model.columns[table.name]].sort()) || Object.values(row).some(value => !validSqlValue(value))) throw new Error('archive-invalid-row');
      if (table.name === 'bookings' && (row.invitee_name_folded !== foldBookingSearch(row.invitee_name) || row.invitee_email_folded !== foldBookingSearch(row.invitee_email))) throw new Error('archive-invalid-search-values');
      if (table.name === 'event_types') {
        const options = JSON.parse(row.duration_options_json);
        if (!Array.isArray(options) || options.length < 1 || options.length > 4 || options.some(value => !Number.isInteger(value) || value < 5 || value > 480) || new Set(options).size !== options.length || !options.includes(row.duration_minutes)) throw new Error('archive-invalid-event-durations');
        if (row.post_booking_redirect_json !== null) {
          const redirect = JSON.parse(row.post_booking_redirect_json);
          if (!redirect || redirectConfigIssue(redirect)) throw new Error('archive-invalid-post-booking-redirect');
        }
      }
      if (table.name === 'event_questions' && ![0, 1].includes(row.private)) throw new Error('archive-invalid-question-privacy');
      if (table.name === 'bookings') {
        const attribution = JSON.parse(row.attribution_json);
        if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution) || Object.entries(attribution).some(([key, value]) => !['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source'].includes(key) || typeof value !== 'string' || value.length > 500)) throw new Error('archive-invalid-booking-attribution');
        if (row.post_booking_redirect_url !== null && redirectUrlIssue(row.post_booking_redirect_url)) throw new Error('archive-invalid-post-booking-redirect');
      }
      for (const [column, value] of Object.entries(row)) if (column.endsWith('_json')) {
        let parsed; try { parsed = JSON.parse(value); } catch { throw new Error('archive-invalid-json-field'); }
        if (column === 'options_json' && (!Array.isArray(parsed) || parsed.some(option => typeof option !== 'string' && (!option || typeof option !== 'object' || typeof option.value !== 'string' || typeof option.label !== 'string'))) || column === 'value_json' && !(table.name === 'ext_custom_field_values' && typeof parsed === 'boolean' || typeof parsed === 'string' || Array.isArray(parsed) && parsed.every(value => typeof value === 'string')) || column === 'payload_json' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('archive-invalid-json-field');
      }
    }
  }
  const triggers = model.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
  model.db.exec('PRAGMA foreign_keys=ON; BEGIN;');
  try {
    for (const statement of restoreStatements(archive.tables, triggers)) model.db.prepare(statement.sql).run(...statement.params);
    validateCustomFields(model.db);
    if (model.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('archive-invalid-references');
    for (const { name, rows } of archive.tables) {
      // Node 22's SQLite text getter truncates embedded NUL. SQLite JSON
      // encoding preserves every text byte through that host boundary.
      const fields = model.columns[name].flatMap(column => [`'${column.replaceAll("'", "''")}'`, quote(column)]).join(',');
      const restored = model.db.prepare(`SELECT json_object(${fields}) AS encoded FROM ${quote(name)}`).all().map(row => JSON.stringify(JSON.parse(row.encoded))).sort();
      const original = rows.map(row => JSON.stringify(Object.fromEntries(model.columns[name].map(column => [column, row[column]])))).sort();
      if (JSON.stringify(restored) !== JSON.stringify(original)) throw new Error('archive-lossy-values');
    }
    model.db.exec('ROLLBACK');
  } catch { model.db.exec('ROLLBACK'); throw new Error('archive-invalid-data'); }
}
