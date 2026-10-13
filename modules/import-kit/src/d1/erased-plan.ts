import { targetIdentity } from './erasure-index.ts';
import { withdrawArtifacts } from './erased-artifacts.ts';
import type { ImportPlan, OriginalErasurePolicy } from '../types.ts';
import { canonicalJson, sha256, sourceIdentity } from '../provenance/identity.ts';
import { planFingerprint } from '../plan/index.ts';

/** Preserve source identity and ordinal while removing its entire personal record.
 * A permanent zero-effect decision prevents later replay, including after undo. */
export function erasePlanRecords(plan: ImportPlan, identities: Set<string>, policy?: OriginalErasurePolicy): ImportPlan {
  const next: ImportPlan = { ...plan, entries: [...plan.entries], source: { ...plan.source, records: [...plan.source.records], diagnostics: [...plan.source.diagnostics] }, counts: { ...plan.counts }, diagnostics: [...plan.diagnostics] };
  next.erasure ??= { reviewedFingerprint: plan.fingerprint };
  for (const [ordinal, original] of plan.entries.entries()) {
    if (!identities.has(original.identity) || original.erased) continue;
    const entry = { ...original, source: { ...original.source } };
    next.entries[ordinal] = entry;
    if (entry.effects.length !== 1) throw new Error('IMPORT_ERASURE_SHARED_SOURCE');
    if (entry.effects[0].attachment || (policy === undefined && next.source.artifacts.some(a => a.original?.status === 'available'))) throw new Error('IMPORT_ERASURE_RETAINED_ORIGINAL');
    const reason = 'Personal data erased by an operator; this source cannot be replayed.';
    const concernsRecord = (item: ImportPlan['diagnostics'][number]) => (!!item.kind && !!item.sourceId && identities.has(sourceIdentity(plan.destination, plan.namespace, item.kind, item.sourceId)))
      || (!!item.location && canonicalJson(item.location) === canonicalJson(entry.source.location));
    next.diagnostics = next.diagnostics.filter(item => !concernsRecord(item));
    next.source.diagnostics = next.source.diagnostics.filter(item => !concernsRecord(item));
    delete entry.rejection;
    const previousId = entry.source.sourceId;
    entry.source.sourceId = `erased:${entry.identity}`;
    entry.source.location = { artifact: entry.source.location.artifact };
    entry.source.payload = { erased: true };
    entry.source.payloadHash = sha256(canonicalJson(entry.source.payload));
    next.source.records = next.source.records.map(record => record.namespace === entry.source.namespace && record.kind === entry.source.kind && record.sourceId === previousId ? { ...entry.source } : record);
    next.counts.effects -= entry.effects.length;
    next.counts.mapped--;
    if (!entry.unmapped.length) next.counts.unmapped++;
    entry.erasedTargetIdentity = targetIdentity(plan.destination,entry.effects[0].targetKind,entry.effects[0].targetId);
    entry.effects = []; entry.unmapped = [{ reason }]; entry.erased = true;
    next.diagnostics.push({ severity: 'warning', code: 'ERASED_SOURCE', message: reason, kind: entry.source.kind, sourceId: entry.source.sourceId, location: entry.source.location });
  }
  withdrawArtifacts(plan, next, identities, policy);
  next.fingerprint = planFingerprint(next);
  return next;
}
