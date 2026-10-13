import { statement, quote, chunks, randomHex } from './sql.mjs';

/** A fresh random label per erasure: it is not derived from the subject, so
 * nobody holding the database (or an old archive) can recompute or test it. */
export const newLabel = () => 'erased:' + randomHex(16);

export function auditStatements(db, d, plan, label, { only } = {}) {
  const out = [];
  for (const item of d.audit) {
    if (only && item.of !== only) continue;
    const keys = [...plan.known.get(item.of).values()].map(row => row[plan.keys.get(item.of).pk[0]]);
    const clear = Object.entries(item.clear ?? {});
    const set = [`${quote(item.column)}=?`, ...clear.map(([c]) => `${quote(c)}=?`)].join(',');
    // A previously relabelled row is still this operation's audit: a writer
    // may have changed its detail after the first cleanup.
    out.push(statement(db, `UPDATE ${quote(item.table)} SET ${set} WHERE ${quote(item.column)}=?${item.where ? ` AND (${item.where})` : ''}`, label, ...clear.map(([, v]) => v), label));
    for (const part of chunks(keys, 200)) {
      out.push(statement(db, `UPDATE ${quote(item.table)} SET ${set} WHERE ${quote(item.column)} IN (SELECT value FROM json_each(?))${item.where ? ` AND (${item.where})` : ''}`,
        label, ...clear.map(([, v]) => v), JSON.stringify(part)));
    }
  }
  return out;
}
