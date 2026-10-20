import { foldEmail, mailRecipientMatches, emailFoldSql, personalRecords } from "./identity";
import { toD1Sql, type PortabilityFence } from "../../../modules/erasure/index.mjs";
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
  if (others.bookings.some(other=>table!=="bookings"||other!==id) || others.requests.some(other=>table!=="availability_requests"||other!==id)) {
    return knownRateStatements(db,fence,secret,others.addresses);
  }
  return addressRemainders(db,fence,row.email,secret,others.addresses);
}

export async function addressRemainders(db: D1Database, fence: PortabilityFence, email: string, secret: string, aliases: string[] = [email]) {
  const statements = await knownRateStatements(db,fence,secret,aliases);
  // The matching account keeps its native authority, but erased invitee audit
  // facts must not retain a bridge back to that identity (including self-erasure).
  statements.push({ sql: `UPDATE anonymized_audit SET actor_id=NULL WHERE actor_id IN (
    SELECT id FROM oa_operators WHERE ${emailFoldSql("email")}=?
    UNION SELECT id FROM operators WHERE erased_at IS NULL AND ${emailFoldSql("normalized_email")}=?
  )`, params: [foldEmail(email),foldEmail(email)] });
  statements.push(...await deleteRows(db, fence, "blocked_address_rules", `kind='email' AND ${emailFoldSql("value")}=?`, [foldEmail(email)]));
  const captures=(await db.prepare("SELECT rowid AS row_number,message FROM rer_mail_development_outbox").all<{row_number:number;message:string}>()).results.filter(row=>mailRecipientMatches(row.message,email)).map(row=>row.row_number);
  statements.push(...await deleteRows(db, fence, "rer_mail_development_outbox", "rowid IN (SELECT value FROM json_each(?))", [JSON.stringify(captures)]));
  // PAY-001: a pending payment hold carries the payer's folded address and pending booking.
  statements.push(...await deleteRows(db, fence, "payment_holds", "invitee_email_folded=?", [foldEmail(email)]));
  statements.push(...await deleteRows(db, fence, "availability_request_review_nonces", `${emailFoldSql("invitee_email")}=? OR (invitee_email IS NULL AND request_id IS NULL)`, [foldEmail(email)]));
  // Old receipts have no delivery correlation. Keeping a payload hash would retain
  // an unverifiable identity fingerprint; these mail-only facts carry no calendar authority.
  statements.push(...await deleteRows(db, fence, "provider_webhook_events", "provider IN ('sendgrid','resend') AND delivery_id IS NULL", []));
  return statements;
}
