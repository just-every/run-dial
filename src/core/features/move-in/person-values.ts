import { loadPlans } from '../../../../modules/import-kit/src/d1/plans.ts';
import { exactRows } from '../../../../modules/import-kit/src/d1/sets.ts';
import { readonlyChecks } from '../../../../modules/import-kit/src/d1/database.ts';
import type { SourceRecord, ImportPlan } from '../../../../modules/import-kit/src/types.ts';
import type { D1FieldRedaction } from '../../../../modules/import-kit/src/d1/index.ts';
import { importContext } from './service';
import { stableId, type NativeValue } from './model';
import { foldEmail, emailFoldSql } from '../erasure';
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
// import-kit accepts selector values up to this length.
const selectorLimit = 4096;
type Path = (string | number)[];
function leaves(value: unknown, path: Path, out: D1FieldRedaction[]) {
  if (typeof value === 'string') { if (value.trim()) out.push({ path, value }); }
  else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, [...path, index], out));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) leaves(item, [...path, key], out);
}
const at = (value: unknown, path: Path) => path.reduce<unknown>((node, segment) => node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined, value);
/** Kit selectors match exact leaves in every retained record of the destination.
 * Keep a leaf another record holds verbatim at the same path (a status, a
 * question, a time zone): only the person's own invitee objects may change. */
function sharedInviteeFields(plans: Iterable<ImportPlan>, candidates: D1FieldRedaction[], email: string) {
  const own = (payload: unknown, index: unknown) => {
    const invitee = at(payload, ['raw', 'invitees', index as number]) as Invitee | undefined;
    return typeof invitee?.email === 'string' && foldEmail(invitee.email) === foldEmail(email);
  };
  const values: unknown[] = [];
  for (const plan of plans) {
    for (const record of plan.source.records) values.push(record.payload);
    for (const entry of plan.entries) values.push(entry.source.payload, ...entry.effects.map(effect => effect.value));
  }
  const shared = new Set(candidates.filter(field => values.some(value => at(value, [...field.path]) === field.value && !own(value, field.path[2]))));
  return [...new Map(candidates.filter(field => !shared.has(field)).map(field => [JSON.stringify([field.path, field.value]), field])).values()];
}
/** Capture exact identifiers before native deletion, including source identities
 * no longer present natively. Names and free answers are not identifiers: target
 * erasure removes them without retiring unrelated imports sharing those words.
 * Inside another person's imported booking only the person's invitee object is
 * theirs; `sharedFields` selects its leaves for field redaction. */
export async function importPersonValues(db: D1Database, email: string, session: SessionRecord, bookingId?: string) {
  const values = new Set<string>([email, foldEmail(email)]), custodyOnly = new Set<string>();
  const candidates: D1FieldRedaction[] = [], sharedInvitees = new Set<string>();
  let hasCustody = false;
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
        if (native ? foldEmail(native.invitee_email) !== foldEmail(email) : peerEffect) {
          const raw = (entry.source.payload as { raw?: { invitees?: Invitee[] } }).raw?.invitees ?? [];
          raw.forEach((invitee, index) => { if (invitees.includes(invitee)) leaves(invitee, ['raw', 'invitees', index], candidates); });
          for (const person of invitees) if (typeof person.uri === 'string') sharedInvitees.add(person.uri);
        } else if (!native) custodyOnly.add(entry.source.sourceId);
      }
    }
  }
  const guards = readonlyChecks(exactRows('ik_jobs', ['id', 'fingerprint'], jobs, { sql: 'destination=?', params: [context.destination] }));
  const sharedFields = sharedInviteeFields(plans.values(), candidates, email);
  return { values: [...values], custodyOnly: [...custodyOnly], sharedFields, sharedInvitees: [...sharedInvitees], oversized: sharedFields.some(field => field.value.length > selectorLimit), hasCustody, guards };
}
