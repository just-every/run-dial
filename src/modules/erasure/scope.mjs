import { all, statement, canonicalJson, quote } from './sql.mjs';
import { tableKeys } from './plan.mjs';

/** Temporary private scope, cleared atomically at completion. It lets a later
 * batch find new copies through parents that an earlier batch already deleted. */
export async function readScope(db, id) {
  return (await all(db, "SELECT table_name,key_json,row_json FROM rer_erasure_scope WHERE operation=? AND kind='graph'", id)).map(r => ({ table: r.table_name, key: JSON.parse(r.key_json), row: JSON.parse(r.row_json) }));
}
export async function scopeStatements(db, d, plan, id, entries = plan.entries) {
  const out = [];
  for (const { table, row, key } of entries) {
    out.push(statement(db, "INSERT OR IGNORE INTO rer_erasure_scope VALUES(?,'graph',?,?,?)", id, table, canonicalJson(key), canonicalJson(row)));
  }
  for (const { table } of d.retain) {
    const { pk } = await tableKeys(db, table);
    const key = `json_object(${pk.flatMap(c => ["'" + c.replaceAll("'", "''") + "'", quote(c)]).join(',')})`;
    out.push(statement(db, `INSERT OR IGNORE INTO rer_erasure_scope SELECT ?,'retain',?,${key},${key} FROM ${quote(table)}`, id, table));
  }
  if (d.root.redact && plan.root) {
    const identity = Object.fromEntries((d.root.redact.identityColumns ?? []).map(c => [c, plan.root.row[c]]));
    out.push(statement(db, "INSERT INTO rer_erasure_scope SELECT ?,'identity',?,?,? WHERE NOT EXISTS(SELECT 1 FROM rer_erasure_scope WHERE operation=? AND kind='identity')", id, d.root.table, canonicalJson(plan.subject), canonicalJson(identity), id));
  }
  return out;
}
export async function readRedaction(db, id) {
  const rows = await all(db, "SELECT kind,row_json FROM rer_erasure_scope WHERE operation=? AND kind IN ('identity','redaction')", id);
  return Object.fromEntries(rows.map(r => [r.kind, JSON.parse(r.row_json)]));
}
export const forgetScope = (db, id) => statement(db, 'DELETE FROM rer_erasure_scope WHERE operation=?', id);
