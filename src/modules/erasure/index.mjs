import { defineErasure, buckets as declaredBuckets } from './declaration.mjs';
import { collect, counts, planHash, checkDeclared } from './plan.mjs';
import { step, firstStatements, cleanupStatements, deletionStatements, finalStatements } from './cascade.mjs';
import { verificationStatements } from './verification.mjs';
import { scopeStatements } from './scope.mjs';
import { deleteBlobs } from './blobs.mjs';
import { newLabel } from './audit.mjs';
import { receipt, activeFor, openStatement, progressStatement } from './receipt.mjs';
import { fenceCalls, toD1Sql } from './fence.mjs';
import { insist, randomHex } from './sql.mjs';
export { defineErasure } from './declaration.mjs';
export { ErasureError } from './sql.mjs';
export { toD1Sql } from './fence.mjs';
export { rateEdges, rateCorrelation, rateWrite } from './rate.mjs';

export function createErasure({ db, buckets = {}, portability, declarations }) {
  const list = declarations.map(d => d.deleted ? d : defineErasure(d));
  insist(new Set(list.map(d => d.entity)).size === list.length, 'duplicate_entity');
  for (const name of declaredBuckets(list)) insist(buckets[name] && typeof buckets[name].delete === 'function' && typeof buckets[name].head === 'function', 'missing_bucket:' + name);
  if (list.some(d => d.root.redact)) insist(typeof portability?.redactionStatements === 'function', 'portability_redaction_service');
  const ctx = { db, buckets, fence: fenceCalls(portability) };
  const entity = name => { const d = list.find(x => x.entity === name); insist(d, 'unknown_entity', 404); return d; };
  const subjectPlan = async (d, subject) => { const plan = await collect(db, d, subject); insist(plan, 'subject_not_found', 404); await checkDeclared(db, d); return plan; };
  async function summary(d, plan) {
    const totals = await counts(db, d, plan);
    return { ...totals, retained: [...d.retain.map(({ table, reason }) => ({ table, reason })), ...(d.root.redact ? [{ table: d.root.table, reason: d.root.redact.reason }] : [])], planHash: await planHash(d, plan, totals) };
  }
  async function opened(id) { return entity((await receipt(db, id)).entity); }
  const service = {
    /** Counts only: no stored value of the subject or its dependents is returned. */
    async preview(name, subject) {
      const d = entity(name), plan = await subjectPlan(d, subject), result = await summary(d, plan);
      return { entity: d.entity, ...result, hold: d.hold ? await d.hold({ db, subject: plan.subject }) ?? null : null };
    },
    /** Opens (or returns the already open) erasure for one subject. */
    async start(name, subject, { planHash: expected } = {}) {
      const d = entity(name), active = await activeFor(db, d, subject);
      if (active) return active;
      const plan = await subjectPlan(d, subject), totals = await summary(d, plan);
      if (expected !== undefined) insist(expected === totals.planHash, 'plan_changed', 409);
      const reason = d.hold ? await d.hold({ db, subject: plan.subject }) : null;
      insist(!reason, 'held:' + reason, 409);
      const id = randomHex(16);
      try { await openStatement(db, d, { id, subject: plan.subject, label: newLabel(), planned: totals.deleted, blobs: totals.blobs, now: new Date().toISOString() }).run(); }
      catch (error) { const raced = await activeFor(db, d, subject); if (raced) return raced; throw error; }
      return receipt(db, id);
    },
    /** D1 phase: bounded atomic steps until every row is gone or `until` passes. */
    async commit(id, { rows, until = Infinity } = {}) {
      const d = await opened(id);
      let changes = 0;
      for (;;) {
        const result = await step(ctx, d, id, { rows });
        if (result === 'changed') {
          insist(++changes < 3, 'erasure_scope_unstable', 409);
        } else changes = 0;
        if (!result || Date.now() > until) break;
      }
      return receipt(db, id);
    },
    /** Blob phase: separately callable, resumable, complete only when every object is gone. */
    async deleteBlobs(id, options) { await deleteBlobs(ctx, await opened(id), id, options); return receipt(db, id); },
    async run(id, { rows, until = Infinity } = {}) {
      const after = await service.commit(id, { rows, until });
      return after.phase === 'blobs' && Date.now() <= until ? service.deleteBlobs(id, { until }) : after;
    },
    receipt: id => receipt(db, id),
    /** The whole D1 phase as import-kit `D1Sql`, for `eraseD1ImportTarget(kind,id,nativeStatements,ctx)`.
     * Run `deleteBlobs(operationId)` after that batch commits. */
    async nativeStatements(name, subject) {
      const d = entity(name);
      insist(!await activeFor(db, d, subject), 'erasure_open', 409);
      const plan = await subjectPlan(d, subject), totals = await summary(d, plan);
      const reason = d.hold ? await d.hold({ db, subject: plan.subject }) : null;
      insist(!reason, 'held:' + reason, 409);
      const id = randomHex(16), label = newLabel(), now = new Date().toISOString(), deleted = {};
      const statements = [...await ctx.fence.transfers(), openStatement(db, d, { id, subject: plan.subject, label, planned: totals.deleted, blobs: totals.blobs, now }),
        ...await scopeStatements(db, d, plan, id), ...await firstStatements(ctx, d, plan, label), ...await verificationStatements(db, d, plan, id, label), ...cleanupStatements(ctx, d, plan, label), ...await deletionStatements(ctx, d, plan, plan.order, id, deleted),
        ...await finalStatements(ctx, d, plan, id, label, now, deleted), progressStatement(db, id, 0, deleted), db.prepare('DELETE FROM rer_erasure_guard')];
      return { operationId: id, statements: statements.map(toD1Sql) };
    },
  };
  return service;
}

