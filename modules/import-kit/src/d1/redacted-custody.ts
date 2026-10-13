import type { ImportPlan, TargetRow } from '../types.ts';
import type { D1FieldRedaction, D1ImportContext, D1Sql } from './types.ts';
import type { InventorySnapshot } from './inventory-snapshot.ts';
import { canonicalJson, sha256 } from '../provenance/identity.ts';
import { redactFields } from './field-redaction.ts';
import { withdrawnLocation } from './erased-artifacts.ts';
import { retainedSql } from './retained-values.ts';
import { changed, updateRows } from './expected-state.ts';
import { targetGuards } from './target-guards.ts';
import { guard } from './database.ts';

/** Keep attribution and revision identities; change only the erased fields and
 * their content bindings. A sanitized before-image is what undo will restore. */
export function redactedCustody(plan: ImportPlan, next: ImportPlan, id: string, snapshot: InventorySnapshot, fields: readonly D1FieldRedaction[]): D1Sql[] {
  const writes: D1Sql[] = [];
  for (const table of ['ik_provenance', 'ik_d1_history']) for (const row of snapshot.rows(table, 'job_id', [id])) {
    const entry = next.entries[row.ordinal], effect = entry.effects[row.effect_ordinal];
    if (!effect) continue; // Whole-record tombstones delete their provenance.
    const record = JSON.parse(row.record_json);
    const before = record.before ? { ...record.before, value: redactFields(record.before.value, fields) } : null;
    const body = canonicalJson({ ...record, sourceHash: entry.source.payloadHash, valueHash: sha256(canonicalJson(effect.value)),
      location: withdrawnLocation(plan, next, record.location, record.artifactHash), before });
    if (body === row.record_json) continue;
    writes.push(changed(retainedSql([`UPDATE ${table} SET record_json=`, ' WHERE id=', ''], [body, row.id], [0]),
      updateRows(table, item => item.id === row.id, item => ({ ...item, record_json: body }))));
  }
  return writes;
}

/** Sanitize the adapter's native set without claiming any unrelated edit as an
 * imported value. Provenance retains the sanitized planned hash; other edits
 * therefore continue to conflict on undo. */
export async function redactedNativeFields(kind: string, id: string, context: D1ImportContext, fields: readonly D1FieldRedaction[]): Promise<{ before: D1Sql[]; after: D1Sql[]; final: D1Sql[] }> {
  const { database: db, targets } = context.storage, destination = context.destination;
  const rows = await targets.list(db, destination);
  const before = targets.matchesMany ? targets.matchesMany(rows, destination).map(guard)
    : targets.matchesCount ? [guard(targets.matchesCount(rows.length, destination)), ...rows.flatMap(row => targetGuards(targets, row, destination, row.targetKind, row.targetId))] : [];
  if (!before.length) throw new Error('IMPORT_NATIVE_SET_GUARD_REQUIRED');
  const after: D1Sql[] = [], survivors: TargetRow[] = [];
  for (const row of rows) {
    if (row.targetKind === kind && row.targetId === id) continue;
    const value = redactFields(row.value, fields);
    const next = value === row.value ? row : { ...row, value };
    survivors.push(next);
    if (next !== row) after.push(...targetGuards(targets, row, destination, row.targetKind, row.targetId), ...targets.write(next));
    after.push(...targetGuards(targets, next, destination, row.targetKind, row.targetId));
  }
  const final = targets.matchesMany ? targets.matchesMany(survivors, destination).map(guard)
    : [guard(targets.matchesCount!(survivors.length, destination)), ...survivors.flatMap(row => targetGuards(targets, row, destination, row.targetKind, row.targetId))];
  return { before, after, final };
}
