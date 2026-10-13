import { loadPlans } from '../../../../modules/import-kit/src/d1/plans.ts';
import { exactRows } from '../../../../modules/import-kit/src/d1/sets.ts';
import { readonlyChecks } from '../../../../modules/import-kit/src/d1/database.ts';
import type { SourceRecord } from '../../../../modules/import-kit/src/types.ts';
import { importContext } from './service';
import { stableId, type NativeValue } from './model';
import { foldEmail, emailFoldSql } from '../erasure/identity';
import type { SessionRecord } from '../operators';

type Invitee = { email?: unknown; uri?: unknown };
export function personInvitees(source: SourceRecord, email: string): Invitee[] {
  if (source.kind !== 'booking') return [];
  const raw = (source.payload as { raw?: { invitees?: Invitee[] } })?.raw;
  return (raw?.invitees ?? []).filter(row => typeof row.email === 'string' && foldEmail(row.email) === foldEmail(email));
}
function add(values: Set<string>, value: unknown) {
  if (typeof value === 'string' && value.trim()) values.add(value);
}
/** Capture exact identifiers before native deletion, including source identities
 * no longer present natively. Names and free answers are not identifiers: target
 * erasure removes them without retiring unrelated imports sharing those words. */
export async function importPersonValues(db: D1Database, email: string, session: SessionRecord, bookingId?: string) {
  const values = new Set<string>([email, foldEmail(email)]), custodyOnly = new Set<string>();
  let sharedCustody = false, hasCustody = false;
  const rows = (await db.prepare(`SELECT invitee_email FROM bookings WHERE ${bookingId ? 'id=?' : 'invitee_email_folded=?'}`).bind(bookingId ?? foldEmail(email)).all<{ invitee_email: string }>()).results;
  for (const row of rows) add(values, row.invitee_email);
  if (!bookingId) {
    const requests = (await db.prepare(`SELECT invitee_email FROM availability_requests WHERE ${emailFoldSql('invitee_email')}=?`).bind(foldEmail(email)).all<{ invitee_email: string }>()).results;
    for (const row of requests) add(values, row.invitee_email);
  }
  const context = importContext(db, session);
  const jobs = (await db.prepare("SELECT * FROM ik_jobs WHERE destination='dial'").all<{ id: string; fingerprint: string; plan_json: string }>()).results;
  const plans = await loadPlans(jobs, db, context.storage.targets.planCodec);
  for (const job of jobs) {
    const plan = plans.get(job.id)!;
    for (const entry of plan.entries) {
      if (entry.erased) continue;
      const invitees = personInvitees(entry.source, email);
      for (const person of invitees) { add(values, person.email); add(values, person.uri); }
      if (invitees.length) {
        hasCustody = true;
        const id = stableId(entry.source.sourceId);
        const native = await db.prepare('SELECT invitee_email FROM bookings WHERE id=?').bind(id).first<{ invitee_email: string }>();
        // The event identity belongs to its active invitee, not every invitee in
        // the saved event. Also inspect retained effects: an undone or pending
        // import can own a peer's booking without a current native row.
        const peerEffect = entry.effects.some(effect => effect.targetKind === 'booking'
          && (effect.value as unknown as NativeValue).tables.bookings.some(row => typeof row.invitee_email === 'string' && foldEmail(row.invitee_email) !== foldEmail(email)));
        if (native ? foldEmail(native.invitee_email) !== foldEmail(email) : peerEffect) sharedCustody = true;
        else if (!native) custodyOnly.add(entry.source.sourceId);
      }
    }
  }
  const guards = readonlyChecks(exactRows('ik_jobs', ['id', 'fingerprint'], jobs, { sql: 'destination=?', params: [context.destination] }));
  return { values: [...values], custodyOnly: [...custodyOnly], sharedCustody, hasCustody, guards };
}
