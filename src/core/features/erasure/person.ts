import { importPersonValues, erasePersonSourceCustody, erasePersonSharedCustody, finishPersonCustody } from "../move-in";
import { admitErasure, erasureAuthority, requireErasureSession } from "./admission";
import { foldEmail, mailRecipientMatches, emailFoldSql, personalRecords, operatorOverlap, operatorOverlapSql } from "./identity";
import { mailGraph } from "./graphs";
import { createErasure, ErasureError, toD1Sql } from "../../../modules/erasure/index.mjs";
import { createId, nowIso } from "../../shared/ids";
import type { SessionRecord } from "../operators";
import { assertErasureCensus, erasurePortability } from "./portability";
import { addressRemainders, deleteRows } from "./address";
import { erasePendingPayments, type CleanupPendingPayments } from "./pending-payments";
// @ts-expect-error Maintained native authentication HMAC and constant comparison.
import { hashToken, constantEqual } from "../../../../modules/operator-auth/crypto.mjs";

export type PersonConfirmation = { email: string; confirmation: string; expiresAt: number };
/** D7: what the receipt tells the host about the payer's Stripe customers Dial did not ask Stripe to delete. */
const stripeCustomersNotice = "These Stripe customers remain in the host's Stripe account with the payer's email, name and any billing address; remove them in Stripe.";
type EraseEntity = (kind: "bookings" | "availability-requests", id: string) => Promise<void>;

export class PersonErasure {
  constructor(private readonly db: D1Database, private readonly secret: string) {}
  private records(email: string) { return personalRecords(this.db, email); }
  private signature(email: string, records: Awaited<ReturnType<PersonErasure["records"]>>, session: SessionRecord, expiresAt: number, operatorIdentityRetained: boolean) {
    return hashToken(this.secret, "person-erasure-confirmation", JSON.stringify([email,records.bookings,records.requests,records.approvals,records.holds,session.id,session.sessionId,expiresAt,operatorIdentityRetained]));
  }
  async preview(raw: string, session: SessionRecord) {
    await assertErasureCensus(this.db);
    await requireErasureSession(this.db,session);
    const email=foldEmail(raw), records=await this.records(raw), expiresAt=Date.now()+300_000;
    const pending=Boolean(await this.db.prepare("SELECT 1 FROM person_erasure_locks WHERE email=?").bind(email).first());
    const operatorIdentityRetained=await operatorOverlap(this.db,email);
    return { bookings: records.bookings.length, requests: records.requests.length+records.approvals.length, payments: records.holds.length, pending, operatorIdentityRetained, expiresAt,
      confirmation: await this.signature(email,records,session,expiresAt,operatorIdentityRetained) };
  }
  async erase(input: PersonConfirmation, session: SessionRecord, eraseEntity: EraseEntity, cleanupPending?: CleanupPendingPayments) {
    await assertErasureCensus(this.db);
    const email=foldEmail(input.email), records=await this.records(input.email);
    const operatorIdentityRetained=await operatorOverlap(this.db,email);
    if (input.expiresAt<Date.now() || input.expiresAt>Date.now()+300_000 || !constantEqual(input.confirmation,await this.signature(email,records,session,input.expiresAt,operatorIdentityRetained))) throw new ErasureError("erasure_preview_changed",409);
    await requireErasureSession(this.db,session);
    const custody = await importPersonValues(this.db, email, session);
    // A selector longer than the kit accepts cannot be matched exactly. Refuse
    // before admission, native deletion or a completed receipt.
    if (custody.oversized) throw new ErasureError("erasure_import_value_too_long",503);
    const requestedAt=nowIso(), proposedId=createId();
    // A failed request leaves this admission closed and visible to the next preview.
    // It carries no authority: every retry still needs a native session and confirmation.
    await admitErasure(this.db, email, session);
    const authority=erasureAuthority(session);
    await this.db.batch([
      this.db.prepare(authority.sql).bind(...authority.params),
      this.db.prepare(`SELECT CASE WHEN (SELECT json_group_array(id) FROM (SELECT id FROM bookings WHERE invitee_email_folded=? ORDER BY id))=?
        AND (SELECT json_group_array(id) FROM (SELECT id FROM availability_requests WHERE ${emailFoldSql("invitee_email") }=? ORDER BY id))=?
        AND (SELECT json_group_array(id) FROM (SELECT id FROM booking_approval_requests WHERE ${emailFoldSql("invitee_email")}=? ORDER BY id))=?
        AND (SELECT json_group_array(id) FROM (SELECT id FROM payment_holds WHERE invitee_email_folded=? ORDER BY id))=?
        AND ${operatorOverlapSql()}=?
        THEN 1 ELSE abs(-9223372036854775808) END`).bind(email,JSON.stringify(records.bookings),email,JSON.stringify(records.requests),email,JSON.stringify(records.approvals),email,JSON.stringify(records.holds),email,email,operatorIdentityRetained?1:0),
      this.db.prepare("INSERT INTO person_erasure_receipts(id,bookings,requests,requested_at,operator_identity_retained,stripe_customers_retained,stripe_sessions_retained) SELECT ?,?,?,?,?,0,0 WHERE EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=? AND receipt_id IS NULL)").bind(proposedId,records.bookings.length,records.requests.length+records.approvals.length,requestedAt,operatorIdentityRetained?1:0,email),
      this.db.prepare("UPDATE person_erasure_locks SET receipt_id=?,addresses_json=? WHERE email=? AND receipt_id IS NULL").bind(proposedId,JSON.stringify(records.addresses),email),
      this.db.prepare(authority.sql).bind(...authority.params),
    ]);
    const pending=await this.db.prepare("SELECT receipt_id,addresses_json FROM person_erasure_locks WHERE email=?").bind(email).first<{receipt_id:string;addresses_json:string}>();
    if(!pending?.receipt_id)throw new ErasureError("erasure_incomplete",503);
    const id=pending.receipt_id;
    const addresses=[...new Set([...records.addresses,...JSON.parse(pending.addresses_json) as string[]])];
    await erasePendingPayments(this.db,email,session,cleanupPending);
    await erasePersonSourceCustody(this.db, email, custody.custodyOnly, custody.values, session);
    await erasePersonSharedCustody(this.db, custody.values, custody.sharedFields, custody.sharedInvitees, session);
    for (const booking of records.bookings) await eraseEntity("bookings",booking);
    for (const request of records.requests) await eraseEntity("availability-requests",request);
    const remaining=await this.records(email);
    if(remaining.bookings.length || remaining.requests.length || remaining.holds.length) throw new ErasureError("erasure_incomplete",503);
    const fence=await erasurePortability(this.db);
    const mailEngine=createErasure({db:this.db,portability:fence,declarations:[mailGraph()]});
    const approvalIds=new Set((await this.db.prepare(`SELECT id FROM booking_approval_requests WHERE ${emailFoldSql("invitee_email")}=?`).bind(email).all<{id:string}>()).results.map(row=>row.id));
    const mail=(await this.db.prepare("SELECT id,payload_json FROM delivery_outbox WHERE kind IN ('mail_send','reminder')").all<{id:string;payload_json:string}>()).results.filter(row=>mailRecipientMatches(row.payload_json,email)||approvalIds.has(String((JSON.parse(row.payload_json) as {approvalRequestId?:string}).approvalRequestId)));
    for(const item of mail){const plan=await mailEngine.nativeStatements("mail",{id:item.id});await this.db.batch([erasureAuthority(session),...plan.statements,erasureAuthority(session)].map(statement=>this.db.prepare(statement.sql).bind(...statement.params)));await mailEngine.deleteBlobs(plan.operationId);}
    const statements=[erasureAuthority(session), ...await addressRemainders(this.db,fence,email,this.secret,addresses),
      ...await deleteRows(this.db,fence,"person_erasure_locks","email=?",[email]),
      ...(await fence.invalidateTransfersStatements()).map(toD1Sql),
      {sql:`UPDATE person_erasure_receipts SET completed_at=?,operator_identity_retained=${operatorOverlapSql()} WHERE id=?`,params:[nowIso(),email,email,id]},
      {sql:"UPDATE erased_calendar_targets SET receipt_id=? WHERE booking_id IN(SELECT value FROM json_each(?))",params:[id,JSON.stringify(records.bookings)]},
      erasureAuthority(session),
    ];
    await finishPersonCustody(this.db, email, custody.values, statements, session);
    return this.receipt(id);
  }
  async receipt(id: string) {
    const row=await this.db.prepare("SELECT id,bookings,requests,requested_at AS requestedAt,completed_at AS completedAt,operator_identity_retained AS operatorIdentityRetained,COALESCE(saved_cards_detached,0) AS savedCardsDetached,COALESCE(saved_card_failures,0) AS savedCardFailures,stripe_customers_retained AS stripeCustomersRetained,stripe_sessions_retained AS stripeSessionsRetained FROM person_erasure_receipts WHERE id=?").bind(id).first<{id:string;bookings:number;requests:number;requestedAt:string;completedAt:string|null;operatorIdentityRetained:number;savedCardsDetached:number;savedCardFailures:number;stripeCustomersRetained:number|null;stripeSessionsRetained:number|null}>();
    if(!row) return null;
    const targets=(await this.db.prepare("SELECT completed_at,last_error_code FROM erased_calendar_targets WHERE receipt_id=?").bind(id).all<{completed_at:string|null;last_error_code:string|null}>()).results;
    // D7: a receipt from before the count existed reads null (not counted), never zero.
    return {...row,stripeCustomersNotice:row.stripeCustomersRetained?stripeCustomersNotice:null,operatorIdentityRetained:Boolean(row.operatorIdentityRetained),localComplete:row.completedAt!==null,calendarCleanup:row.completedAt===null||targets.some(target=>!target.completed_at)?"pending":"completed",calendarFailures:targets.filter(target=>!target.completed_at&&target.last_error_code).map(target=>target.last_error_code)};
  }
}
