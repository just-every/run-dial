import { statement, guard, insist, ErasureError } from './sql.mjs';
import { collect, checkDeclared } from './plan.mjs';
import { readScope, readRedaction, scopeStatements, forgetScope } from './scope.mjs';
import { rootValues, rootStatements } from './root.mjs';
import { cleanupStatements, deletionStatements } from './cascade.mjs';
import { verificationStatements, rootGoneStatement } from './verification.mjs';
import { progressStatement, completeStatement } from './receipt.mjs';

/** Reconcile the declared graph after the first D1 fence, using the remembered
 * parents even when the root is gone. Completion and the last audit/retention
 * checks share one transaction; late rows return to deletion and blob cleanup. */
export async function settle(ctx, d, id) {
  const { db, fence } = ctx;
  const op = await statement(db, 'SELECT * FROM rer_erasure_operations WHERE id=?', id).first();
  insist(op && op.entity === d.entity, 'erasure_not_found', 404);
  if (op.phase !== 'blobs') return op.phase;
  const remembered = await readScope(db, id), saved = remembered.find(e => e.table === d.root.table);
  if (!saved) {
    const current = await statement(db, 'SELECT phase FROM rer_erasure_operations WHERE id=?', id).first();
    if (current?.phase === 'complete') return 'complete';
    // Older helpers discarded this information. Never claim an unprovable
    // legacy operation complete or invent the erased person's key.
    insist(false, 'erasure_scope_missing', 409);
  }
  await checkDeclared(db, d);
  const plan = await collect(db, d, saved.key, remembered);
  insist(plan, 'erasure_scope_missing', 409);
  if (d.root.redact) {
    const saved = await readRedaction(db, id);
    insist(plan.root && saved.identity && /^[a-f0-9]{32}$/.test(saved.redaction?.anonymousId ?? ''), 'erasure_redaction_scope_missing', 409);
    plan.anonymousId = saved.redaction.anonymousId; plan.rootIdentity = saved.identity;
    plan.rootSet = await rootValues(d, plan.keys.get(d.root.table), plan.subject, plan.anonymousId);
  }
  const deleted = JSON.parse(op.deleted), take = plan.order.slice(0, 500), final = take.length === plan.order.length;
  const newBlobs = take.some(e => d.edges.some(edge => edge.table === e.table && edge.blob && e.row[edge.blob.keyColumn] != null));
  const batch = [db.prepare('PRAGMA defer_foreign_keys=ON'), guard(db, "EXISTS(SELECT 1 FROM rer_erasure_operations WHERE id=? AND step=? AND phase='blobs')", id, op.step),
    ...await fence.transfers(), ...await scopeStatements(db, d, plan, id, [...take, ...(plan.root ? [plan.root] : [])]),
    ...await verificationStatements(db, d, plan, id, op.label), ...cleanupStatements(ctx, d, plan, op.label),
    ...await deletionStatements(ctx, d, plan, take, id, deleted)];
  if (final) {
    if (d.root.redact) batch.push(...await rootStatements(ctx, d, plan, id));
    else if (plan.root) batch.push(...await deletionStatements(ctx, d, plan, [plan.root], id, deleted));
    batch.push(...cleanupStatements(ctx, d, plan, op.label), ...await verificationStatements(db, d, plan, id, op.label, { final: true }));
    if (!d.root.redact) batch.push(rootGoneStatement(db, d, plan));
  } else batch.push(...await verificationStatements(db, d, plan, id, op.label, { intake: false }));
  batch.push(statement(db, 'UPDATE rer_erasure_operations SET blobs_total=blobs_deleted+(SELECT count(*) FROM rer_erasure_blobs WHERE operation=?) WHERE id=?', id, id), progressStatement(db, id, op.step, deleted));
  if (final && !newBlobs) {
    batch.push(guard(db, 'NOT EXISTS(SELECT 1 FROM rer_erasure_blobs WHERE operation=?)', id), completeStatement(db, id, new Date().toISOString()),
      ...cleanupStatements(ctx, d, plan, op.label), ...await verificationStatements(db, d, plan, id, op.label, { final: true }));
    if (!d.root.redact) batch.push(rootGoneStatement(db, d, plan));
    batch.push(forgetScope(db, id));
  }
  batch.push(db.prepare('DELETE FROM rer_erasure_guard'));
  try { await db.batch(batch); }
  catch (error) {
    if (/erasure_scope_changed/.test(String(error?.message ?? error))) return 'changed';
    if (/erasure_retained_missing/.test(String(error?.message ?? error))) throw new ErasureError('retained_row_missing', 409);
    if (/CHECK constraint failed/.test(String(error?.message ?? error))) throw new ErasureError('erasure_busy', 409);
    throw error;
  }
  return (await statement(db, 'SELECT phase FROM rer_erasure_operations WHERE id=?', id).first()).phase;
}
