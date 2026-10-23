import { foldEmail, mailRecipientMatches, emailFoldSql, personalRecords } from "./identity";
import { ErasureError, toD1Sql, type PortabilityFence } from "../../../modules/erasure/index.mjs";
import type { ErasureStatement } from "./booking-statements";
// @ts-expect-error Maintained native authentication hashing implementation.
import { hashToken } from "../../../../modules/operator-auth/crypto.mjs";

export async function deleteRows(db: D1Database, fence: PortabilityFence, table: string, where: string, params: unknown[]): Promise<ErasureStatement[]> {
  const columns = (await db.prepare(`PRAGMA table_info("${table}")`).all<{ name: string; pk: number }>()).results;
  const pk = columns.filter(column => column.pk).sort((a,b) => a.pk-b.pk).map(column => column.name);
  const keys = pk.length ? pk : ["rowid"];
  const rows = (await db.prepare(`SELECT ${keys.map(key => `"${key}"`).join(",")} FROM "${table}" WHERE ${where}`).bind(...params).all<Record<string, string | number | null>>()).results;
  const statements: ErasureStatement[] = [];
  for (const key of rows) {
    statements.push(...(await fence.erasureStatements(table, key)).map(toD1Sql));
    statements.push({ sql: `DELETE FROM "${table}" WHERE ${keys.map(column => `"${column}" IS ?`).join(" AND ")}`, params: keys.map(column => key[column]) });
  }
  return statements;
}

/** Clear each stored spelling before its last record disappears. Unstored native
 * authentication aliases remain the separately documented maintained-hook gap. */
async function knownRateStatements(db: D1Database, fence: PortabilityFence, secret: string, aliases: string[]) {
  const statements: ErasureStatement[] = [];
  for (const scope of ["magic", "bootstrap", "review", "invite", "step-up"]) for (const address of new Set(aliases.map(value=>value.trim().toLowerCase()))) {
    const key = await hashToken(secret, "rate", `${scope}:email:${address}`);
    statements.push(...await deleteRows(db, fence, "oa_limits", "key=?", [key]));
  }
  return statements;
}

export async function recordAddressStatements(db: D1Database, fence: PortabilityFence, table: "bookings" | "availability_requests", id: string, secret: string) {
  const row = await db.prepare(`SELECT invitee_email AS email FROM ${table} WHERE id=?`).bind(id).first<{ email: string }>();
  if (!row) return [];
  const others = await personalRecords(db,row.email);
  if (others.bookings.some(other=>table!=="bookings"||other!==id) || others.requests.some(other=>table!=="availability_requests"||other!==id) || others.approvals.length>0) {
    return knownRateStatements(db,fence,secret,others.addresses);
  }
  return addressRemainders(db,fence,row.email,secret,others.addresses);
}

export async function addressRemainders(db: D1Database, fence: PortabilityFence, email: string, secret: string, aliases: string[] = [email]) {
  const statements = await knownRateStatements(db,fence,secret,aliases);
  statements.push(...await deleteRows(db,fence,"client_remember_links","email=?",[foldEmail(email)]));
  for(const [table,where] of [["poll_votes","participant_id IN(SELECT id FROM poll_participants WHERE email=?)"],["poll_vote_tokens","participant_id IN(SELECT id FROM poll_participants WHERE email=?)"],["poll_participants","email=?"]]) statements.push(...await deleteRows(db,fence,table,where,[foldEmail(email)]));
  // Remove the external attendee using the same managed event; the dispatch reads remaining guests after deletion.
  statements.push({sql:`INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),'calendar_upsert','guest-erasure:'||lower(hex(randomblob(16))),b.id,o.id,
      json_object('bookingId',b.id,'icalUid',b.ical_uid,'eventTitle',b.event_title,'startAt',o.start_at,'endAt',o.end_at,'hostTimezone',b.host_timezone,'invitee',json_object('name',b.invitee_name,'email',b.invitee_email),'location',b.location_value,'locationType',b.location_type),
      'pending',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.state<>'cancelled' AND b.calendar_required=1 AND EXISTS(SELECT 1 FROM booking_guests g WHERE g.booking_id=b.id AND ${emailFoldSql("g.email")}=?)`,params:[foldEmail(email)]});
  // Retire selection replay hashes that incorporated the erased guest's submitted address.
  statements.push(...await deleteRows(db,fence,"booking_nonces",`result_booking_id IN(SELECT booking_id FROM booking_guests WHERE ${emailFoldSql("email")} = ?)`,[foldEmail(email)]));
  statements.push(...await deleteRows(db,fence,"booking_guests",`${emailFoldSql("email")}=?`,[foldEmail(email)]));
  // The matching account keeps its native authority, but erased invitee audit
  // facts must not retain a bridge back to that identity (including self-erasure).
  statements.push({ sql: `UPDATE anonymized_audit SET actor_id=NULL WHERE actor_id IN (
    SELECT id FROM oa_operators WHERE ${emailFoldSql("email")}=?
    UNION SELECT id FROM operators WHERE erased_at IS NULL AND ${emailFoldSql("normalized_email")}=?
  )`, params: [foldEmail(email),foldEmail(email)] });
  statements.push(...await deleteRows(db, fence, "blocked_address_rules", `kind='email' AND ${emailFoldSql("value")}=?`, [foldEmail(email)]));
  const captures=(await db.prepare("SELECT rowid AS row_number,message FROM rer_mail_development_outbox").all<{row_number:number;message:string}>()).results.filter(row=>mailRecipientMatches(row.message,email)).map(row=>row.row_number);
  statements.push(...await deleteRows(db, fence, "rer_mail_development_outbox", "rowid IN (SELECT value FROM json_each(?))", [JSON.stringify(captures)]));
  // Approval claims are tentative, not confirmed bookings. Erasure removes their invitee record, capability and
  // every request/decision notice (including host copies), so an erased request can never be approved later.
  const approvals=(await db.prepare(`SELECT id FROM booking_approval_requests WHERE ${emailFoldSql("invitee_email")}=?`).bind(foldEmail(email)).all<{id:string}>()).results.map(row=>row.id);
  const approvalIds=JSON.stringify(approvals);
  statements.push(...await deleteRows(db,fence,"delivery_outbox","json_extract(payload_json,'$.approvalRequestId') IN(SELECT value FROM json_each(?))",[approvalIds]));
  statements.push(...await deleteRows(db,fence,"booking_approval_tokens","request_id IN(SELECT value FROM json_each(?))",[approvalIds]));
  statements.push(...await deleteRows(db,fence,"booking_approval_requests","id IN(SELECT value FROM json_each(?))",[approvalIds]));
  statements.push({sql:`UPDATE booking_approval_requests SET claim_json=json_set(claim_json,'$.invitee.guests',json(COALESCE((SELECT json_group_array(value) FROM json_each(claim_json,'$.invitee.guests') WHERE lower(trim(value))<>?), '[]')),'$.emails',json(COALESCE((SELECT json_group_array(json(value)) FROM json_each(claim_json,'$.emails') WHERE lower(trim(json_extract(value,'$.to')))<>?), '[]'))) WHERE claim_json IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(claim_json,'$.invitee.guests') WHERE lower(trim(value))=?)`,params:[email,email,email]});
  // A pending paid booking can carry guests before its booking rows exist. Remove the guest and its unsent notice,
  // preserving the payer and the money claim; calendar payloads read guests from live rows, never a personal copy.
  statements.push({sql:`UPDATE payment_holds SET claim_json=json_set(claim_json,'$.invitee.guests',json(COALESCE((SELECT json_group_array(value) FROM json_each(claim_json,'$.invitee.guests') WHERE lower(trim(value))<>?), '[]')),'$.emails',json(COALESCE((SELECT json_group_array(json(value)) FROM json_each(claim_json,'$.emails') WHERE lower(trim(json_extract(value,'$.to')))<>?), '[]'))) WHERE claim_json IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(claim_json,'$.invitee.guests') WHERE lower(trim(value))=?)`,params:[email,email,email]});
  // Remote payment cleanup must finish before its local authority can disappear.
  if (await db.prepare("SELECT 1 FROM payment_holds WHERE invitee_email_folded=? LIMIT 1").bind(foldEmail(email)).first()) throw new ErasureError("payment_erasure_incomplete",503);
  statements.push(...await deleteRows(db, fence, "availability_request_review_nonces", `${emailFoldSql("invitee_email")}=? OR (invitee_email IS NULL AND request_id IS NULL)`, [foldEmail(email)]));
  // Old receipts have no delivery correlation. Keeping a payload hash would retain
  // an unverifiable identity fingerprint; these mail-only facts carry no calendar authority.
  statements.push(...await deleteRows(db, fence, "provider_webhook_events", "provider IN ('sendgrid','resend') AND delivery_id IS NULL", []));
  return statements;
}
