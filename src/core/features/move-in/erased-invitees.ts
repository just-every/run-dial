import type { D1ImportContext, D1Sql, ImportPlan } from '../../../../modules/import-kit/src/d1/index.ts';
import { sourceIdentity } from '../../../../modules/import-kit/src/provenance/identity.ts';
import { jsonChunks } from '../../../../modules/import-kit/src/d1/sets.ts';
import { namespace } from './source';

// An invitee erased from another person's booking keeps only this opaque
// tombstone, beside the kit's erased source identities, so a later upload of a
// saved export that still holds them is refused like an erased booking.
export const inviteeIdentity = (destination: string, uri: string) => sourceIdentity(destination, namespace, 'invitee', uri);

export const recordErasedInvitees = (destination: string, uris: string[]): D1Sql[] =>
  uris.map(uri => ({ sql: 'INSERT OR IGNORE INTO ik_d1_erased_sources(destination,identity) VALUES(?,?)', params: [destination, inviteeIdentity(destination, uri)] }));

function planInvitees(plan: ImportPlan) {
  const identities = new Set<string>();
  for (const record of plan.source.records) {
    if (record.kind !== 'booking') continue;
    const invitees = (record.payload as { raw?: { invitees?: { uri?: unknown }[] } }).raw?.invitees ?? [];
    for (const invitee of invitees) if (typeof invitee.uri === 'string') identities.add(inviteeIdentity(plan.destination, invitee.uri));
  }
  return [...identities];
}

const absent = (destination: string, chunk: string): D1Sql => ({ sql: 'NOT EXISTS(SELECT 1 FROM ik_d1_erased_sources WHERE destination=? AND identity IN (SELECT value FROM json_each(?)))', params: [destination, chunk] });

/** Checks the upload's own invitees, before any stored plan is reused: a field
 * redaction leaves the peer's job live, so a replay must not answer "already here". */
export async function guardErasedInvitees(destination: string, uris: string[], db: D1Database) {
  for (const chunk of jsonChunks([...new Set(uris)].map(uri => inviteeIdentity(destination, uri)))) {
    const predicate = absent(destination, chunk);
    if (!(await db.prepare(`SELECT ${predicate.sql} AS clear`).bind(...predicate.params!).first<{ clear: number }>())?.clear) throw new Error('This saved source contains erased personal data and cannot be replayed.');
  }
}

/** The same fact inside atomic job creation: an erasure between review and apply aborts the apply. */
export function fenceErasedInvitees(context: D1ImportContext, plan: ImportPlan): D1ImportContext {
  const predicates = jsonChunks(planInvitees(plan)).map(chunk => absent(plan.destination, chunk));
  if (!predicates.length) return context;
  return { ...context, authorization: { ...context.authorization, predicate(action, destination) {
    const authority = context.authorization.predicate(action, destination);
    return { sql: [`(${authority.sql})`, ...predicates.map(item => `(${item.sql})`)].join(' AND '), params: [...authority.params ?? [], ...predicates.flatMap(item => item.params ?? [])] };
  } } };
}
