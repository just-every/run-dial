import { statement, quote, guard, insist, ErasureError } from './sql.mjs';
import { rootStatements } from './root.mjs';
import { readScope, scopeStatements } from './scope.mjs';
import { verificationStatements, childAbsenceStatements } from './verification.mjs';
import { collect, matchSql, checkDeclared } from './plan.mjs';
import { auditStatements } from './audit.mjs';
import { progressStatement, committedStatement } from './receipt.mjs';
import { queueStatements, readQueue, consumeStatement, clearQueue, slicePlan, rootScopeExists } from './queue.mjs';

const where = (keys, table) => keys.get(table).pk.map(c => `${c === 'rowid' ? 'rowid' : quote(c)}=?`).join(' AND ');
const values = e => Object.values(e.key);

function redactStatements(db, d, plan) {
  const out = [];
  for (const item of d.redact) {
    const set = Object.keys(item.set).map(c => `${quote(c)}=?`).join(',');
    for (const m of matchSql(item, [...plan.known.get(item.from).values()])) {
      out.push(statement(db, `UPDATE ${quote(item.table)} SET ${set} WHERE ${m.where}`, ...Object.values(item.set), ...m.values));
    }
  }
  return out;
}

/** Deletes each entry with its blob key captured first and its portability tombstone beside it. */
export async function deletionStatements(ctx, d, plan, entries, id, deleted) {
  const { db, fence } = ctx, out = [];
  for (const e of entries) {
    const match = where(plan.keys, e.table);
    out.push(...childAbsenceStatements(db, plan, e));
    for (const blob of new Map(d.edges.filter(x => x.table === e.table && x.blob).map(x => [x.blob.bucket + '\0' + x.blob.keyColumn, x.blob])).values()) {
      out.push(statement(db, `INSERT OR IGNORE INTO rer_erasure_blobs(operation,bucket,key) SELECT ?,?,${quote(blob.keyColumn)} FROM ${quote(e.table)} WHERE ${match} AND ${quote(blob.keyColumn)} IS NOT NULL`, id, blob.bucket, ...values(e)));
    }
    out.push(statement(db, `DELETE FROM ${quote(e.table)} WHERE ${match}`, ...values(e)), ...await fence.row(e.table, e.key));
    deleted[e.table] = (deleted[e.table] ?? 0) + 1;
  }
  return out;
}
export async function firstStatements(ctx, d, plan, label) {
  return d.beforeStatements ? await d.beforeStatements({ db: ctx.db, subject: plan.subject, label }) : [];
}
// `relabel: false` (a slice of the plan) leaves the table-wide relabel of earlier audit rows to the final batch.
export const cleanupStatements = (ctx, d, plan, label, options) => [...redactStatements(ctx.db, d, plan), ...auditStatements(ctx.db, d, plan, label, options)];
/** Commits with the subject row: a second redaction/audit pass catches rows written
 * during a long erasure. Verify before removing the root (so triggers cannot hide
 * new children through CASCADE), then after final policy effects. */
export async function finalStatements(ctx, d, plan, id, label, now, deleted) {
  const { db } = ctx, out = [];
  if (plan) out.push(...cleanupStatements(ctx, d, plan, label), ...await rootStatements(ctx, d, plan, id));
  out.push(...await verificationStatements(db, d, plan, id, label, { final: true }));
  if (!d.root.redact) out.push(...await deletionStatements(ctx, d, plan, [plan.root], id, deleted));
  if (plan && d.statements) out.push(...await d.statements({ db, subject: plan.subject, label }));
  out.push(...cleanupStatements(ctx, d, plan, label));
  out.push(...await verificationStatements(db, d, plan, id, label, { final: true }));
  out.push(statement(db, 'UPDATE rer_erasure_operations SET blobs_total=(SELECT count(*) FROM rer_erasure_blobs WHERE operation=?) WHERE id=?', id, id), committedStatement(db, id, now));
  return out;
}

const lost = error => {
  if (/erasure_retained_missing/.test(String(error?.message ?? error))) throw new ErasureError('retained_row_missing', 409);
  if (/CHECK constraint failed/.test(String(error?.message ?? error))) throw new ErasureError('erasure_busy', 409);
  throw error;
};

/** A non-final step: deletes `entries` (a slice of the plan in deletion order)
 * and leaves `rest` queued. Everything the batch verifies is bounded by the
 * slice. Completeness is the final step's job, which collects the whole graph
 * again from the subject and every remembered parent. */
async function sliceStep(ctx, d, op, entries, { first = null, rest = null } = {}) {
  const { db, fence } = ctx, id = op.id, deleted = JSON.parse(op.deleted);
  const plan = await slicePlan(db, d, JSON.parse(op.subject), entries);
  const batch = [db.prepare('PRAGMA defer_foreign_keys=ON'),
    guard(db, "EXISTS(SELECT 1 FROM rer_erasure_operations WHERE id=? AND step=? AND phase='deleting')", id, op.step),
    ...await fence.transfers()];
  batch.push(...await scopeStatements(db, d, first ?? plan, id, first ? [...entries, first.root] : entries, { whole: Boolean(first) }));
  if (first) batch.push(...await firstStatements(ctx, d, plan, op.label));
  batch.push(...await verificationStatements(db, d, plan, id, op.label));
  batch.push(...cleanupStatements(ctx, d, plan, op.label, { relabel: false }));
  batch.push(...await deletionStatements(ctx, d, plan, entries, id, deleted));
  batch.push(...await verificationStatements(db, d, plan, id, op.label, { intake: false }));
  if (rest) batch.push(...queueStatements(db, id, rest));
  else batch.push(consumeStatement(db, id, entries.at(-1).seq));
  batch.push(progressStatement(db, id, op.step, deleted), db.prepare('DELETE FROM rer_erasure_guard'));
  try { await db.batch(batch); }
  catch (error) {
    if (/erasure_scope_changed/.test(String(error?.message ?? error))) { await clearQueue(db, id).run(); return 'changed'; }
    return lost(error);
  }
  return true;
}

/** One bounded, atomic D1 commit of up to `rows` dependents, leaves first. The
 * subject row commits with the last step. A concurrent runner loses the guard.
 * The first step collects and orders the whole plan and queues what it leaves;
 * later steps take their slice from the queue until it is empty. */
export async function step(ctx, d, id, { rows = 500 } = {}) {
  const { db, fence } = ctx;
  const op = await statement(db, 'SELECT * FROM rer_erasure_operations WHERE id=?', id).first();
  insist(op && op.entity === d.entity, 'erasure_not_found', 404);
  if (op.phase !== 'deleting') return false;
  const now = new Date().toISOString(), deleted = JSON.parse(op.deleted);
  await checkDeclared(db, d);
  insist(Number.isInteger(rows) && rows > 0, 'batch_rows');
  if (op.step > 0) {
    const slice = await readQueue(db, id, rows);
    if (slice.length) {
      insist(await rootScopeExists(db, id, d), 'erasure_scope_missing', 409);
      return sliceStep(ctx, d, op, slice);
    }
  }
  const remembered = await readScope(db, id);
  insist(op.step === 0 || remembered.some(e => e.table === d.root.table), 'erasure_scope_missing', 409);
  const plan = await collect(db, d, JSON.parse(op.subject), remembered);
  insist(plan && plan.root, 'subject_removed_outside_erasure', 409);
  const take = plan.order.slice(0, rows), final = take.length === plan.order.length;
  if (!final) return sliceStep(ctx, d, op, take, { first: op.step === 0 ? plan : null, rest: plan.order.slice(rows) });
  const batch = [db.prepare('PRAGMA defer_foreign_keys=ON'),
    guard(db, "EXISTS(SELECT 1 FROM rer_erasure_operations WHERE id=? AND step=? AND phase='deleting')", id, op.step),
    ...await fence.transfers()];
  batch.push(...await scopeStatements(db, d, plan, id, [...take, plan.root]));
  if (op.step === 0) batch.push(...await firstStatements(ctx, d, plan, op.label));
  batch.push(...await verificationStatements(db, d, plan, id, op.label));
  batch.push(...cleanupStatements(ctx, d, plan, op.label));
  batch.push(...await deletionStatements(ctx, d, plan, take, id, deleted));
  batch.push(...await finalStatements(ctx, d, plan, id, op.label, now, deleted));
  batch.push(clearQueue(db, id), progressStatement(db, id, op.step, deleted), db.prepare('DELETE FROM rer_erasure_guard'));
  try { await db.batch(batch); }
  catch (error) {
    if (/erasure_scope_changed/.test(String(error?.message ?? error))) return 'changed';
    return lost(error);
  }
  return false;
}
