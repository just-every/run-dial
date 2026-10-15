import { retireD1ImportCustody, type D1FieldRedaction, type D1Sql } from '../../../../modules/import-kit/src/d1/index.ts';
import { readonlyChecks } from '../../../../modules/import-kit/src/d1/database.ts';
import { retirementScope, headerAbsence } from '../../../../modules/import-kit/src/d1/retirement-scope.ts';
import type { SessionRecord } from '../operators';
import { ErasureRepository, erasurePortability, erasureAuthority } from '../erasure';
import { ErasureError, toD1Sql } from '../../../modules/erasure/index.mjs';
import { importContext } from './service';
import { importPersonValues, personInvitees } from './person-values';
import { stableId } from './model';
import { recordErasedInvitees } from './erased-invitees';

/** Personal deletion, custody changes and the real restore checkpoint commit together. */
export async function eraseImportedBooking(db: D1Database, id: string, session: SessionRecord, secret: string) {
  const marker = await db.prepare("SELECT b.invitee_email AS email FROM move_in_targets m JOIN bookings b ON b.id=m.id WHERE m.kind='booking' AND m.id=?").bind(id).first<{ email: string }>();
  if (!marker) return undefined;
  const person = await importPersonValues(db, marker.email, session, id);
  const context = { ...importContext(db, session), originalErasurePolicy: 'withdraw-all-job-artifacts' as const };
  return new ErasureRepository(db, secret).booking(id, session, async statements => {
    const fence = await erasurePortability(db);
    await retireD1ImportCustody({ target: { kind: 'booking', id }, values: person.values }, statements, context, (await fence.redactionStatements()).map(toD1Sql));
  });
}

/** Rejected, past and undone sources still belong to the person even without a
 * live native booking. The stable booking identity is the importer's identity. */
export async function erasePersonSourceCustody(db: D1Database, email: string, sources: string[], values: string[], session: SessionRecord) {
  const context = { ...importContext(db, session), originalErasurePolicy: 'withdraw-all-job-artifacts' as const };
  for (const sourceId of sources) {
    const fence = await erasurePortability(db);
    await retireD1ImportCustody({ target: { kind: 'booking', id: stableId(sourceId) }, values,
      related: { source: source => source.sourceId === sourceId && personInvitees(source, email).length > 0 } }, [], context, (await fence.redactionStatements()).map(toD1Sql));
  }
}

/** A person who is one invitee of another person's imported booking (a
 * cancelled guest) leaves that record by field redaction: their invitee leaves
 * leave every payload, before-image and original, while the peer's effects,
 * resume and undo stay. Their opaque invitee identity refuses a later replay. */
export async function erasePersonSharedCustody(db: D1Database, values: string[], fields: D1FieldRedaction[], invitees: string[], session: SessionRecord) {
  if (!fields.length) return;
  const context = { ...importContext(db, session), originalErasurePolicy: 'withdraw-all-job-artifacts' as const };
  const fence = await erasurePortability(db);
  await retireD1ImportCustody({ values, related: { fields } }, recordErasedInvitees(context.destination, invitees), context, (await fence.redactionStatements()).map(toD1Sql));
}

/** A person can exist only in a header. No artificial target is invented: the
 * kit retires that header's closure with the final native receipt writes. If
 * there is no such custody, absence guards keep those writes fail-closed. */
export async function finishPersonCustody(db: D1Database, email: string, values: string[], statements: D1Sql[], session: SessionRecord) {
  // Imports may have been created after the first person scan or between native
  // deletions. Recheck before completing, then fence the exact destination job
  // set and fingerprints in the receipt transaction so a later import aborts it.
  const custody = await importPersonValues(db, email, session);
  if (custody.hasCustody) throw new ErasureError('erasure_incomplete', 503);
  const context = importContext(db, session), scope = await retirementScope(db, context.destination, values);
  if (scope.jobs.length || scope.streams.length || scope.stages.length || scope.anchors.length) {
    const fence = await erasurePortability(db), checkpoint = (await fence.redactionStatements()).map(toD1Sql);
    await retireD1ImportCustody({ values }, [...custody.guards, ...statements], context, checkpoint);
  } else {
    const guards = [...custody.guards, ...readonlyChecks(headerAbsence(context.destination, values))];
    const writes: D1Sql[] = [...guards, ...statements, ...guards, erasureAuthority(session)];
    await db.batch(writes.map(statement => db.prepare(statement.sql).bind(...statement.params ?? [])));
  }
}
