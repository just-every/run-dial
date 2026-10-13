import { erasedCustody } from './erased-custody.ts';
import { targetGuards } from './target-guards.ts';
import type { D1ImportContext, D1Sql } from './types.ts';
import { requestContext, packGuards, remaining, D1RequestLimitError } from './budget.ts';
import { readAtomic, authority, finalAuthority, guard, sql, prepare } from './database.ts';
import { decode } from './jobs.ts';
import { retainPlan } from './plans.ts';
import { inventoryGuards, custodyGuards } from './integrity.ts';
import { readOriginals } from './originals.ts';
import { exactRows, jsonChunks, selectedCounts, selectKeys } from './sets.ts';
import { canonicalJson, sha256, requireText } from '../provenance/identity.ts';
import { erasePlanRecords } from './erased-plan.ts';
import { indexedDestinationGuard, targetIdentity, unindexedJobs } from './erasure-index.ts';
import { readInventorySnapshot } from './inventory-snapshot.ts';
import { erasureWrites, type ErasedDecision, type ErasedJob } from './erasure-writes.ts';
import { stagedSourceIdentities, stageErasure } from './staging-erasure.ts';
import { attachReversal, loadReversalState, reversalGuards, policyHash } from './undo-state.ts';
import { eraseReversalEvidence } from './erased-reversal.ts';
import type { ImportPlan } from '../types.ts';
import { changed, deleteRows } from './expected-state.ts';
import { eraseBounded } from './erasure-bounded.ts';
import { originalVersions } from './original-storage.ts';

/** Erase one normalized native entity and every retained copy of its source.
 * nativeStatements execute in the same D1 batch as all kit custody changes.
 * Current erase authority is destination-scoped, independently of job ownership. */
export async function eraseD1ImportTarget(kind: string, id: string, nativeStatements: D1Sql[], context: D1ImportContext): Promise<{ nativeResults: unknown[]; erasedRecords: number }> {
  context = requestContext(context);
  if (context.originalErasurePolicy !== undefined && !['withdraw-affected-artifacts', 'withdraw-all-job-artifacts'].includes(context.originalErasurePolicy)) throw new Error('INVALID_ORIGINAL_ERASURE_POLICY');
  requireText(kind, 'target kind'); requireText(id, 'target id');
  await readAtomic(context, [], undefined, 'erase');
  if(context.maxBatchBytes!==undefined)return eraseBounded(kind,id,nativeStatements,context);
  const { database: db, targets } = context.storage;
  if (await db.prepare(`${unindexedJobs} LIMIT 1`).bind(context.destination).first()) throw new Error('IMPORT_ERASURE_INDEX_UPGRADE_REQUIRED');
  const digest = targetIdentity(context.destination, kind, id);
  const targetRows = await selectKeys(db, 'ik_d1_plan_index', 'target_identity', [digest]);
  const identities = new Set<string>([...targetRows.map(row => row.source_identity), ...await stagedSourceIdentities(digest, context)]);
  const privateErasure = stageErasure(context.destination, digest, [...identities]);
  const sourceRows = await selectKeys(db, 'ik_d1_plan_index', 'source_identity', [...identities]);
  const ids = [...new Set(sourceRows.map(row => row.job_id))];
  const snapshot = await readInventorySnapshot(ids, db, targets.planCodec);
  const before: D1Sql[] = [indexedDestinationGuard(context.destination), ...privateErasure.before,
    ...selectedCounts('ik_d1_plan_index', 'target_identity', [digest], targetRows),
    ...selectedCounts('ik_d1_plan_index', 'source_identity', [...identities], sourceRows),
    ...exactRows('ik_d1_plan_index', ['job_id','ordinal','source_identity','target_identity'], sourceRows)];
  const after: D1Sql[] = [], changedJobs: ErasedJob[] = [], decisions: ErasedDecision[] = [];
  const changedPlans = new Map<string, ImportPlan>();
  for (const raw of snapshot.rows('ik_jobs', 'id', ids)) {
    const plan = snapshot.plans.get(raw.id)!;
    if (plan.destination !== context.destination || !plan.entries.some(entry => identities.has(entry.identity))) throw new Error('IMPORT_ERASURE_INDEX_MISMATCH');
    if (plan.entries.some(entry => identities.has(entry.identity) && entry.effects.some(effect => effect.targetKind !== kind || effect.targetId !== id))) throw new Error('IMPORT_ERASURE_SHARED_SOURCE');
    const job = decode(raw);
    const reversal = await loadReversalState(raw, plan, context, false);
    attachReversal(job, reversal); before.push(...reversalGuards(job.id, reversal));
    await readOriginals(plan, job.id, context, snapshot);
    before.push(...custodyGuards(plan, job.id), ...await inventoryGuards(job, plan, context, snapshot));
    const next = erasePlanRecords(plan, identities, context.originalErasurePolicy), retained = retainPlan(next, job.id, next.source.artifacts.some(a => a.original?.status === 'available') ? undefined : targets.planCodec);
    originalVersions.set(next,originalVersions.get(plan)!);
    changedPlans.set(job.id, next);
    after.push(...erasedCustody(plan, next, job.id, snapshot), ...retained.statements);
    after.push(guard(sql('(SELECT count(*) FROM ik_d1_creation_plans WHERE job_id=? AND released=0)=? AND (SELECT count(*) FROM ik_d1_plan_chunks WHERE job_id=?)=?', job.id, retained.encoded.chunks.length, job.id, retained.encoded.chunks.length)));
    changedJobs.push({ id: job.id, body: retained.body, fingerprint: next.fingerprint, erasedRecords: next.entries.filter(entry => entry.erased).length, policyHash: reversal.binding === null ? null : policyHash(job.id, next.fingerprint, reversal.policy) });
    // Changing the fingerprint fences stale apply/undo evidence while preserving
    // the apply journal's sequential fences for a partially imported file.
    for (const [ordinal, entry] of next.entries.entries()) {
      if (!identities.has(entry.identity)) continue;
      decisions.push({ job_id: job.id, ordinal, identity: entry.identity, source_hash: entry.source.payloadHash, effects_hash: sha256(canonicalJson(entry.effects)) });
    }
  }
  const releaseCopies = jsonChunks(ids).flatMap(chunk => [sql('UPDATE ik_d1_creation_plans SET released=1 WHERE job_id IN (SELECT value FROM json_each(?))', chunk), sql('DELETE FROM ik_d1_creation_plans WHERE job_id IN (SELECT value FROM json_each(?))', chunk)]);
  const removeChunks = [...releaseCopies, ...jsonChunks(ids).map(chunk => {const selected=new Set(JSON.parse(chunk));return changed(sql('DELETE FROM ik_d1_plan_chunks WHERE job_id IN (SELECT value FROM json_each(?))', chunk),deleteRows('ik_d1_plan_chunks',row=>selected.has(row.job_id)));})];
  after.unshift(...removeChunks);
  const reports = await eraseReversalEvidence(context, changedPlans);
  before.push(...reports.before);
  after.push(...releaseCopies, ...erasureWrites(changedJobs, decisions), ...reports.after, ...privateErasure.after);
  for (const [id, next] of changedPlans) after.push(...custodyGuards(next, id));
  for (const chunk of jsonChunks([...identities])) after.push(sql('INSERT OR IGNORE INTO ik_d1_erased_sources(destination,identity) SELECT ?,value FROM json_each(?)', context.destination, chunk));
  after.push(sql('INSERT OR IGNORE INTO ik_d1_erased_targets(destination,identity) VALUES(?,?)', context.destination, digest));
  const target = await targets.read(db, context.destination, kind, id);
  before.push(...targetGuards(targets,target ?? null, context.destination, kind, id));
  after.push(...targetGuards(targets,null, context.destination, kind, id));
  const prefix = packGuards([authority(context, 'erase'), ...before]);
  // Assertion cleanup can itself revoke authority through native SQL triggers.
  // The last statement must abort the same batch without creating another row.
  const suffix = [...packGuards([...after, authority(context, 'erase'), sql('DELETE FROM ik_d1_assertions')]), finalAuthority(context, 'erase')];
  if (prefix.length + nativeStatements.length + suffix.length > remaining(context)) throw new D1RequestLimitError();
  const results = await db.batch([...prefix, ...nativeStatements, ...suffix].map(statement => prepare(db, statement)));
  return { nativeResults: results.slice(prefix.length, prefix.length + nativeStatements.length), erasedRecords: decisions.length };
}
