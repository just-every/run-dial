import { all, statement, insist } from './sql.mjs';
import { settle } from './completion.mjs';

/** Runs only after the D1 commit recorded every key. Deleting an absent object
 * succeeds, so an interrupted run repeats safely; a key leaves the work list
 * only after a read shows the object gone. */
export async function deleteBlobs(ctx, d, id, { until = Infinity, page = 1000 } = {}) {
  const { db, buckets } = ctx;
  const op = await statement(db, 'SELECT phase FROM rer_erasure_operations WHERE id=?', id).first();
  insist(op, 'erasure_not_found', 404);
  if (op.phase !== 'blobs') return op.phase;
  if (!(await all(db, "SELECT 1 FROM rer_erasure_scope WHERE operation=? AND kind='graph' AND table_name=? LIMIT 1", id, d.root.table)).length) {
    const current = await statement(db, 'SELECT phase FROM rer_erasure_operations WHERE id=?', id).first();
    if (current?.phase === 'complete') return 'complete';
    insist(false, 'erasure_scope_missing', 409);
  }
  let changes = 0;
  for (;;) {
    const rows = await all(db, 'SELECT bucket,key FROM rer_erasure_blobs WHERE operation=? ORDER BY bucket,key LIMIT ?', id, page);
    if (!rows.length) {
      const phase = await settle(ctx, d, id);
      if (phase === 'complete' || phase === 'deleting') return phase;
      if (phase === 'changed') insist(++changes < 3, 'erasure_scope_unstable', 409);
      else changes = 0;
      if (Date.now() > until) return 'blobs';
      continue;
    }
    for (const name of new Set(rows.map(r => r.bucket))) {
      const bucket = buckets[name];
      insist(bucket && typeof bucket.delete === 'function', 'missing_bucket:' + name, 500);
      const keys = rows.filter(r => r.bucket === name).map(r => r.key);
      await bucket.delete(keys);
      for (let i = 0; i < keys.length; i += 16) {
        const left = await Promise.all(keys.slice(i, i + 16).map(k => bucket.head(k)));
        insist(left.every(x => x === null), 'blob_remains', 503);
      }
      await db.batch([
        statement(db, 'DELETE FROM rer_erasure_blobs WHERE operation=? AND bucket=? AND key IN (SELECT value FROM json_each(?))', id, name, JSON.stringify(keys)),
        // Derived from what remains, so a concurrent or repeated run cannot double count.
        statement(db, 'UPDATE rer_erasure_operations SET blobs_deleted=blobs_total-(SELECT count(*) FROM rer_erasure_blobs WHERE operation=?) WHERE id=?', id, id),
      ]);
    }
    if (Date.now() > until) return 'blobs';
  }
}
