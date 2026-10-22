import assert from 'node:assert/strict';
import {bookingMail,recipient,textBody,wireMail} from './mail-contracts.mjs';
import {feeTerms,providerObject,providerCalls,noBooking,audit} from './paid-approval-support.mjs';
import {approvalReleaseCases} from './paid-approval-release.mjs';
export async function approvalDepositAndSetup(h,setup,pass){
  const {data,call,state,deliver}=h;
  const deposit=await h.makeEvent('synthetic-pay007-deposit',{price:10000,terms:{deposit:{kind:'fixed',amountCents:2500},balanceDueHours:24,freeWindowHours:null,lateCancelFeeCents:0,noShowFeeCents:0}});
  await data('/api/app/payments/settings',{taxEnabled:true,businessName:'Northbank Consultation Studio'},200,'PUT');
  const selected=await h.selection(deposit),billingAddress={line1:'125 Example Avenue',city:'New York',state:'NY',postalCode:'10001',country:'US'};
  const quote=await data(h.base(deposit)+'/tax',{nonce:selected.nonce,startAt:selected.selection.startAt,inviteeTimezone:'UTC',billingAddress});assert.deepEqual([quote.dueNowCents,quote.dueNowTaxCents,quote.dueNowTotalCents],[2500,222,2722],'deposit tax oracle: 25USD at synthetic NY rate8.875%');
  const held=await h.authorize(await h.hold(deposit,{selection:selected,payload:{billingAddress,shownTaxCents:222,shownPaymentCents:2722}}));assert.deepEqual([held.intent.amount,held.intent.amount_capturable,held.intent.amount_received],[2722,2722,0]);assert.ok(!(await state()).payment_link_tokens.some(row=>row.booking_id===held.request.booking_id),'no balance link before capture');
  await h.capture(held);await deliver();const snap=await state(),money=(await data(`/api/app/bookings/${held.request.booking_id}/money`)).money;assert.ok(money);const status=await data(`/api/public/payments/${held.returnToken}`);const token=new URL(status.manageUrl).pathname.split('/').at(-1),manage=await data('/api/public/manage/'+token);assert.equal(manage.payment.balanceDueCents,8166,'remaining75USD plus NY tax6.66');assert.ok(manage.payment.balanceUrl,'balance link exists only after approval capture');assert.ok(wireMail(snap).some(mail=>recipient(mail).includes(held.payload.email)&&JSON.stringify(mail).includes('balance')),'approval mail carries balance');
  const depositMails=bookingMail(snap,held.request.booking_id);assert.ok(depositMails.length>0);for(const mail of depositMails){for(const amount of ['$27.22 USD','$2.22 USD','$81.66 USD'])assert.ok(textBody(mail).includes(amount),'deposit confirmation agrees with captured deposit, tax and remaining balance');assert.ok(textBody(mail).includes(held.session.id));}
  await data('/api/app/payments/settings',{taxEnabled:false,businessName:'Northbank Consultation Studio'},200,'PUT');
  await approvalReleaseCases(h,deposit,await h.authorize(await h.hold(deposit)));
  pass(7,'deposit alone plus shown tax authorized; balance payment link follows signed approval capture; decline, expiry and host cancellation void once, release and notify once');
  const stale=await h.selection(setup),beforeStale=await state();await data(`/api/app/event-types/${setup.id}/payment-terms`,{...feeTerms,noShowFeeCents:2800},200,'PUT');const refused=await(await call(h.base(setup)+'/confirm',{nonce:stale.nonce,startAt:stale.selection.startAt,inviteeTimezone:'UTC',name:'Leah Patel',email:'synthetic-pay007-consent@example.test',answers:{},cardConsent:{accepted:true,version:stale.payment.consent.version}},400)).json();assert.equal(refused.error.code,'card_consent_required');assert.equal((await state()).wire_stripe_sessions.length,beforeStale.wire_stripe_sessions.length,'stale consent refused before Checkout');
  for(const decision of ['approve','decline','expiry','cancel']){
    const request=await h.authorize(await h.hold(setup));
    let current=await state();
    assert.equal(request.session.mode,'setup');assert.equal(request.intent.object,'setup_intent');assert.equal(request.session.amount_total,null);noBooking(current,request.request);
    assert.ok(!current.wire_stripe_objects.map(row=>JSON.parse(row.payload)).some(row=>row.object==='payment_intent'&&row.customer===request.intent.customer),'SetupIntent creates no charge');
    if(decision==='expiry'){
      await call('/__fixtures/approval-expiry',{id:request.request.id},204);
      await call('/__fixtures/approval-expiry',{id:request.request.id},204);
    }else if(decision==='cancel'){
      assert.equal((await data(`/api/app/booking-approvals/${request.request.id}/cancel`,{reason:'Host unavailable for this saved-card request'})).kind,'declined');
      await call(`/api/app/booking-approvals/${request.request.id}/cancel`,{reason:'Host unavailable for this saved-card request'},[200,409]);
    }else{
      assert.equal((await data(`/api/app/booking-approvals/${request.request.id}/decision`,{decision,reason:'Reviewed card-save request'})).kind,decision==='approve'?'approved':'declined');
      if(decision==='decline')await call(`/api/app/booking-approvals/${request.request.id}/decision`,{decision:'decline'},409);
    }
    await deliver();await deliver();current=await state();
    if(decision==='approve'){
      assert.equal(current.bookings.find(row=>row.id===request.request.booking_id).state,'confirmed');
      const consent=current.booking_card_consents.find(row=>row.booking_id===request.request.booking_id);
      assert.equal(consent.stripe_payment_method_id,request.intent.payment_method);
      assert.equal(consent.consent_text_version,request.selected.payment.consent.version,'approval retains shown consent version');
      const confirmations=bookingMail(current,request.request.booking_id),recipients=[request.payload.email,...(await data('/api/app/operators')).operators.filter(row=>!row.mailMuted).map(row=>row.email)];for(const email of recipients)assert.equal(confirmations.filter(mail=>recipient(mail).includes(email)).length,1,'SetupIntent approval sends one confirmation per recipient');
    }else{
      noBooking(current,request.request);
      assert.equal(providerObject(current,request.intent.payment_method).customer,null);
      assert.equal(providerCalls(current,`/v1/payment_methods/${request.intent.payment_method}/detach`).length,1,'terminal saved-card request detaches once even after replay');
      audit(current,'saved_card_detach',request.intent.payment_method,0,decision==='expiry'?'system':'operator');
      const notices=wireMail(current).filter(mail=>recipient(mail).includes(request.payload.email)&&/^Booking request (declined|expired):/.test(mail.subject));
      assert.equal(notices.length,1,'decline, expiry or host cancellation sends the invitee one terminal notice');
      assert.ok((await h.slots(setup)).some(slot=>slot.startAt===request.payload.startAt),'terminal saved-card request releases its slot');
      await call(`/api/app/booking-approvals/${request.request.id}/decision`,{decision:'approve'},409);
    }
  }
  pass(8,'fresh shown SetupIntent consent required; no preapproval charge; approval transfers consent; decline, expiry and host cancellation detach once and send one terminal notice');
}
