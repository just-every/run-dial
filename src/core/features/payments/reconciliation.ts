import { StripeApi } from "./stripe-api";
import { createId, nowIso } from "../../shared/ids";
import type { StripeEvent } from "./approval-state";
export type ProcessorFact = { id: string; bookingId: string; kind: string; processorRef: string; sourceRef: string; amountCents: number; currency:string; status: string; disagreement: number };
const columns = "id, booking_id AS bookingId, kind, processor_ref AS processorRef, source_ref AS sourceRef, amount_cents AS amountCents, currency, status, disagreement";
const ref = (value: unknown): string | undefined => typeof value === "string" ? value : value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : undefined;
/** Signed processor facts only. This service has no money-moving methods. */
export class Reconciliation {
  constructor(private readonly db: D1Database, private readonly stripe?: StripeApi) {}
  facts(bookingId: string) { return this.db.prepare(`SELECT ${columns} FROM payment_processor_facts WHERE booking_id=? ORDER BY created_at,id`).bind(bookingId).all<ProcessorFact>().then(r => r.results); }
  async receive(event: StripeEvent) {
    if (!["charge.succeeded", "charge.refunded", "charge.dispute.created", "charge.dispute.closed", "balance.available", "payout.paid"].includes(event.type)) return undefined;
    const connection = await this.db.prepare("SELECT account_id FROM payment_connections WHERE singleton_key='default'").first<{account_id: string}>();
    if (!event.account || event.account !== connection?.account_id) return { kind: "unauthorized" as const };
    const object = event.data.object;
    if (event.type === "payout.paid") {
      if (!ref(object.id) || !this.stripe) return {kind:"rejected" as const};
      const transactions=await this.stripe.payoutTransactions(event.account,String(object.id));
      const now=nowIso();
      const payouts=new Map<string,{intent:string;net:number;currency:string}>();
      for(const transaction of transactions){
        const charge=transaction.source;if(!charge||!ref(charge.payment_intent))continue;
        const booking=await this.booking(String(charge.payment_intent),event.account);if(!booking)continue;
        const prior=payouts.get(booking.id);if(prior&&prior.currency!==transaction.currency)throw new Error("payout_currency_mismatch");payouts.set(booking.id,{intent:String(charge.payment_intent),net:(prior?.net??0)+transaction.net,currency:transaction.currency});
      }
      for(const [bookingId,payout] of payouts){
        await this.db.prepare("INSERT INTO payment_processor_facts(id,booking_id,account_id,kind,processor_ref,source_ref,amount_cents,status,event_created,created_at,updated_at,currency) VALUES(?,?,?,'payout',?,?,?,'paid',?,?,?,?) ON CONFLICT(account_id,kind,processor_ref,booking_id) DO UPDATE SET amount_cents=excluded.amount_cents,updated_at=excluded.updated_at").bind(createId(),bookingId,event.account,String(object.id),payout.intent,payout.net,event.created??0,now,now,payout.currency).run();
      }return {kind:"processed" as const};
    }
    const intent = ref(object.payment_intent);
    if (!intent) return { kind: "ignored" as const };
    const booking = await this.booking(intent,event.account);
    if (!booking) return { kind: "ignored" as const };
    if (object.currency !== "usd") return {kind:"rejected" as const};
    const entries: Array<{kind:string;ref:string;amount:number;status:string;flag:number;currency?:string}> = [];
    if (event.type === "charge.refunded") {
      const embedded = object.refunds as {data?:Array<Record<string,unknown>>;has_more?:boolean}|undefined;
      if(!Number.isInteger(object.amount_refunded)||Number(object.amount_refunded)<0)return {kind:"rejected" as const};
      const refunds=embedded?.data&&!embedded.has_more?embedded.data:this.stripe&&ref(object.id)?await this.stripe.chargeRefunds(event.account,String(object.id)):undefined;
      if(!refunds)return {kind:"rejected" as const};
      for (const refund of refunds) {
        if (!ref(refund.id) || !Number.isInteger(refund.amount) || Number(refund.amount)<0 || !["succeeded","pending","failed","canceled"].includes(String(refund.status))) return {kind:"rejected" as const};
        if (refund.currency!=="usd" || ref(refund.payment_intent)!==intent) return {kind:"rejected" as const};
        const local = await this.db.prepare("SELECT id FROM payment_movements WHERE processor_ref=? AND kind='refund'").bind(refund.id).first();
        entries.push({kind:"refund",ref:String(refund.id),amount:Number(refund.amount),status:String(refund.status),flag:local?0:1});
      }
    } else if (event.type.startsWith("charge.dispute.")) {
      if (!ref(object.id) || !Number.isInteger(object.amount) || typeof object.status!=="string") return {kind:"rejected" as const};
      entries.push({kind:"dispute",ref:String(object.id),amount:Number(object.amount),status:object.status,flag:event.type.endsWith("created")?1:0});
    } else if (event.type === "charge.succeeded") {
      if (!ref(object.id) || !Number.isInteger(object.amount)) return {kind:"rejected" as const};
      entries.push({kind:"charge",ref:String(object.id),amount:Number(object.amount),status:"succeeded",flag:Number(object.amount)!==booking.amountCents?1:0});
      const balance=typeof object.balance_transaction==="string"&&this.stripe?await this.stripe.balanceTransaction(event.account,object.balance_transaction):object.balance_transaction as Record<string,unknown>|undefined;
      if (balance && typeof balance==="object" && ref(balance.id) && Number.isInteger(balance.fee)) entries.push({kind:"fee",ref:String(balance.id),amount:Number(balance.fee),currency:String(balance.currency),status:"succeeded",flag:0});
    }
    if (!entries.length) return {kind:"ignored" as const};
    const now=nowIso();
    await this.db.batch(entries.map(entry=>this.db.prepare(`INSERT INTO payment_processor_facts(id,booking_id,account_id,kind,processor_ref,source_ref,amount_cents,status,disagreement,event_created,created_at,updated_at,currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,kind,processor_ref,booking_id) DO UPDATE SET status=excluded.status,disagreement=CASE WHEN payment_processor_facts.resolved_at IS NOT NULL THEN 0 ELSE excluded.disagreement END,amount_cents=excluded.amount_cents,event_created=excluded.event_created,updated_at=excluded.updated_at WHERE excluded.event_created>payment_processor_facts.event_created OR (excluded.event_created=payment_processor_facts.event_created AND payment_processor_facts.status NOT IN ('won','lost','succeeded','failed','canceled'))`).bind(createId(),booking.id,event.account,entry.kind,entry.ref,intent,entry.amount,entry.status,entry.flag,event.created ?? 0,now,now,entry.currency??"usd")));
    return {kind:"processed" as const};
  }
  private booking(intent:string,account:string){return this.db.prepare(`SELECT booking_id AS id,amount_cents AS amountCents FROM booking_payments WHERE payment_intent_id=? AND account_id=? UNION SELECT booking_id AS id,amount_cents AS amountCents FROM payment_movements WHERE processor_ref=? AND account_id=? LIMIT 1`).bind(intent,account,intent,account).first<{id:string;amountCents:number}>();}
  async resolve(bookingId:string,processorRef:string,operatorId:string){return (await this.db.prepare("UPDATE payment_processor_facts SET disagreement=0,resolved_at=?,resolved_by=? WHERE booking_id=? AND processor_ref=? AND disagreement=1 AND kind='refund'").bind(nowIso(),operatorId,bookingId,processorRef).run()).meta.changes===1;}
  async rows() {
    const rows = (await this.db.prepare(`SELECT b.id AS bookingId,b.event_title AS eventTitle,b.invitee_name AS inviteeName,p.payment_intent_id AS processorRef,p.amount_cents AS amountCents,p.paid_at AS paidAt,'charge' AS kind,'succeeded' AS status,0 AS disagreement,'usd' AS currency FROM booking_payments p JOIN bookings b ON b.id=p.booking_id
      UNION ALL SELECT b.id,b.event_title,b.invitee_name,m.processor_ref,m.amount_cents,m.updated_at,m.kind,m.status,0,'usd' FROM payment_movements m JOIN bookings b ON b.id=m.booking_id
      UNION ALL SELECT b.id,b.event_title,b.invitee_name,f.processor_ref,f.amount_cents,f.updated_at,f.kind,f.status,f.disagreement,f.currency FROM payment_processor_facts f JOIN bookings b ON b.id=f.booking_id WHERE NOT EXISTS (SELECT 1 FROM payment_movements m WHERE m.processor_ref=f.processor_ref AND f.kind='refund') ORDER BY paidAt DESC`).all<{bookingId:string;eventTitle:string;inviteeName:string;processorRef:string;amountCents:number;paidAt:string;kind:string;status:string;disagreement:number;currency:string}>()).results;
    const exports=(await this.db.prepare("SELECT payment_ref FROM accounting_exports WHERE state='exported'").all<{payment_ref:string}>()).results;
    return rows.map(row=>({...row,exported:exports.some(e=>e.payment_ref===row.processorRef)}));
  }
  async csv() {
    const cell=(value:unknown)=>`"${String(value??"").replace(/^[=+@\-\t\r]/u,"'$&").replaceAll('"','""')}"`;
    return [["Booking","Event","Invitee","Kind","Minor units","Currency","Processor reference","State","Needs attention"],...(await this.rows()).map(r=>[r.bookingId,r.eventTitle,r.inviteeName,r.kind,r.amountCents,r.currency,r.processorRef,r.status,r.disagreement?"yes":"no"])].map(r=>r.map(cell).join(",")).join("\r\n");
  }
}
