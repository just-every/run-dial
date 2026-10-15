import { quote, statement, chunks } from './sql.mjs';
import { matchSql, tableKeys } from './plan.mjs';

const verify = (db, kind, condition, ...values) => statement(db, `INSERT INTO rer_erasure_guard(value,${kind}) SELECT 1,CASE WHEN (${condition}) THEN 1 ELSE 0 END`, ...values);

/** Re-read every declared path and audit inside the same atomic batch as the
 * final root effect and portability fence. A new dependent rolls the batch back
 * and returns to collection; it cannot be silently cascaded away. */
export async function verificationStatements(db, d, plan, id, label, { final = false, intake = !final } = {}) {
  const out = [];
  if (intake) {
    for (const [table, entries] of plan.rows) {
      const columns = [...new Set([...entries.values()].flatMap(e => Object.keys(e.row)))];
      for (const part of chunks([...entries.values()], 200)) out.push(verify(db, 'scope', `NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM ${quote(table)} WHERE ${columns.map((c, i) => `${quote(c)} IS json_extract(j.value,'$[${i}]')`).join(' AND ')}))`, JSON.stringify(part.map(e => columns.map(c => e.row[c])))));
    }
    // The schema can contain another FK path into a selected parent. Protect it
    // in the transaction too, including rows inserted after collection.
    for (const { table, parentTable, group } of plan.foreignKeys) {
      const pk = plan.keys.get(table).pk, parentPk = plan.keys.get(parentTable).pk;
      const parents = [...plan.rows.get(parentTable).values()].map(e => parentPk.map(c => e.key[c]));
      const children = [...plan.rows.get(table).values()].map(e => pk.map(c => e.key[c]));
      if (!parents.length) continue;
      const keyMatch = (alias, columns, json = 'j') => columns.map((c, i) => `${alias}.${quote(c)} IS json_extract(${json}.value,'$[${i}]')`).join(' AND ');
      const joined = group.map(f => `c.${quote(f.from)}=p.${quote(f.to || parentPk[f.seq])}`).join(' AND ');
      // Parents first, then their children through the key: cost follows the parents, not the child table.
      out.push(verify(db, 'scope', `NOT EXISTS(SELECT 1 FROM json_each(?) j CROSS JOIN ${quote(parentTable)} p CROSS JOIN ${quote(table)} c WHERE ${keyMatch('p', parentPk)} AND ${joined} AND NOT EXISTS(SELECT 1 FROM json_each(?) k WHERE ${keyMatch('c', pk, 'k')}))`, JSON.stringify(parents), JSON.stringify(children)));
    }
    for (const edge of d.edges) for (const m of matchSql(edge, [...plan.known.get(edge.from).values()])) {
      const pk = plan.keys.get(edge.table).pk, keys = [...plan.rows.get(edge.table).values()].map(e => pk.map(c => e.key[c]));
      const selected = `EXISTS(SELECT 1 FROM json_each(?) k WHERE ${pk.map((c, i) => `${quote(edge.table)}.${quote(c)} IS json_extract(k.value,'$[${i}]')`).join(' AND ')})`;
      out.push(verify(db, 'scope', `NOT EXISTS(SELECT 1 FROM ${quote(edge.table)} WHERE ${m.where} AND NOT (${selected}))`, ...m.values, JSON.stringify(keys)));
    }
  }
  if (final) {
    for (const edge of d.edges) for (const m of matchSql(edge, [...plan.known.get(edge.from).values()])) {
      out.push(verify(db, 'scope', `NOT EXISTS(SELECT 1 FROM ${quote(edge.table)} WHERE ${m.where})`, ...m.values));
    }
    for (const item of d.audit) {
      const keys = [...plan.known.get(item.of).values()].map(row => row[plan.keys.get(item.of).pk[0]]);
      for (const part of chunks(keys, 200)) out.push(verify(db, 'scope', `NOT EXISTS(SELECT 1 FROM ${quote(item.table)} WHERE ${quote(item.column)} IN (SELECT value FROM json_each(?))${item.where ? ` AND (${item.where})` : ''})`, JSON.stringify(part)));
      const clear = Object.entries(item.clear ?? {});
      if (clear.length) out.push(verify(db, 'scope', `NOT EXISTS(SELECT 1 FROM ${quote(item.table)} WHERE ${quote(item.column)} IS ? AND (${clear.map(([c]) => `${quote(c)} IS NOT ?`).join(' OR ')})${item.where ? ` AND (${item.where})` : ''})`, label, ...clear.map(([, value]) => value)));
    }
    if (d.root.redact) {
      const pk = plan.keys.get(d.root.table).pk, set = plan.rootSet, identity = d.root.redact.identityColumns ?? [];
      out.push(verify(db, 'retained', `EXISTS(SELECT 1 FROM ${quote(d.root.table)} WHERE ${[...pk.map(c => `${quote(c)} IS ?`), ...identity.map(c => `${quote(c)} IS ?`), ...Object.keys(set).map(c => `${quote(c)} IS ?`)].join(' AND ')})`, ...pk.map(c => plan.subject[c]), ...identity.map(c => (plan.rootIdentity ?? plan.root.row)[c]), ...Object.values(set)));
    }
  }
  for (const { table } of d.retain) {
    const { pk } = await tableKeys(db, table);
    out.push(verify(db, 'retained', `NOT EXISTS(SELECT 1 FROM rer_erasure_scope s WHERE s.operation=? AND s.kind='retain' AND s.table_name=? AND NOT EXISTS(SELECT 1 FROM ${quote(table)} t WHERE ${pk.map(c => `t.${quote(c)} IS json_extract(s.key_json,'$.${c}')`).join(' AND ')}))`, id, table));
  }
  return out;
}

export function rootGoneStatement(db, d, plan) {
  const pk = plan.keys.get(d.root.table).pk;
  return verify(db, 'scope', `NOT EXISTS(SELECT 1 FROM ${quote(d.root.table)} WHERE ${pk.map(c => `${quote(c)} IS ?`).join(' AND ')})`, ...pk.map(c => plan.subject[c]));
}

/** Immediately before a parent DELETE, its physical FK children must be gone.
 * This also protects against children created by a trigger in the same batch. */
export function childAbsenceStatements(db, plan, entry) {
  const out = [], parentPk = plan.keys.get(entry.table).pk;
  for (const { table, parentTable, group } of plan.foreignKeys.filter(f => f.parentTable === entry.table)) {
    const join = group.map(f => `c.${quote(f.from)}=p.${quote(f.to || parentPk[f.seq])}`).join(' AND ');
    const self = table === entry.table ? ` AND NOT (${parentPk.map(c => `c.${quote(c)} IS p.${quote(c)}`).join(' AND ')})` : '';
    out.push(verify(db, 'scope', `NOT EXISTS(SELECT 1 FROM ${quote(table)} c JOIN ${quote(parentTable)} p ON ${join} WHERE ${parentPk.map(c => `p.${quote(c)} IS ?`).join(' AND ')}${self})`, ...parentPk.map(c => entry.key[c])));
  }
  return out;
}
