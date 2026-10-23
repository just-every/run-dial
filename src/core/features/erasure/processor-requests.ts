import { createId, nowIso } from "../../shared/ids";

export type ProcessorRequestKind = "calendar_event_cancel" | "saved_card_detach" | "stripe_customer_anonymize" | "stripe_checkout_email" | "stripe_customer_unobserved" | "payment_authorization_void" | "payment_refund";
export type ProcessorRequest = { id: string; kind: ProcessorRequestKind; accountId: string; processorRef: string; lookupKey: string | null; actorId:string|null; amountCents:number; state: "pending" | "completed" | "failed"; reason: string | null; requested: boolean };
const columns = "id,kind,account_id AS accountId,processor_ref AS processorRef,lookup_key AS lookupKey,actor_id AS actorId,amount_cents AS amountCents,state,reason,requested";
export function processorReceiptItems(items:Array<Pick<ProcessorRequest,"kind"|"accountId"|"processorRef"|"state"|"reason"|"requested"> & {id?:string}>){
  return items.map(item=>({...(item.id?{id:item.id}:{}),kind:item.kind,accountId:item.accountId,processorRef:item.processorRef,state:item.state,reason:item.reason,requested:item.requested}));
}
export const checkoutRetentionReason = "checkout_customer_email_not_editable_no_erasure_api";

/** This is an anonymous command history, not an identity index. Only provider lookup keys survive. */
export class ProcessorRequestsRepository {
  constructor(private readonly db: D1Database) {}
  async list(receiptId: string): Promise<ProcessorRequest[]> {
    const rows = (await this.db.prepare(`SELECT ${columns} FROM processor_erasure_requests WHERE receipt_id=? ORDER BY kind,processor_ref`).bind(receiptId).all<Omit<ProcessorRequest,"requested"> & {requested:number}>()).results;
    return rows.map(row => ({...row,requested:row.requested===1}));
  }
  async receiptForEmail(email: string) {
    return (await this.db.prepare("SELECT receipt_id AS id FROM person_erasure_locks WHERE email=?").bind(email).first<{id:string|null}>())?.id;
  }
  async ensure(receiptId: string, item: Pick<ProcessorRequest,"kind"|"accountId"|"processorRef"> & Partial<Pick<ProcessorRequest,"lookupKey"|"state"|"reason"|"requested"|"actorId"|"amountCents">>) {
    const now=nowIso();
    await this.db.prepare(`INSERT INTO processor_erasure_requests(id,receipt_id,kind,account_id,processor_ref,lookup_key,actor_id,amount_cents,state,reason,requested,created_at,updated_at)
      VALUES(?,?,?,?,?,?,COALESCE(?,(SELECT actor_id FROM processor_erasure_requests WHERE receipt_id=? AND actor_id IS NOT NULL LIMIT 1)),?,?,?,?,?,?) ON CONFLICT(receipt_id,kind,account_id,processor_ref) DO NOTHING`)
      .bind(createId(),receiptId,item.kind,item.accountId,item.processorRef,item.lookupKey??null,item.actorId??null,receiptId,item.amountCents??0,item.state??"pending",item.reason??null,item.requested?1:0,now,now).run();
    return (await this.list(receiptId)).find(row=>row.kind===item.kind&&row.accountId===item.accountId&&row.processorRef===item.processorRef)!;
  }
  async claim(id: string) {
    const now=nowIso(), stale=new Date(Date.now()-120_000).toISOString();
    return Boolean(await this.db.prepare(`UPDATE processor_erasure_requests SET attempt_started_at=?,updated_at=? WHERE id=? AND state='pending' AND archive_historical=0
      AND (attempt_started_at IS NULL OR attempt_started_at<?) RETURNING id`).bind(now,now,id,stale).first());
  }
  async requested(id: string) { await this.db.prepare("UPDATE processor_erasure_requests SET requested=1 WHERE id=?").bind(id).run(); }
  async finish(id: string, state: ProcessorRequest["state"], reason: string|null) {
    await this.db.prepare("UPDATE processor_erasure_requests SET state=?,reason=?,attempt_started_at=NULL,updated_at=? WHERE id=?").bind(state,reason,nowIso(),id).run();
  }
  /** Preview uses local facts only. A pending Checkout may reveal a Customer/card only during cleanup. */
  async preview(email: string) {
    const records: Array<Pick<ProcessorRequest,"kind"|"accountId"|"processorRef"> & {lookupKey?:string;reason?:string}> = [];
    const add=(kind:ProcessorRequestKind,accountId:string,processorRef:string|null,lookupKey?:string)=>{if(processorRef)records.push({kind,accountId,processorRef,...(lookupKey?{lookupKey}:{}),...(kind==="stripe_checkout_email"?{reason:checkoutRetentionReason}:{})});};
    const cards=(await this.db.prepare(`SELECT c.account_id,c.stripe_customer_id,c.stripe_payment_method_id FROM booking_card_consents c JOIN bookings b ON b.id=c.booking_id WHERE b.invitee_email_folded=?`).bind(email).all<{account_id:string;stripe_customer_id:string|null;stripe_payment_method_id:string|null}>()).results;
    for(const card of cards){add("saved_card_detach",card.account_id,card.stripe_payment_method_id);add("stripe_customer_anonymize",card.account_id,card.stripe_customer_id);}
    const invoices=(await this.db.prepare("SELECT m.id,m.kind,m.stripe_customer_observed,m.account_id,m.stripe_customer_id,m.checkout_session_id FROM payment_movements m JOIN bookings b ON b.id=m.booking_id WHERE b.invitee_email_folded=?").bind(email).all<{id:string;kind:string;stripe_customer_observed:number;account_id:string;stripe_customer_id:string|null;checkout_session_id:string|null}>()).results;
    for(const row of invoices){if(row.kind==="invoice"&&!row.stripe_customer_observed&&!row.stripe_customer_id)records.push({kind:"stripe_customer_unobserved",accountId:row.account_id,processorRef:row.id,reason:"customer_creation_unobserved_no_reference"});add("stripe_customer_anonymize",row.account_id,row.stripe_customer_id);add("stripe_checkout_email",row.account_id,row.checkout_session_id);}
    const sessions=(await this.db.prepare(`SELECT p.account_id,p.checkout_session_id FROM booking_payments p JOIN bookings b ON b.id=p.booking_id WHERE b.invitee_email_folded=?
      UNION SELECT account_id,checkout_session_id FROM payment_holds WHERE invitee_email_folded=?`).bind(email,email).all<{account_id:string;checkout_session_id:string|null}>()).results;
    for(const row of sessions)add("stripe_checkout_email",row.account_id,row.checkout_session_id);
    const calendar=(await this.db.prepare("SELECT id,calendar_provider_event_id FROM bookings WHERE invitee_email_folded=? AND calendar_required=1 AND (imported=0 OR calendar_provider_event_id IS NOT NULL OR EXISTS(SELECT 1 FROM delivery_outbox d WHERE d.booking_id=bookings.id AND d.kind='calendar_upsert' AND CASE WHEN json_valid(d.payload_json) THEN json_extract(d.payload_json,'$.archiveHistorical') END IS NOT 1))").bind(email).all<{id:string;calendar_provider_event_id:string|null}>()).results;
    for(const row of calendar)add("calendar_event_cancel","google_calendar",row.calendar_provider_event_id??row.id,row.id);
    return records.filter((row,index)=>records.findIndex(other=>other.kind===row.kind&&other.accountId===row.accountId&&other.processorRef===row.processorRef)===index)
      .map(row=>({...row,state:"pending" as const,reason:row.reason??"awaiting_erasure_confirmation",requested:false}));
  }
  async prepare(email:string,receiptId:string,actorId:string) {
    for(const item of await this.preview(email))await this.ensure(receiptId,{...item,actorId,reason:item.kind==="stripe_checkout_email"?checkoutRetentionReason:item.kind==="stripe_customer_unobserved"?"customer_creation_unobserved_no_reference":null});
  }
}
