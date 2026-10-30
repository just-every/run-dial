import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** R6: bought gift value goes through the same public confirmation and cancellation doors as cash. */
export async function giftCertificateRedemption({ data, call, webhook, stripeEvent, rows, event, root, email, slots, selection, manage }) {
 const product=await data(`/api/app/event-types/${event.id}/products`,{kind:'gift',name:'Redemption proof gift',sessions:1,amountCents:3000,validityDays:180},201);
 const purchase=await data(`${root}/products/${product.id}/purchase`,{email,idempotencyKey:randomUUID()},201);
 const stored=(await rows()).payment_entitlements.find(row=>row.id===purchase.entitlement.id);
 const paid=await data('/__fixtures/payments/pay',{sessionId:stored.checkout_session_id});
 const completion=stripeEvent('checkout.session.completed',paid);
 await webhook(completion);await webhook(completion);
 const credit=async()=> (await data('/api/app/payments/entitlements')).find(row=>row.id===stored.id);
 const preview=await data(`${root}/credit`,{email,code:purchase.code,durationMinutes:30});
 assert.deepEqual([preview.entitlement.balance,preview.discountCents,preview.dueNowCents],[3000,3000,2000]);
 const points=(await slots()).slice(0,2);
 const payloads=await Promise.all(points.map(point=>selection(point,{code:purchase.code})));
 const results=await Promise.all(payloads.map(body=>call(`${root}/confirm`,body,[202,409])));
 assert.deepEqual(results.map(response=>response.status).sort(),[202,409],'two gift claims reserve its value atomically');
 const winner=results.findIndex(response=>response.status===202),step=await results[winner].json();
 assert.equal((await credit()).balance,0,'the last gift cents are reserved while Checkout is unpaid');
 assert.equal((await rows()).payment_entitlements.find(row=>row.id===stored.id).balance,3000,'reservation does not debit before payment');
 const processor=await data('/__fixtures/payments/processor-state');
 const session=processor.wire_stripe_sessions.map(row=>JSON.parse(row.payload)).find(row=>row.url===step.payment.checkoutUrl);
 assert.equal(session.amount_total,2000,'Stripe charges exactly the uncovered gift remainder');
 const remainder=await data('/__fixtures/payments/pay',{sessionId:session.id}),settled=stripeEvent('checkout.session.completed',remainder);
 await Promise.all([webhook(settled),webhook(settled)]);
 const returned=await data(`/api/public/payments/${new URL(step.payment.returnUrl).searchParams.get('return')}`);
 assert.equal(returned.state,'confirmed');
 const booking=returned;
 const beforeReplay=await credit();
 assert.deepEqual([beforeReplay.balance,beforeReplay.history.length,beforeReplay.history[0].units,beforeReplay.history[0].discountCents],[0,1,3000,3000],'the gift applies its value once');
 assert.equal((await data(`${root}/confirm`,payloads[winner],200)).manageUrl,booking.manageUrl,'a successful confirmation replay returns the original booking');
 assert.deepEqual(await credit(),beforeReplay);
 const refused=await data(`${root}/confirm`,await selection(points[1-winner],{code:purchase.code}),409);
 assert.equal(refused.error.code,'credit_balance_insufficient');
 assert.deepEqual(await credit(),beforeReplay,'spent gift refusal changes no balance or history');
 await data(`/api/public/manage/${manage(booking)}/cancel`,{reason:'Eligible gift cancellation'});
 await data(`/api/public/manage/${manage(booking)}/cancel`,{reason:'Repeated gift cancellation'});
 assert.deepEqual([(await credit()).balance,(await credit()).history.length],[3000,1],'eligible cancellation restores the gift value once');
 await data('/__fixtures/payments/entitlement-expiry',{id:stored.id,expiresAt:'2000-01-01T00:00:00.000Z'});
 const beforeExpiry=await credit(),beforeRows=await rows();
 assert.equal((await data(`${root}/confirm`,await selection((await slots())[0],{code:purchase.code}),409)).error.code,'credit_expired');
 assert.deepEqual(await credit(),beforeExpiry,'expired gift refusal changes no balance or history');
 assert.equal((await rows()).bookings.length,beforeRows.bookings.length);
 const afterCancel=await data('/__fixtures/payments/processor-state');
 const refund=afterCancel.wire_stripe_objects.filter(row=>row.type==='refunds').map(row=>JSON.parse(row.payload)).find(row=>row.payment_intent===remainder.payment_intent);
 assert.equal(refund.amount,2000,'eligible cancellation refunds only the cash remainder');
 console.log('R6 PASS: public gift purchase, activation, concurrent redemption, replay, spent refusal, cancellation restoration and expiry refusal.');
 return {audit:[['payment',2000,remainder.payment_intent],['refund:succeeded',2000,refund.id]],async assertErased(){
  await webhook(completion);await webhook(settled);
  const erased=await rows();
  assert.equal(erased.payment_entitlements.filter(row=>row.id===stored.id).length,0,'signed gift callbacks cannot revive an erased purchaser');
  assert.equal(erased.payment_redemptions.filter(row=>row.entitlement_id===stored.id).length,0);
  await call(`/api/public/manage/${manage(booking)}`,undefined,404);
 }};
}

/** R19: terminal provider failures and abandonment release only their own reservation, even after reuse. */
export async function failedCheckoutCouponRelease({ data, call, webhook, stripeEvent, rows, event, root, email, slots, selection }) {
 const issue=()=>data(`/api/app/event-types/${event.id}/coupons`,{name:'Failed Checkout proof coupon',email,amountCents:1500,sessions:1,validityDays:180,idempotencyKey:randomUUID()},201);
 const audit=[],callbacks=[],ids=[];
 const checkout=async step=>{
  const processor=await data('/__fixtures/payments/processor-state');
  return processor.wire_stripe_sessions.map(row=>JSON.parse(row.payload)).find(row=>row.url===step.payment.checkoutUrl);
 };
 for(const [kind,type] of [['coupon','checkout.session.async_payment_failed'],['coupon','payment_intent.payment_failed'],['coupon','checkout.session.expired'],['gift','checkout.session.async_payment_failed']]) {
  let coupon;
  if(kind==='coupon')coupon=await issue();
  else {
   const product=await data(`/api/app/event-types/${event.id}/products`,{kind:'gift',name:'Failed Checkout proof gift',sessions:1,amountCents:3000,validityDays:180},201);
   coupon=await data(`${root}/products/${product.id}/purchase`,{email,idempotencyKey:randomUUID()},201);
   const stored=(await rows()).payment_entitlements.find(row=>row.id===coupon.entitlement.id);
   await webhook(stripeEvent('checkout.session.completed',await data('/__fixtures/payments/pay',{sessionId:stored.checkout_session_id})));
  }
  ids.push(coupon.entitlement.id);
  const balance=kind==='gift'?3000:1,discount=kind==='gift'?3000:1500;
  const code={code:coupon.code},credit=async()=> (await data('/api/app/payments/entitlements')).find(row=>row.id===coupon.entitlement.id);
  const payload=await selection((await slots())[0],code),step=await data(`${root}/confirm`,payload,202),session=await checkout(step);
  assert.equal((await credit()).balance,0,'Checkout reserves the last coupon use');
  const pending=type==='checkout.session.expired'?session:await data('/__fixtures/payments/pay',{sessionId:session.id,paymentStatus:'unpaid'});
  if(type!=='checkout.session.expired')await webhook(stripeEvent('checkout.session.completed',pending));
  assert.equal((await credit()).balance,0,'an unpaid or processing Checkout keeps its reservation');
  const object=type.startsWith('payment_intent.')?{id:pending.payment_intent,object:'payment_intent',metadata:session.payment_intent_data.metadata}:{...pending,status:type.endsWith('expired')?'expired':'complete'};
  const failed=stripeEvent(type,object);
  const before=await rows();
  await Promise.all([webhook(failed),webhook(failed)]);
  assert.deepEqual([(await credit()).balance,(await credit()).history.length],[balance,0],`${type} releases the reservation once without a redemption`);
  assert.equal((await rows()).bookings.length,before.bookings.length,'failed Checkout confirms nothing');
  await call(`${root}/confirm`,payload,410);
  const reused=await data(`${root}/confirm`,await selection(payload.startAt,code),202);
  assert.equal((await credit()).balance,0,'a fresh Checkout reserves the released use');
  await webhook(failed);
  assert.equal((await credit()).balance,0,'an old failed Checkout cannot release a fresh reservation');
  const next=await checkout(reused),paid=await data('/__fixtures/payments/pay',{sessionId:next.id});
  const succeeded=stripeEvent('checkout.session.completed',paid);
  await Promise.all([webhook(succeeded),webhook(failed),webhook(succeeded)]);
  audit.push(['payment',5000-discount,paid.payment_intent]);
  callbacks.push(failed,succeeded);
  const spent=await credit();
  assert.deepEqual([spent.balance,spent.history.length,spent.history[0].discountCents],[0,1,discount],'the reused coupon settles once despite failure and success replays');
 }
 console.log('R19 PASS: coupon and gift failure, signed async failure, PaymentIntent failure and abandoned Checkout release once; replay preserves reused credit.');
 return {audit,async assertErased(){
  for(const callback of callbacks)await webhook(callback);
  const erased=await rows();
  assert.equal(erased.payment_entitlements.filter(row=>ids.includes(row.id)).length,0,'failed and paid Checkout replays cannot revive erased credit');
  assert.equal(erased.payment_redemptions.filter(row=>ids.includes(row.entitlement_id)).length,0);
 }};
}
