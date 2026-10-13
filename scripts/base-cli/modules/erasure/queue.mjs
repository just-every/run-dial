import { all, statement, canonicalJson } from './sql.mjs';
import { tableKeys } from './plan.mjs';
import { foreignKeyLinks } from './order.mjs';

/** What is left of a plan after its first step, in deletion order, held in the
 * private scope table (no schema of its own). Each later step reads only its
 * slice, so no step re-reads or re-checks the rows still waiting: the cost of
 * the whole erasure stays linear in its rows. The slice is verified inside the
 * step's batch; anything the queue does not know about (rows written after it
 * was built) is found by the full collection that runs once the queue is empty. */
const seq = n => String(n).padStart(10, '0');

export const clearQueue = (db, id) => statement(db, "DELETE FROM rer_erasure_scope WHERE operation=? AND kind='queue'", id);

/** Replaces the operation's queue with `entries`; chunks stay small enough for one bound value. */
export function queueStatements(db, id, entries) {
  const out = [clearQueue(db, id)], texts = entries.map((e, i) => canonicalJson({ i, t: e.table, k: e.key, r: e.row }));
  for (let from = 0, to = 0; from < texts.length; from = to) {
    for (let size = 0; to < texts.length && size + texts[to].length < 60000 && to - from < 200; to++) size += texts[to].length;
    if (to === from) to++;
    out.push(statement(db, "INSERT INTO rer_erasure_scope SELECT ?,'queue',printf('%010d',json_extract(j.value,'$.i')),'{}',j.value FROM json_each(?) j", id, `[${texts.slice(from, to).join(',')}]`));
  }
  return out;
}

export async function readQueue(db, id, limit) {
  const rows = await all(db, "SELECT table_name AS seq,row_json FROM rer_erasure_scope WHERE operation=? AND kind='queue' ORDER BY table_name LIMIT ?", id, limit);
  return rows.map(r => { const e = JSON.parse(r.row_json); return { seq: r.seq, table: e.t, key: e.k, row: e.r, depth: 1 }; });
}
export const consumeStatement = (db, id, last) => statement(db, "DELETE FROM rer_erasure_scope WHERE operation=? AND kind='queue' AND table_name<=?", id, last);

/** The part of a plan one step needs: only the rows it deletes are tracked, so
 * every check in its batch is bounded by the slice, not by the rows waiting. */
export async function slicePlan(db, d, subject, entries) {
  const keys = new Map();
  for (const t of new Set([...d.tracked, ...d.redact.map(r => r.table)])) keys.set(t, await tableKeys(db, t));
  const rows = new Map(d.tracked.map(t => [t, new Map()])), known = new Map(d.tracked.map(t => [t, new Map()]));
  for (const e of entries) { rows.get(e.table).set(canonicalJson(e.key), e); known.get(e.table).set(canonicalJson(e.row), e.row); }
  return { subject, root: null, keys, rows, entries, known, order: entries, foreignKeys: await foreignKeyLinks(db, d) };
}
export const rootScopeExists = async (db, id, d) => (await all(db, "SELECT 1 FROM rer_erasure_scope WHERE operation=? AND kind='graph' AND table_name=? LIMIT 1", id, d.root.table)).length > 0;
