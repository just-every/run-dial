import assert from 'node:assert/strict';
import {providerObject,providerCalls,noBooking} from './paid-approval-support.mjs';
import {wireMail,recipient} from './mail-contracts.mjs';
export async function combinedConsentWindow(h,eventType,terms,due,label){
  const {data,call,state,deliver}=h,stale=await h.selection(eventType);
  await data(`/api/app/event-types/${eventType.id}/payment-terms`,{...terms,noShowFeeCents:terms.noShowFeeCents+100},200,'PUT');
  const before=await state(),refused=await(await call(h.base(eventType)+'/confirm',{nonce:stale.nonce,startAt:stale.selection.startAt,inviteeTimezone:'UTC',name:'Leah Patel',email:`synthetic-pay007-${label}-consent@example.test`,answers:{},shownPriceCents:stale.payment.priceCents,shownPaymentCents:due,cardConsent:{accepted:true,version:stale.payment.consent.version}},400)).json();assert.equal(refused.error.code,'card_consent_required');assert.equal((await state()).wire_stripe_sessions.length,before.wire_stripe_sessions.length);
  await data(`/api/app/event-types/${eventType.id}/payment-terms`,terms,200,'PUT');
  for(const mode of ['requires-action','response-lost','unavailable']){
    const name=`stripe-setup-${mode}`;await data('/__fixtures/payments/control',{name,value:1});
    const request=await h.authorize(await h.hold(eventType));let snap=await state(),payment=JSON.parse(snap.booking_approval_requests.find(row=>row.id===request.request.id).payment_json);
    if(mode==='requires-action'){
      assert.equal(payment.state,'voided');assert.equal(providerObject(snap,payment.setupIntentId).status,'canceled');assert.equal(providerObject(snap,request.intent.id).status,'canceled');assert.equal(providerObject(snap,request.intent.payment_method).customer,null);
      assert.equal(providerCalls(snap,`/v1/setup_intents/${payment.setupIntentId}/cancel`).length,1);
    }else{
      assert.equal(payment.state,'setup_pending');await call(`/api/app/booking-approvals/${request.request.id}/decision`,{decision:'approve'},[200,202,409]);noBooking(await state(),request.request);
      if(mode==='unavailable')await call('/__fixtures/payments/window-ended',{holdId:payment.holdId},204);
      await data('/__fixtures/payments/control',{name,value:0});await call('/__fixtures/payments/window-ended',{holdId:payment.holdId},204);await call('/__fixtures/payments/window-ended',{holdId:payment.holdId},204);
      snap=await state();payment=JSON.parse(snap.booking_approval_requests.find(row=>row.id===request.request.id).payment_json);assert.equal(payment.state,'voided');assert.equal(providerObject(snap,request.intent.id).status,'canceled');assert.equal(providerObject(snap,request.intent.payment_method).customer,null);
      assert.equal(snap.wire_stripe_objects.map(row=>JSON.parse(row.payload)).filter(row=>row.object==='setup_intent'&&row.payment_method===request.intent.payment_method).length,1,'lost response never makes a second SetupIntent');
      const creates=providerCalls(snap,'/v1/setup_intents').filter(row=>JSON.parse(row.body)['metadata[dial_hold_id]']===payment.holdId);assert.equal(new Set(creates.map(row=>JSON.parse(row.headers).idempotency)).size,1);
    }
    await data('/__fixtures/payments/control',{name,value:0});await deliver();await deliver();snap=await state();noBooking(snap,request.request);assert.ok((await h.slots(eventType)).some(row=>row.startAt===request.payload.startAt));assert.equal(wireMail(snap).filter(mail=>recipient(mail).includes(request.payload.email)&&/^Booking request expired/.test(mail.subject)).length,1,'partial completion tells invitee once');
  }
  await data('/__fixtures/payments/control',{name:'stripe-setup-response-lost',value:1});
  const incomplete=await h.authorize(await h.hold(eventType));assert.equal(JSON.parse(incomplete.request.payment_json).state,'setup_pending');
  const preview=await data('/api/app/privacy/preview',{email:incomplete.payload.email});
  const erased=await data('/api/app/privacy/erase',{email:incomplete.payload.email,confirmation:preview.confirmation,expiresAt:preview.expiresAt});
  await data('/__fixtures/payments/control',{name:'stripe-setup-response-lost',value:0});
  const after=await state();noBooking(after,incomplete.request);assert.ok(!after.booking_approval_requests.some(row=>row.id===incomplete.request.id));assert.equal(providerObject(after,incomplete.intent.id).status,'canceled');assert.equal(providerObject(after,incomplete.intent.payment_method).customer,null);
  for(const [kind,ref] of [['payment_authorization_void',incomplete.intent.id],['saved_card_detach',incomplete.intent.payment_method],['stripe_customer_anonymize',incomplete.intent.customer]])assert.ok(erased.externalRequests.some(row=>row.kind===kind&&row.processorRef===ref&&row.state==='completed'&&row.requested),'erasure resolves partial combined consent and lists each completed operation');

}
