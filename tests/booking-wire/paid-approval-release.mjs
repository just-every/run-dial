import assert from 'node:assert/strict';
import {recipient,wireMail} from './mail-contracts.mjs';
import {providerObject,providerCalls,noBooking,audit} from './paid-approval-support.mjs';
export async function approvalReleaseCases(h,priced,linked){
  const {data,call,state,deliver}=h;
  for(const decision of ['decline','expiry','cancel']){
    const held=decision==='decline'?linked:await h.authorize(await h.hold(priced));
    if(decision==='expiry'){await call('/__fixtures/approval-expiry',{id:held.request.id},204);await call('/__fixtures/approval-expiry',{id:held.request.id},204);}
    else if(decision==='cancel'){await data(`/api/app/booking-approvals/${held.request.id}/cancel`,{reason:'Host unavailable'});await call(`/api/app/booking-approvals/${held.request.id}/cancel`,{reason:'Host unavailable'},[200,409]);}
    else{await data(`/api/app/booking-approvals/${held.request.id}/decision`,{decision:'decline',reason:'Time unavailable'});await call(`/api/app/booking-approvals/${held.request.id}/decision`,{decision:'decline'},409);}
    await deliver();await deliver();const snap=await state();noBooking(snap,held.request);const intent=providerObject(snap,held.intent.id);assert.deepEqual([intent.status,intent.amount_received,intent.amount_capturable],['canceled',0,0]);assert.equal(providerCalls(snap,`/v1/payment_intents/${intent.id}/cancel`).length,1,'authorization voids once');
    if(JSON.parse(held.request.payment_json).saveCard){assert.equal(providerObject(snap,held.intent.payment_method).customer,null);assert.equal(providerCalls(snap,`/v1/payment_methods/${held.intent.payment_method}/detach`).length,1,'combined terminal request detaches once');audit(snap,'saved_card_detach',held.intent.payment_method,0,decision==='expiry'?'system':'operator');}
    assert.ok((await h.slots(priced)).some(slot=>slot.startAt===held.payload.startAt),'void releases slot');
    const notices=wireMail(snap).filter(mail=>recipient(mail).includes(held.payload.email)&&/^Booking request (declined|expired):/.test(mail.subject));assert.equal(notices.length,1,'one terminal notice');
    audit(snap,'void',intent.id,held.intent.amount,decision==='expiry'?'system':'operator');
    await call('/__fixtures/payments/capture',{intentId:intent.id,amountCents:held.intent.amount},400);await call(`/api/app/booking-approvals/${held.request.id}/decision`,{decision:'approve'},409);noBooking(await state(),held.request);
  }
}
export async function approvalErasureCases(h,priced,setup,...combined){
  const {data,call,state}=h;
  for(const eventType of [priced,setup,...combined]){
    const held=await h.authorize(await h.hold(eventType));const preview=await data('/api/app/privacy/preview',{email:held.payload.email});assert.ok(preview.externalRequests.some(row=>row.processorRef===(held.intent.object==='setup_intent'?held.intent.payment_method:held.session.id)),'preview lists known pending approval cleanup references');const erased=await data('/api/app/privacy/erase',{email:held.payload.email,confirmation:preview.confirmation,expiresAt:preview.expiresAt});if(JSON.parse(held.request.payment_json).saveCard){for(const [kind,ref] of [['payment_authorization_void',held.intent.id],['saved_card_detach',held.intent.payment_method],['stripe_customer_anonymize',held.intent.customer]])assert.ok(erased.externalRequests.some(row=>row.kind===kind&&row.processorRef===ref&&row.state==='completed'&&row.requested),'combined erasure lists each completed processor operation');assert.equal(providerObject(await state(),held.intent.payment_method).customer,null);}
    const snap=await state();assert.ok(!snap.booking_approval_requests.some(row=>row.id===held.request.id));noBooking(snap,held.request);
    if(held.intent.object==='payment_intent')assert.equal(providerObject(snap,held.intent.id).status,'canceled','erasure voids pending authorization');else assert.equal(providerObject(snap,held.intent.payment_method).customer,null,'erasure detaches SetupIntent card');
    const late=h.event(held.intent.object==='payment_intent'?'payment_intent.succeeded':'checkout.session.completed',held.intent.object==='payment_intent'?{...held.intent,status:'succeeded',amount_received:held.intent.amount,amount_capturable:0}:held.session);
    await h.webhook(late);await h.webhook(late);noBooking(await state(),held.request);await call(`/api/app/booking-approvals/${held.request.id}/decision`,{decision:'approve'},404);
  }
}
