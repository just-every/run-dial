import { deletionOrder } from './order.mjs';
import { rootValues } from './root.mjs';
import { redactionEndsRates } from './rate.mjs';
import { all, statement, quote, insist, canonicalJson, sha256, chunks } from './sql.mjs';

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

export async function tableKeys(db, table) {
  const columns = await all(db, `PRAGMA table_info(${quote(table)})`);
  insist(columns.length > 0, 'unknown_table:' + table);
  const pk = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
  return { columns: columns.map(c => c.name), pk: pk.length ? pk : ['rowid'] };
}

/** Every table holding a foreign key into a deleted table must itself be declared,
 * so an ON DELETE action can never remove (or orphan) a row erasure did not fence. */
export async function checkDeclared(db, d) {
  const declared = new Set([...d.tracked, ...d.redact.map(r => r.table), ...d.audit.map(a => a.table), ...d.retain.map(r => r.table)].map(t => t.toLowerCase()));
  const tables = await all(db, "SELECT name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name");
  for (const table of tables.filter(t => /\bREFERENCES\b/i.test(t.sql))) {
    for (const fk of await all(db, `PRAGMA foreign_key_list(${quote(table.name)})`)) {
      if (d.tracked.some(t => same(t, fk.table))) {
        insist(declared.has(table.name.toLowerCase()), `undeclared_dependent:${table.name}:${fk.table}`, 409);
        if (d.deleted.some(t => same(t, fk.table)) && !d.deleted.some(t => same(t, table.name))) insist(!['CASCADE', 'SET NULL', 'SET DEFAULT'].includes(fk.on_delete), `unsafe_retained_fk:${table.name}:${fk.table}`, 409);
      }
    }
  }
}

function needed(d, keys) {
  const columns = new Map(d.tracked.map(t => [t, new Set(keys.get(t).pk)]));
  for (const c of d.root.redact?.identityColumns ?? []) columns.get(d.root.table).add(c);
  for (const item of [...d.edges, ...d.redact]) for (const c of item.on ? Object.values(item.on) : item.params ?? []) columns.get(item.from).add(c);
  for (const edge of d.edges.filter(e => e.blob)) columns.get(edge.table).add(edge.blob.keyColumn);
  return columns;
}
const projection = columns => [...columns].map(c => c === 'rowid' ? 'rowid AS rowid' : quote(c)).join(',');

export function matchSql(item, parents) {
  if (!item.on) return parents.map(p => ({ where: `(${item.where})`, values: (item.params ?? []).map(c => p[c]) }));
  const pairs = Object.entries(item.on);
  const tuples = parents.map(p => pairs.map(([, parent]) => p[parent])).filter(t => t.every(v => v !== null && v !== undefined));
  // A set lookup, so an index on the child columns serves it; json_each's own
  // columns (id, key, value...) are never in scope beside the child's.
  const where = `(${pairs.map(([child]) => `${quote(item.table)}.${quote(child)}`).join(',')}) IN (SELECT ${pairs.map((_, i) => `json_extract(j.value,'$[${i}]')`).join(',')} FROM json_each(?) j)`;
  return chunks(tuples, 200).map(part => ({ where, values: [JSON.stringify(part)] }));
}

/** Reads rows of the item's table reachable from `parents` through one edge. */
export async function matching(db, item, parents, select) {
  const found = [];
  for (const m of matchSql(item, parents)) found.push(...await all(db, `SELECT ${select} FROM ${quote(item.table)} WHERE ${m.where}`, ...m.values));
  return found;
}

/** Closes the declared graph from one subject to a fixed point. Rows carry only
 * key, linking and blob-key columns: no personal value leaves this function. */
export async function collect(db, d, subject, remembered = []) {
  const keys = new Map();
  for (const t of new Set([...d.tracked, ...d.redact.map(r => r.table)])) keys.set(t, await tableKeys(db, t));
  for (const item of d.audit) insist(keys.get(item.of).pk.length === 1, 'audit_composite_key:' + item.of);
  const columns = needed(d, keys), rootKey = keys.get(d.root.table).pk;
  if (d.root.redact) await redactionEndsRates(db, d, await rootValues(d, keys.get(d.root.table), subject, 'erased:admission'));
  insist(subject && typeof subject === 'object' && canonicalJson(Object.keys(subject).sort()) === canonicalJson([...rootKey].sort()), 'subject_key');
  const rows = new Map(d.tracked.map(t => [t, new Map()]));
  const keyOf = (table, row) => Object.fromEntries(keys.get(table).pk.map(c => [c, row[c]]));
  const root = await statement(db, `SELECT ${projection(columns.get(d.root.table))} FROM ${quote(d.root.table)} WHERE ${rootKey.map(c => `${c === 'rowid' ? 'rowid' : quote(c)}=?`).join(' AND ')}`, ...rootKey.map(c => subject[c])).first();
  if (!root && !remembered.length) return null;
  if (root) rows.get(d.root.table).set(canonicalJson(keyOf(d.root.table, root)), { table: d.root.table, key: keyOf(d.root.table, root), row: root, depth: 0 });
  const known = new Map(d.tracked.map(t => [t, new Map()]));
  const remember = (table, row) => known.get(table).set(canonicalJson(row), row);
  for (const e of remembered) remember(e.table, e.row);
  for (const [table, old] of known) {
    const pk = keys.get(table).pk;
    for (const part of chunks([...old.values()], 200)) {
      const found = await all(db, `SELECT ${projection(columns.get(table))} FROM ${quote(table)} WHERE EXISTS(SELECT 1 FROM json_each(?) j WHERE ${pk.map((c, i) => `${quote(table)}.${c === 'rowid' ? 'rowid' : quote(c)} IS json_extract(j.value,'$[${i}]')`).join(' AND ')})`, JSON.stringify(part.map(row => pk.map(c => row[c]))));
      for (const row of found) { remember(table, row); const key = keyOf(table, row); rows.get(table).set(canonicalJson(key), { table, key, row, depth: 1 }); }
    }
  }
  if (root) remember(d.root.table, root);
  let frontier = new Map([...known].filter(([, r]) => r.size).map(([t, r]) => [t, [...r.values()]])), depth = 0;
  while (frontier.size) {
    const next = new Map(); depth++;
    for (const edge of d.edges) {
      const parents = frontier.get(edge.from);
      if (!parents?.length) continue;
      for (const row of await matching(db, edge, parents, projection(columns.get(edge.table)))) {
        const key = keyOf(edge.table, row), id = canonicalJson(key);
        if (rows.get(edge.table).has(id)) continue;
        remember(edge.table, row);
        rows.get(edge.table).set(id, { table: edge.table, key, row, depth });
        if (!next.has(edge.table)) next.set(edge.table, []);
        next.get(edge.table).push(row);
      }
    }
    frontier = next;
  }
  const entries = [...rows.values()].flatMap(m => [...m.values()]);
  const plan = { subject, root: root ? rows.get(d.root.table).get(canonicalJson(subject)) : null, keys, rows, entries, known };
  plan.order = await deletionOrder(db, d, plan);
  return plan;
}

export async function counts(db, d, plan) {
  const deleted = Object.fromEntries(d.deleted.map(t => [t, plan.rows.get(t).size]).filter(([, n]) => n));
  const parents = table => [...plan.rows.get(table).values()].map(e => e.row);
  const redacted = d.root.redact ? { [d.root.table]: plan.rows.get(d.root.table).size } : {}, audited = {};
  for (const item of d.redact) for (const m of matchSql(item, parents(item.from))) {
    redacted[item.table] = (redacted[item.table] ?? 0) + (await statement(db, `SELECT count(*) AS n FROM ${quote(item.table)} WHERE ${m.where}`, ...m.values).first()).n;
  }
  for (const item of d.audit) for (const part of chunks([...plan.rows.get(item.of).values()].map(e => Object.values(e.key)[0]), 200)) {
    audited[item.table] = (audited[item.table] ?? 0) + (await statement(db, `SELECT count(*) AS n FROM ${quote(item.table)} WHERE ${quote(item.column)} IN (SELECT value FROM json_each(?))${item.where ? ` AND (${item.where})` : ''}`, JSON.stringify(part)).first()).n;
  }
  const blobKeys = new Set();
  for (const e of d.edges.filter(e => e.blob)) for (const x of plan.rows.get(e.table).values()) if (x.row[e.blob.keyColumn] != null) blobKeys.add(canonicalJson([e.blob.bucket, x.row[e.blob.keyColumn]]));
  const blobs = blobKeys.size;
  return { deleted, redacted, audited, blobs };
}

export async function planHash(d, plan, summary) {
  const rows = Object.fromEntries([...plan.rows].map(([t, m]) => [t, [...m.keys()].sort()]));
  return sha256(canonicalJson({ entity: d.entity, subject: plan.subject, rows, summary }));
}
