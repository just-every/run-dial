import { ErasureError, guard, insist, quote } from './sql.mjs';

const LINKS = 'rer_erasure_rates';
const ident = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
const entityName = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);

// `root.live` is an SQL predicate over the root row that is true while its
// subject may still be counted. A redacted root survives erasure under the same
// key, so its declaration must give one that the redaction makes false.
const live = root => root.live === undefined || (typeof root.live === 'string' && root.live.trim().length > 0);
const present = root => `SELECT 1 FROM ${quote(root.table)} WHERE ${quote(root.column)}=?${root.live ? ` AND (${root.live})` : ''}`;

/** Edges for a declaration's `edges`: the correlation rows of one subject, then
 * every counter row they name. Counters are deleted before their links. */
export function rateEdges({ entity, root, counters }) {
  insist(entityName(entity) && ident(root?.table) && ident(root?.column) && live(root), 'rate_root');
  insist(Array.isArray(counters) && counters.length > 0 && counters.every(c => ident(c.table) && ident(c.keyColumn)), 'rate_counters');
  return [
    { table: LINKS, from: root.table, where: `entity='${entity}' AND subject=?`, params: [root.column], rate: { live: root.live ?? null } },
    ...counters.map(c => ({ table: c.table, from: LINKS, where: `${quote(c.keyColumn)}=? AND ?='${c.table}'`, params: ['rate_key', 'rate_table'] })),
  ];
}

/** Statements to put before the counter upsert in the SAME batch: they abort the
 * batch when the subject row is already gone or no longer live, then record who
 * the counter key belongs to. */
export function rateCorrelation(db, { entity, root, subject, rateTable, rateKey }) {
  insist(entityName(entity) && ident(root?.table) && ident(root?.column) && live(root) && ident(rateTable), 'rate_root');
  insist(subject !== null && subject !== undefined && typeof rateKey === 'string' && rateKey.length > 0, 'rate_subject');
  return [
    guard(db, `EXISTS(${present(root)})`, subject),
    db.prepare('DELETE FROM rer_erasure_guard'),
    db.prepare(`INSERT OR IGNORE INTO ${LINKS}(rate_table,rate_key,entity,subject) VALUES(?,?,?,?)`).bind(rateTable, rateKey, entity, String(subject)),
  ];
}

/** Runs `statements` (the seed's counter upserts) with their correlation in one
 * batch and returns their results. A subject erased before the write refuses with
 * `subject_gone` (409) and nothing is written. */
export async function rateWrite(db, spec, statements) {
  const link = rateCorrelation(db, spec);
  try { return (await db.batch([...link, ...statements])).slice(link.length); }
  catch (error) {
    if (!await db.prepare(present(spec.root)).bind(spec.subject).first()) throw new ErasureError('subject_gone', 409);
    throw error;
  }
}

/** Refuses a root redaction that would leave a rate root live: correlated writes
 * naming the retained key would then still be admitted after erasure. */
export async function redactionEndsRates(db, d, set) {
  for (const edge of d.edges.filter(e => e.rate && e.from === d.root.table)) {
    const columns = Object.keys(set);
    const live = await db.prepare(`SELECT 1 AS live FROM (SELECT ${columns.map(c => `? AS ${quote(c)}`).join(',')}) WHERE (${edge.rate.live})`).bind(...Object.values(set)).first().catch(() => ({ live: 1 }));
    insist(!live, 'rate_root_live', 409);
  }
}
