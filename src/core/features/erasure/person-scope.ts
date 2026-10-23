import { personalRecords, foldEmail, emailFoldSql, operatorOverlapSql } from "./identity";
import { nowIso } from "../../shared/ids";
import { admitErasure, erasureAuthority } from "./admission";
import type { SessionRecord } from "../operators";

/** Alias membership remains intact until final custody retirement, including after a failed attempt. */
export async function personScope(db: D1Database, raw: string) {
  const email = foldEmail(raw);
  const client = await db.prepare("SELECT c.id,c.revision FROM client_profiles c JOIN client_aliases a ON a.client_id=c.id WHERE a.email=?").bind(email).first<{id:string;revision:number}>();
  const emails = client ? (await db.prepare("SELECT email FROM client_aliases WHERE client_id=? ORDER BY email").bind(client.id).all<{email:string}>()).results.map(row => row.email) : [email];
  const records = await Promise.all(emails.map(alias => personalRecords(db,alias)));
  const union = (key: "bookings" | "requests" | "approvals" | "holds" | "addresses") => [...new Set(records.flatMap(record => record[key]))].sort();
  return { client, emails, bookings: union("bookings"), requests: union("requests"), approvals: union("approvals"), holds: union("holds"), addresses: [...new Set([...emails,...union("addresses")])].sort() };
}
export type PersonScope = Awaited<ReturnType<typeof personScope>>;
export async function scopeOperatorOverlap(db: D1Database, emails: string[]) {
  for (const email of emails) if ((await db.prepare(`SELECT ${operatorOverlapSql()} AS retained`).bind(email,email).first<{retained:number}>())?.retained) return true;
  return false;
}

/** Every alias lock receives the same receipt in one transaction. A changed preview aborts all writes. */
export async function admitPersonScope(db: D1Database, scope: PersonScope, session: SessionRecord, proposedId: string, operatorIdentityRetained: boolean) {
  // The first lock closes archive admission; the atomic batch below closes the whole alias set.
  await admitErasure(db,scope.emails[0],session);
  const emails = JSON.stringify(scope.emails);
  const existing = (await db.prepare("SELECT DISTINCT receipt_id AS id FROM person_erasure_locks WHERE email IN(SELECT value FROM json_each(?)) AND receipt_id IS NOT NULL").bind(emails).all<{id:string}>()).results;
  if (existing.length > 1) throw new Error("client_erasure_receipt_conflict");
  const id = existing[0]?.id ?? proposedId, now = nowIso(), authority = erasureAuthority(session);
  const snapshot = await personScope(db,scope.emails[0]);
  if (JSON.stringify(snapshot) !== JSON.stringify(scope)) throw new Error("client_erasure_scope_changed");
  const clientGuard = scope.client ? db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM client_profiles WHERE id=? AND revision=?) AND (SELECT json_group_array(email) FROM (SELECT email FROM client_aliases WHERE client_id=? ORDER BY email))=? THEN 1 ELSE abs(-9223372036854775808) END").bind(scope.client.id,scope.client.revision,scope.client.id,emails)
    : db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM client_aliases WHERE email=?) THEN 1 ELSE abs(-9223372036854775808) END").bind(scope.emails[0]);
  const idsGuard = (table: string, column: string, ids: string[]) => db.prepare(`SELECT CASE WHEN (SELECT json_group_array(id) FROM (SELECT id FROM ${table} WHERE ${column} IN(SELECT value FROM json_each(?)) ORDER BY id))=? THEN 1 ELSE abs(-9223372036854775808) END`).bind(emails,JSON.stringify(ids));
  await db.batch([
    db.prepare(authority.sql).bind(...authority.params), clientGuard,
    idsGuard("bookings","invitee_email_folded",scope.bookings),
    idsGuard("availability_requests",emailFoldSql("invitee_email"),scope.requests),
    idsGuard("booking_approval_requests",emailFoldSql("invitee_email"),scope.approvals),
    idsGuard("payment_holds","invitee_email_folded",scope.holds),
    db.prepare(`SELECT CASE WHEN (${scope.emails.map(() => operatorOverlapSql()).join(" OR ")})=? THEN 1 ELSE abs(-9223372036854775808) END`).bind(...scope.emails.flatMap(email => [email,email]),operatorIdentityRetained?1:0),
    ...scope.emails.map(email => db.prepare("INSERT INTO person_erasure_locks(email,requested_at) VALUES(?,?) ON CONFLICT(email) DO NOTHING").bind(email,now)),
    db.prepare("INSERT INTO person_erasure_receipts(id,bookings,requests,requested_at,operator_identity_retained,stripe_customers_retained,stripe_sessions_retained) VALUES(?,?,?,?,?,0,0) ON CONFLICT(id) DO NOTHING").bind(id,scope.bookings.length,scope.requests.length+scope.approvals.length,now,operatorIdentityRetained?1:0),
    db.prepare("UPDATE person_erasure_locks SET receipt_id=?,addresses_json=? WHERE email IN(SELECT value FROM json_each(?)) AND receipt_id IS NULL").bind(id,JSON.stringify(scope.addresses),emails),
    db.prepare(authority.sql).bind(...authority.params),
  ]);
  return id;
}
