import { all, canonicalJson, insist, quote } from './sql.mjs';
import { matching } from './plan.mjs';

/** Every foreign key between two deleted tables, grouped per constraint. Schema
 * only: it never reads a row, so a later step can use it without a plan. */
export async function foreignKeyLinks(db, d) {
  const links = [];
  for (const table of d.deleted) {
    const groups = new Map();
    for (const fk of await all(db, `PRAGMA foreign_key_list(${quote(table)})`)) {
      if (!groups.has(fk.id)) groups.set(fk.id, []);
      groups.get(fk.id).push(fk);
    }
    for (const group of groups.values()) {
      const parentTable = d.deleted.find(name => name.toLowerCase() === group[0].table.toLowerCase());
      if (parentTable) links.push({ table, parentTable, group });
    }
  }
  return links;
}

/** Topological row order across every path, not the depth of the first visit.
 * Actual FK links also constrain order, even if a row was reached by another edge. */
export async function deletionOrder(db, d, plan) {
  const id = e => e.table + '\0' + canonicalJson(e.key);
  const selected = plan.entries.filter(e => d.deleted.includes(e.table));
  const entries = new Map(selected.map(e => [id(e), e]));
  const children = new Map(selected.map(e => [id(e), new Set()]));
  const link = (parent, child) => {
    if (id(parent) !== id(child) && children.has(id(parent)) && entries.has(id(child))) children.get(id(parent)).add(id(child));
  };
  for (const edge of d.edges) for (const parent of plan.rows.get(edge.from).values()) {
    const keys = plan.keys.get(edge.table).pk;
    for (const row of await matching(db, edge, [parent.row], keys.map(c => c === 'rowid' ? 'rowid AS rowid' : quote(c)).join(','))) {
      const child = entries.get(edge.table + '\0' + canonicalJson(Object.fromEntries(keys.map(c => [c, row[c]]))));
      if (child) link(parent, child);
    }
  }
  plan.foreignKeys = await foreignKeyLinks(db, d);
  for (const { table, parentTable, group } of plan.foreignKeys) {
    for (const parent of plan.rows.get(parentTable).values()) {
      const parentKeys = plan.keys.get(parent.table).pk;
      // Read the actual join: FK columns need not be part of a declared edge's projection.
      const cols = plan.keys.get(table).pk;
      const found = await all(db, `SELECT ${cols.map(c => c === 'rowid' ? 'rowid AS rowid' : quote(c)).join(',')} FROM ${quote(table)} WHERE ${group.map(f => `${quote(f.from)}=(SELECT ${quote(f.to || parentKeys[f.seq])} FROM ${quote(parent.table)} WHERE ${parentKeys.map(c => `${quote(c)}=?`).join(' AND ')})`).join(' AND ')}`, ...group.flatMap(() => parentKeys.map(c => parent.key[c])));
      for (const row of found) {
        const child = entries.get(table + '\0' + canonicalJson(Object.fromEntries(cols.map(c => [c, row[c]]))));
        insist(child, `unreached_dependent:${table}:${parent.table}`, 409);
        link(parent, child);
      }
    }
  }
  const remaining = new Map([...children].map(([key, deps]) => [key, deps.size]));
  const parents = new Map(selected.map(e => [id(e), []]));
  for (const [parent, deps] of children) for (const child of deps) parents.get(child).push(parent);
  const queue = [...remaining].filter(([, n]) => n === 0).map(([key]) => key), result = [];
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]; result.push(entries.get(key));
    for (const parent of parents.get(key)) { remaining.set(parent, remaining.get(parent) - 1); if (remaining.get(parent) === 0) queue.push(parent); }
  }
  insist(result.length === entries.size, 'cyclic_deletion_graph', 409);
  return result.filter(e => e !== plan.root);
}
