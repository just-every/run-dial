import type { D1ImportContext, D1RelatedErasure, D1Sql } from './types.ts';
import { sql } from './database.ts';
import { loadPlans } from './plans.ts';
import { readOriginals } from './originals.ts';
import { exactRows } from './sets.ts';
import { redactFields } from './field-redaction.ts';

export interface RelatedSelection { identities: Set<string>; originals: Map<string, Set<string>>; guards: D1Sql[]; redactedJobs: Set<string> }

/** Visit every retained plan and original in the destination once. The exact job
 * set and fingerprints are fenced, so a job created or changed after this scan
 * aborts the erasure instead of keeping an unscanned copy. */
export async function relatedSelection(context: D1ImportContext, related: D1RelatedErasure): Promise<RelatedSelection> {
  const db = context.storage.database;
  const { results: rows } = await db.prepare('SELECT * FROM ik_jobs WHERE destination=? ORDER BY id').bind(context.destination).all<any>();
  const identities = new Set<string>(), originals = new Map<string, Set<string>>(), redactedJobs = new Set<string>();
  const fields = related.fields ?? [];
  for (const row of rows) {
    const plan = (await loadPlans([row], db, context.storage.targets.planCodec)).get(row.id)!;
    if (related.source) for (const entry of plan.entries) if (!entry.erased && related.source(entry.source)) identities.add(entry.identity);
    if (fields.length) {
      if (plan.entries.some(entry => redactFields(entry.source.payload, fields) !== entry.source.payload || entry.effects.some(effect => redactFields(effect.value, fields) !== effect.value))) redactedJobs.add(row.id);
    }
    if (!related.original) continue;
    for (const original of await readOriginals(plan, row.id, context)) {
      if (original.kind !== 'artifact' || original.original.status !== 'retained') continue;
      if (!related.original(Buffer.from(original.original.base64, 'base64'), { name: original.name, sha256: original.sha256 })) continue;
      if (!originals.has(row.id)) originals.set(row.id, new Set());
      originals.get(row.id)!.add(original.sha256);
    }
  }
  const guards = exactRows('ik_jobs', ['id', 'fingerprint'], rows.map(row => ({ id: row.id, fingerprint: row.fingerprint })), sql('destination=?', context.destination));
  if (fields.length) {
    // Fence every before-image, including jobs whose current values are clean.
    for (const table of ['ik_provenance', 'ik_d1_history']) {
      const scope = sql('job_id IN (SELECT id FROM ik_jobs WHERE destination=?)', context.destination);
      const { results } = await db.prepare(`SELECT * FROM ${table} WHERE ${scope.sql}`).bind(...scope.params!).all<any>();
      guards.push(...exactRows(table, ['id', 'job_id', 'record_json'], results, scope));
      for (const raw of results) { const before = JSON.parse(raw.record_json).before; if (before && redactFields(before.value, fields) !== before.value) redactedJobs.add(raw.job_id); }
    }
    // Incomplete private plans cannot be safely field-rewritten. Cancel every
    // private preparation in this destination atomically, including other actors.
    for (const table of ['ik_d1_staging', 'ik_d1_native_staging']) {
      const { results } = await db.prepare(`SELECT id FROM ${table} WHERE destination=?`).bind(context.destination).all();
      guards.push(...exactRows(table, ['id'], results, sql('destination=?', context.destination)));
    }
  }
  return { identities, originals, guards, redactedJobs };
}
