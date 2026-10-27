import { foldBookingSearch } from "../bookings";

/** Same normative full Unicode fold as native booking search and migration 0033. */
export const foldEmail = (value: string) => foldBookingSearch(value.trim());
export const foldText = foldBookingSearch;

// Expressions are owned SQL, never caller-supplied text. Preserve embedded NUL
// admitted by historical booking/import boundaries, as migration 0033 does.
export function emailFoldSql(expression: string) {
  return `(WITH RECURSIVE fold(remaining,result) AS (
    SELECT trim(${expression}), '' UNION ALL
    SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
      result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),
        CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
    FROM fold WHERE length(CAST(remaining AS BLOB))>0
  ) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0)`;
}
export async function personalRecords(db: D1Database, email: string) {
  const bookings = (await db.prepare("SELECT id,invitee_email AS email FROM bookings WHERE invitee_email_folded=? ORDER BY id").bind(foldEmail(email)).all<{id:string;email:string}>()).results;
  const requests = (await db.prepare(`SELECT id,invitee_email AS email FROM availability_requests WHERE ${emailFoldSql('invitee_email')}=? ORDER BY id`).bind(foldEmail(email)).all<{id:string;email:string}>()).results;
  const approvals=(await db.prepare(`SELECT id,invitee_email AS email FROM booking_approval_requests WHERE ${emailFoldSql("invitee_email")}=? ORDER BY id`).bind(foldEmail(email)).all<{id:string;email:string}>()).results;
  const holds=(await db.prepare("SELECT id FROM payment_holds WHERE invitee_email_folded=? ORDER BY id").bind(foldEmail(email)).all<{id:string}>()).results;
  const entitlements=(await db.prepare("SELECT id FROM payment_entitlements WHERE purchaser_email_folded=? ORDER BY id").bind(foldEmail(email)).all<{id:string}>()).results;
  return { entitlements:entitlements.map(row=>row.id), holds:holds.map(row=>row.id), approvals:approvals.map(row=>row.id), bookings: bookings.map(row=>row.id), requests: requests.map(row=>row.id), addresses: [...new Set([email,...bookings.map(row=>row.email),...requests.map(row=>row.email),...approvals.map(row=>row.email)].map(value=>value.trim().toLowerCase()))].sort() };
}
export const operatorOverlapSql = () => `EXISTS(SELECT 1 FROM oa_operators WHERE ${emailFoldSql('email')}=? UNION ALL SELECT 1 FROM operators WHERE erased_at IS NULL AND ${emailFoldSql('normalized_email')}=?)`;
export async function operatorOverlap(db: D1Database, email: string) {
  const row = await db.prepare(`SELECT ${operatorOverlapSql()} AS retained`).bind(foldEmail(email),foldEmail(email)).first<{retained:number}>();
  return Boolean(row?.retained);
}

export async function hasPersonalRecords(db: D1Database, email: string) {
  const records=await personalRecords(db,email);
  return records.bookings.length>0 || records.requests.length>0 || records.approvals.length>0 || records.holds.length>0 || records.entitlements.length>0;
}

/** Orphan mail is selected by its structured recipient, not substring matches
 * that could erase a distinct address containing the same text. */
export function mailRecipientMatches(payload: string, email: string) {
  const value=JSON.parse(payload) as {to?:unknown};
  return (Array.isArray(value.to)?value.to:[value.to]).some(address=>typeof address==='string'&&foldEmail(address)===foldEmail(email));
}
