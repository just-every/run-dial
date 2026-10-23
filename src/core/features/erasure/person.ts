import { NoticeErasure } from '../workspace-notices';
import { importPersonValues, erasePersonSourceCustody, erasePersonSharedCustody, finishPersonCustody } from "../move-in";
import { erasureAuthority, requireErasureSession } from "./admission";
import { foldEmail, mailRecipientMatches, emailFoldSql } from "./identity";
import { personScope, scopeOperatorOverlap, admitPersonScope } from "./person-scope";
import { mailGraph } from "./graphs";
import { createErasure, ErasureError, toD1Sql } from "../../../modules/erasure/index.mjs";
import { createId, nowIso } from "../../shared/ids";
import type { SessionRecord } from "../operators";
import { assertErasureCensus, erasurePortability } from "./portability";
import { addressRemainders, deleteRows } from "./address";
import { ProcessorRequestsRepository, processorReceiptItems } from "./processor-requests";
import { erasePendingPayments, type CleanupPendingPayments } from "./pending-payments";
// @ts-expect-error Maintained native authentication HMAC and constant comparison.
import { hashToken, constantEqual } from "../../../../modules/operator-auth/crypto.mjs";

export type PersonConfirmation = { email: string; confirmation: string; expiresAt: number };
type EraseEntity = (kind: "bookings" | "availability-requests", id: string) => Promise<void>;

export class PersonErasure {
  constructor(private readonly db: D1Database, private readonly secret: string, private readonly processors?: {prepare(email:string,receiptId:string,actorId:string):Promise<void>;retry(receiptId:string):Promise<void>}) {}
  private records(email: string) { return personScope(this.db, email); }
  private signature(email: string, records: Awaited<ReturnType<PersonErasure["records"]>>, session: SessionRecord, expiresAt: number, operatorIdentityRetained: boolean) {
    return hashToken(this.secret, "person-erasure-confirmation", JSON.stringify([email,records.bookings,records.requests,records.approvals,records.holds,records.client,records.emails,records.polls,session.id,session.sessionId,expiresAt,operatorIdentityRetained]));
  }
  async preview(raw: string, session: SessionRecord) {
    await assertErasureCensus(this.db);
    await requireErasureSession(this.db,session);
    const email=foldEmail(raw), records=await this.records(raw), expiresAt=Date.now()+300_000;
    const pending=Boolean(await this.db.prepare("SELECT 1 FROM person_erasure_locks WHERE email IN(SELECT value FROM json_each(?))").bind(JSON.stringify(records.emails)).first());
    const operatorIdentityRetained=await scopeOperatorOverlap(this.db,records.emails);
    return { bookings: records.bookings.length, requests: records.requests.length+records.approvals.length, payments: records.holds.length, pending, operatorIdentityRetained, expiresAt,
      externalRequests: [...processorReceiptItems((await Promise.all(records.emails.map(alias => new ProcessorRequestsRepository(this.db).preview(alias)))).flat()),...(await Promise.all(records.emails.map(alias=>NoticeErasure.preview(this.db,alias)))).flat()], confirmation: await this.signature(email,records,session,expiresAt,operatorIdentityRetained) };
  }
  async erase(input: PersonConfirmation, session: SessionRecord, eraseEntity: EraseEntity, cleanupPending?: CleanupPendingPayments) {
    await assertErasureCensus(this.db);
    const email=foldEmail(input.email), records=await this.records(input.email);
    const operatorIdentityRetained=await scopeOperatorOverlap(this.db,records.emails);
    if (input.expiresAt<Date.now() || input.expiresAt>Date.now()+300_000 || !constantEqual(input.confirmation,await this.signature(email,records,session,input.expiresAt,operatorIdentityRetained))) throw new ErasureError("erasure_preview_changed",409);
    await requireErasureSession(this.db,session);
    const custody = await Promise.all(records.emails.map(alias => importPersonValues(this.db, alias, session)));
    // A selector longer than the kit accepts cannot be matched exactly. Refuse
    // before admission, native deletion or a completed receipt.
    if (custody.some(item => item.oversized)) throw new ErasureError("erasure_import_value_too_long",503);
    const proposedId=createId();
    // A failed request leaves this admission closed and visible to the next preview.
    // It carries no authority: every retry still needs a native session and confirmation.
    const id=await admitPersonScope(this.db,records,session,proposedId,operatorIdentityRetained);
    const pending=await this.db.prepare("SELECT addresses_json FROM person_erasure_locks WHERE email=?").bind(email).first<{addresses_json:string}>();
    if(!pending)throw new ErasureError("erasure_incomplete",503);
    const addresses=[...new Set([...records.addresses,...JSON.parse(pending.addresses_json) as string[]])];
    for (const alias of records.emails) {
      await this.processors?.prepare(alias,id,session.id);
      await erasePendingPayments(this.db,alias,session,cleanupPending);
    }
    await this.processors?.retry(id);
    for (const [index,alias] of records.emails.entries()) {
      const item=custody[index];
      await erasePersonSourceCustody(this.db, alias, item.custodyOnly, item.values, session);
      await erasePersonSharedCustody(this.db, item.values, item.sharedFields, item.sharedInvitees, session);
    }
    for (const booking of records.bookings) await eraseEntity("bookings",booking);
    for (const request of records.requests) await eraseEntity("availability-requests",request);
    const remaining=await this.records(email);
    if(remaining.bookings.length || remaining.requests.length || remaining.holds.length) throw new ErasureError("erasure_incomplete",503);
    const fence=await erasurePortability(this.db);
    const mailEngine=createErasure({db:this.db,portability:fence,declarations:[mailGraph()]});
    const approvalIds=new Set((await this.db.prepare(`SELECT id FROM booking_approval_requests WHERE ${emailFoldSql("invitee_email")} IN(SELECT value FROM json_each(?))`).bind(JSON.stringify(records.emails)).all<{id:string}>()).results.map(row=>row.id));
    const mail=(await this.db.prepare("SELECT id,payload_json FROM delivery_outbox WHERE kind IN ('mail_send','reminder')").all<{id:string;payload_json:string}>()).results.filter(row=>records.emails.some(alias=>mailRecipientMatches(row.payload_json,alias))||approvalIds.has(String((JSON.parse(row.payload_json) as {approvalRequestId?:string}).approvalRequestId)));
    for(const item of mail){const plan=await mailEngine.nativeStatements("mail",{id:item.id});await this.db.batch([erasureAuthority(session),...plan.statements,erasureAuthority(session)].map(statement=>this.db.prepare(statement.sql).bind(...statement.params)));await mailEngine.deleteBlobs(plan.operationId);}
    const clientStatements = [];
    if (records.client) for (const table of ["client_notes","client_fields","client_aliases","client_profiles"]) clientStatements.push(...await deleteRows(this.db,fence,table,table === "client_profiles" ? "id=?" : "client_id=?",[records.client.id]));
    const statements=[erasureAuthority(session), ...(await Promise.all(records.emails.map(alias=>addressRemainders(this.db,fence,alias,this.secret,addresses)))).flat(), ...clientStatements,
      ...await deleteRows(this.db,fence,"person_erasure_locks","receipt_id=?",[id]),
      ...(await fence.invalidateTransfersStatements()).map(toD1Sql),
      {sql:`UPDATE person_erasure_receipts SET completed_at=?,operator_identity_retained=EXISTS(SELECT 1 FROM oa_operators WHERE ${emailFoldSql("email")} IN(SELECT value FROM json_each(?)) UNION ALL SELECT 1 FROM operators WHERE erased_at IS NULL AND ${emailFoldSql("normalized_email")} IN(SELECT value FROM json_each(?))) WHERE id=?`,params:[nowIso(),JSON.stringify(records.emails),JSON.stringify(records.emails),id]},
      {sql:"UPDATE erased_calendar_targets SET receipt_id=? WHERE booking_id IN(SELECT value FROM json_each(?))",params:[id,JSON.stringify(records.bookings)]},
      erasureAuthority(session),
    ];
    await finishPersonCustody(this.db, records.emails, [...new Set(custody.flatMap(item=>item.values))], statements, session);
    return this.receipt(id);
  }
  async retryProcessors(id:string,session:SessionRecord){
    await requireErasureSession(this.db,session);
    if(!await this.receipt(id))return null;
    await this.processors?.retry(id);
    return this.receipt(id);
  }
  async receipt(id: string) {
    const row=await this.db.prepare("SELECT id,bookings,requests,requested_at AS requestedAt,completed_at AS completedAt,operator_identity_retained AS operatorIdentityRetained,COALESCE(saved_cards_detached,0) AS savedCardsDetached,COALESCE(saved_card_failures,0) AS savedCardFailures,stripe_customers_retained AS stripeCustomersRetained,stripe_sessions_retained AS stripeSessionsRetained FROM person_erasure_receipts WHERE id=?").bind(id).first<{id:string;bookings:number;requests:number;requestedAt:string;completedAt:string|null;operatorIdentityRetained:number;savedCardsDetached:number;savedCardFailures:number;stripeCustomersRetained:number|null;stripeSessionsRetained:number|null}>();
    if(!row) return null;
    const targets=(await this.db.prepare("SELECT completed_at,last_error_code FROM erased_calendar_targets WHERE receipt_id=?").bind(id).all<{completed_at:string|null;last_error_code:string|null}>()).results;
    // D7: a receipt from before the count existed reads null (not counted), never zero.
    return {...row,externalRequests:[...processorReceiptItems(await new ProcessorRequestsRepository(this.db).list(id)),...await NoticeErasure.items(this.db,id)],operatorIdentityRetained:Boolean(row.operatorIdentityRetained),localComplete:row.completedAt!==null,calendarCleanup:row.completedAt===null||targets.some(target=>!target.completed_at)?"pending":"completed",calendarFailures:targets.filter(target=>!target.completed_at&&target.last_error_code).map(target=>target.last_error_code)};
  }
}
