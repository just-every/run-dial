import { foldCase } from "../../shared/case-fold.mjs";
const foldEmail=(email:string)=>foldCase(email.trim());
import { z } from "zod";
import { createId, nowIso } from "../../shared/ids";
import { deriveOpaqueToken, hashToken } from "../../platform/auth/tokens";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { StripeEvent } from "./approval-state";
import type { StripeApi } from "./stripe-api";
import { issueCoupon, couponInput } from "./coupons";
export { couponInput };
import { entitlementSummary, reservedCredit, type Entitlement } from "./entitlement-repository";
export const productInput = z.object({kind:z.enum(["package","membership","gift"]),name:z.string().trim().min(1).max(120),sessions:z.number().int().min(1).max(1000),amountCents:z.number().int().min(50).max(99_999_999),validityDays:z.number().int().min(1).max(3660)}).strict();
type Product = {id:string;event_type_id:string;kind:Entitlement["kind"];name:string;sessions:number;amount_cents:number;validity_days:number};
type Live=()=>Promise<{api:StripeApi;accountId:string}|{refusal:string}>;
/** Purchases have no booking authority until the connected account's signed event confirms Stripe's outcome. */
export class Entitlements {
 constructor(private readonly db:D1Database,private readonly runtime:RuntimeEnvironment,private readonly live:Live,private readonly clock:()=>Promise<Date>=async()=>new Date()){}
 issueCoupon(eventId:string,input:z.infer<typeof couponInput>) {return issueCoupon(this.db,this.runtime,this.clock,eventId,input);}
 async define(eventId:string,input:z.infer<typeof productInput>) {
  const id=createId(),now=(await this.clock()).toISOString();
  await this.db.prepare("INSERT INTO payment_products(id,event_type_id,kind,name,sessions,amount_cents,validity_days,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,eventId,input.kind,input.name,input.sessions,input.amountCents,input.validityDays,now,now).run();
  return {id,...input};
 }
 async products(eventId:string) {return (await this.db.prepare("SELECT id,kind,name,sessions,amount_cents AS amountCents,validity_days AS validityDays FROM payment_products WHERE event_type_id=? AND is_coupon=0 ORDER BY id").bind(eventId).all()).results;}
 async purchase(eventId:string,productId:string,email:string,key:string,returnPath:string) {
  const product=await this.db.prepare("SELECT * FROM payment_products WHERE id=? AND event_type_id=? AND is_coupon=0").bind(productId,eventId).first<Product>();
  if(!product)return {kind:"not_found" as const};
  const live=await this.live();if("refusal" in live)return {kind:"refused" as const,reason:live.refusal};
  const emailFold=foldEmail(email),purchaseKey=await hashToken(key,this.runtime.SESSION_SECRET),now=(await this.clock()).toISOString();
  const code=await deriveOpaqueToken(key,this.runtime.SESSION_SECRET,"appointment-credit.v1"),codeHash=await hashToken(code,this.runtime.SESSION_SECRET);
  await this.db.prepare(`INSERT INTO payment_entitlements(id,product_id,event_type_id,kind,sessions,amount_cents,purchaser_email_folded,code_hash,purchase_key,account_id,state,expires_at,created_at,updated_at)
   SELECT ?,?,?,?,?,?,?,?,?,?,'pending',?,?,? WHERE NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?) ON CONFLICT(purchase_key) DO NOTHING`)
   .bind(createId(),productId,eventId,product.kind,product.sessions,product.amount_cents,emailFold,codeHash,purchaseKey,live.accountId,new Date(Date.parse(now)+product.validity_days*86400000).toISOString(),now,now,emailFold).run();
  const row=await this.db.prepare("SELECT * FROM payment_entitlements WHERE purchase_key=?").bind(purchaseKey).first<Entitlement>();
  if(!row||row.product_id!==productId||row.purchaser_email_folded!==emailFold||row.account_id!==live.accountId||row.state==='erased')return {kind:"refused" as const,reason:"purchase_unavailable"};
  const params:Record<string,string>={mode:product.kind==="membership"?"subscription":"payment",customer_email:emailFold,success_url:new URL(returnPath,this.runtime.APP_URL).toString()+"?purchase={CHECKOUT_SESSION_ID}",cancel_url:this.runtime.APP_URL,"line_items[0][quantity]":"1","line_items[0][price_data][currency]":"usd","line_items[0][price_data][unit_amount]":String(product.amount_cents),"line_items[0][price_data][product_data][name]":product.name,"metadata[dial_entitlement_id]":row.id};
  if(product.kind==="membership"){params["line_items[0][price_data][recurring][interval]"]="month";params["subscription_data[metadata][dial_entitlement_id]"]=row.id;}
  const session=await live.api.createCheckoutSession(live.accountId,params,`dial-entitlement-${row.id}`);
  if(!session.url&&row.state==='pending')throw Error("purchase_checkout_unavailable");
  await this.db.prepare("UPDATE payment_entitlements SET checkout_session_id=?,updated_at=? WHERE id=? AND state='pending'").bind(session.id,now,row.id).run();
  return {kind:"checkout" as const,code,checkoutUrl:session.url,entitlement:entitlementSummary(row)};
 }
 async resolve(eventId:string,email:string,code:string|undefined,priceCents:number) {
  const now=(await this.clock()).toISOString();
  const hash=code?await hashToken(code,this.runtime.SESSION_SECRET):null;
  const rows=(await this.db.prepare(`SELECT e.*,p.name,e.balance-${reservedCredit} AS available_balance FROM payment_entitlements e JOIN payment_products p ON p.id=e.product_id WHERE e.event_type_id=? AND (? IS NOT NULL AND e.code_hash=? OR ? IS NULL AND e.purchaser_email_folded=?) AND NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=e.purchaser_email_folded) ORDER BY e.expires_at,e.id`).bind("",eventId,hash,hash,hash,foldEmail(email)).all<Entitlement>()).results;
  const needed=(row:Entitlement)=>row.kind==='gift'&&!row.is_coupon?priceCents:1;
  const reasonFor=(row:Entitlement)=>row.state!=="active"?row.state==='past_due'?"membership_unpaid":"credit_not_active":row.expires_at<=now||(row.kind==='membership'&&(!row.period_end||row.period_end<=now||!row.period_start||row.period_start>now))?"credit_expired":(row.available_balance??0)<needed(row)?"credit_balance_insufficient":undefined;
  const row=rows.find(row=>!reasonFor(row))??rows[0];
  const reason=row?reasonFor(row):"credit_not_found";
  if(reason||!row)return {kind:"refused" as const,reason:reason!,balance:row?.available_balance??0,...(reason==="credit_expired"?{expiresAt:row!.expires_at}:{})};
  const discountCents=row.is_coupon?Math.min(priceCents,row.amount_cents):priceCents;
  if(priceCents-discountCents>0&&priceCents-discountCents<50)return {kind:"refused" as const,reason:"credit_remainder_below_minimum",balance:row.available_balance??0};
  return {kind:"available" as const,id:row.id,units:needed(row),at:now,discountCents,dueNowCents:priceCents-discountCents,entitlement:entitlementSummary(row)};
 }
 async list() {return Promise.all((await this.db.prepare(`SELECT e.*,p.name,e.balance-${reservedCredit} AS available_balance FROM payment_entitlements e JOIN payment_products p ON p.id=e.product_id ORDER BY e.id`).bind("").all<Entitlement>()).results.map(async row=>({...entitlementSummary(row),email:row.purchaser_email_folded,history:await this.history(row.id)})));}
 async forBooking(bookingId:string) {const row=await this.db.prepare(`SELECT e.*,p.name,e.balance-${reservedCredit} AS available_balance FROM payment_entitlements e JOIN payment_products p ON p.id=e.product_id JOIN payment_redemptions r ON r.entitlement_id=e.id WHERE r.booking_id=?`).bind("",bookingId).first<Entitlement>();return row?{...entitlementSummary(row),history:await this.history(row.id)}:undefined;}
 private async history(id:string) {return (await this.db.prepare("SELECT booking_id AS bookingId,units,discount_cents AS discountCents,restored_at AS restoredAt,created_at AS createdAt FROM payment_redemptions WHERE entitlement_id=? ORDER BY created_at,id").bind(id).all()).results;}
 async erasePurchases(email:string,record:(account:string,session:string)=>Promise<void>,customer:(account:string,id:string)=>Promise<void>) {
  const rows=(await this.db.prepare("SELECT * FROM payment_entitlements WHERE purchaser_email_folded=? ORDER BY id").bind(foldEmail(email)).all<Entitlement>()).results;
  for(const row of rows) {
   if(!row.checkout_session_id&&!row.subscription_id){if(row.state==='pending')throw Error('payment_entitlement_checkout_unresolved');continue;}
   const live=await this.live();if('refusal' in live||live.accountId!==row.account_id)throw Error('payment_entitlement_erasure_processor_unavailable');
   if(row.subscription_id) {const result=await live.api.cancelAppointmentSubscription(row.account_id,row.subscription_id,`dial-entitlement-erasure-${row.id}`);if(result.status!=='canceled')throw Error('payment_entitlement_subscription_unresolved');}
   if(row.checkout_session_id) {
    let session=await live.api.getCheckoutSession(row.account_id,row.checkout_session_id);
    if(session.status==='open')session=await live.api.expireCheckoutSession(row.account_id,row.checkout_session_id);
    if(row.state==='pending'&&session.status!=='expired')throw Error('payment_entitlement_purchase_unresolved');
    if(session.customer)await customer(row.account_id,session.customer);
    await record(row.account_id,row.checkout_session_id);
   }
   await this.db.prepare("UPDATE payment_entitlements SET state='erased',subscription_id=NULL,updated_at=? WHERE id=?").bind(nowIso(),row.id).run();
  }
 }
 async receive(event:StripeEvent) {
  const object=event.data.object,metadata=object.metadata as Record<string,unknown>|undefined;
  const subscription=typeof object.subscription==='string'?object.subscription:((object.parent as {subscription_details?:{subscription?:string}}|undefined)?.subscription_details?.subscription);
  const row=typeof metadata?.dial_entitlement_id==='string'?await this.db.prepare("SELECT * FROM payment_entitlements WHERE id=?").bind(metadata.dial_entitlement_id).first<Entitlement>():subscription?await this.db.prepare("SELECT * FROM payment_entitlements WHERE subscription_id=?").bind(subscription).first<Entitlement>():null;
  if(!row)return undefined;
  if(event.account!==row.account_id)return {kind:"unauthorized" as const};
  if(!['checkout.session.completed','invoice.paid','invoice.payment_failed'].includes(event.type))return undefined;
  const live=await this.live();if('refusal' in live||live.accountId!==row.account_id)throw Error('entitlement_processor_unavailable');
  const now=(await this.clock()).toISOString();let state=row.state,periodStart=row.period_start,periodEnd=row.period_end,subscriptionId=row.subscription_id;
  if(event.type==='checkout.session.completed') {
   if(object.id!==row.checkout_session_id||object.payment_status!=='paid'||object.amount_total!==row.amount_cents||object.currency!=='usd')return {kind:'rejected' as const};
   if(row.state!=='pending')return {kind:'processed' as const};
   state='active';
   if(row.kind==='membership'){if(typeof object.subscription!=='string')return {kind:'rejected' as const};subscriptionId=object.subscription;}
  }
  if(row.kind==='membership') {
   if(!subscriptionId)return {kind:'rejected' as const};
   const sub=await live.api.getAppointmentSubscription(row.account_id,subscriptionId);
   const period=sub.items?.data[0];
   if(sub.metadata?.dial_entitlement_id!==row.id||!period||!Number.isInteger(period.current_period_start)||!Number.isInteger(period.current_period_end))return {kind:'rejected' as const};
   periodStart=new Date(period.current_period_start*1000).toISOString();periodEnd=new Date(period.current_period_end*1000).toISOString();
   if(event.type==='invoice.payment_failed'){if(sub.status!=='past_due'&&sub.status!=='unpaid')return {kind:'processed' as const};state='past_due';}
   else {if(sub.status!=='active')return {kind:'rejected' as const};state='active';}
   if(row.period_start&&periodStart<row.period_start)return {kind:'processed' as const};
  }
  if(periodStart && periodStart>now)return {kind:'rejected' as const};
  const stamp=event.created??0;
  const failed=event.type==='invoice.payment_failed';
  await this.db.batch([
   this.db.prepare(`UPDATE payment_entitlements SET state=?,balance=CASE WHEN ?=1 THEN balance WHEN state='pending' THEN CASE WHEN kind='gift' THEN amount_cents ELSE sessions END WHEN kind='membership' AND (period_start IS NULL OR period_start<?) THEN sessions ELSE balance END,
    subscription_id=?,period_start=CASE WHEN ?=1 THEN period_start ELSE ? END,period_end=CASE WHEN ?=1 THEN period_end ELSE ? END,
    expires_at=CASE WHEN kind='membership' AND ?=0 THEN ? ELSE expires_at END,last_event_at=?,updated_at=? WHERE id=? AND last_event_at<=? AND NOT EXISTS(SELECT 1 FROM payment_entitlement_events WHERE id=?) AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=purchaser_email_folded)`)
    .bind(state,failed?1:0,periodStart,subscriptionId,failed?1:0,periodStart,failed?1:0,periodEnd,failed?1:0,periodEnd,stamp,now,row.id,stamp,event.id),
   this.db.prepare("INSERT INTO payment_entitlement_events(id,entitlement_id,created_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?) ON CONFLICT(id) DO NOTHING").bind(event.id,row.id,now,row.purchaser_email_folded),
  ]);return {kind:'processed' as const};
 }
}
