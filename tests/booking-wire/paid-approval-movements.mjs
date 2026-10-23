import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {audit,noBooking,providerCalls,providerObject} from './paid-approval-support.mjs';

/** PAY-007 inherits PAY-003's real fee/refund movements after SetupIntent approval, and full recovery of a
 * capture that won at Stripe before the host cancelled. All commands go through the native operator doors. */
export async function approvalMoneyMovements(h,priced,setup){
  await approvedSavedCardFee(h,setup);
  await cancelledCapturedApproval(h,priced);
}

async function approvedSavedCardFee(h,setup){
  const {data,call,state}=h;
  const request=await h.authorize(await h.hold(setup,{name:'Leah Patel',email:`synthetic-pay007-fee-ledger-${setup.id.toLowerCase()}@example.test`}));
  const shownFee=request.selected.payment.consent.noShowFeeCents;
  if(request.intent.object==='payment_intent')await h.capture(request);
  const approved=request.intent.object==='payment_intent'?{kind:'approved'}:await data(`/api/app/booking-approvals/${request.request.id}/decision`,{decision:'approve',reason:'Approved the consented consultation'});
  assert.equal(approved.kind,'approved');
  const bookingId=request.request.booking_id;
  const consent=(await state()).booking_card_consents.find(row=>row.booking_id===bookingId);
  assert.equal(consent.no_show_fee_cents,shownFee,'approval retains the fee the invitee actually saw');
  await call('/__fixtures/booking-ended',{id:bookingId},204);
  await data(`/api/app/bookings/${bookingId}/attendance`,{status:'no_show',note:'The invitee did not attend the approved consultation.'});
  await data(`/api/app/bookings/${bookingId}/no-show-fee`,{});
  await data(`/api/app/bookings/${bookingId}/no-show-fee`,{});
  let snap=await state(),money=(await data(`/api/app/bookings/${bookingId}/money`)).money;
  const operator=(await data('/api/app/operators')).operators.find(row=>row.email==='operator@dial.test');
  assert.ok(operator,'native synthetic owner is the actor');
  const fees=money.movements.filter(row=>row.kind==='no_show_fee');
  assert.equal(fees.length,1,'repeating the no-show action charges once');
  const fee=fees[0],charge=providerObject(snap,fee.processorRef);
  assert.deepEqual([fee.status,fee.amountCents,fee.actorType,fee.actorId],['succeeded',shownFee,'operator',operator.id]);
  assert.ok(fee.reason,'fee records its reason');
  assert.deepEqual([charge.status,charge.amount_received,charge.amount_capturable],['succeeded',shownFee,0]);
  assert.equal(charge.payment_method,request.intent.payment_method,'the charge uses the consented SetupIntent card');
  assert.equal(providerCalls(snap,'/v1/payment_intents').filter(row=>JSON.parse(row.body).payment_method===request.intent.payment_method).length,1,'one actual processor fee charge');
  const refund={amountCents:700,reason:'Courtesy refund for the missed consultation',idempotencyKey:randomUUID()};
  await data(`/api/app/bookings/${bookingId}/refunds`,refund);
  await data(`/api/app/bookings/${bookingId}/refunds`,refund);
  snap=await state();money=(await data(`/api/app/bookings/${bookingId}/money`)).money;
  const refunds=money.movements.filter(row=>row.kind==='refund');assert.equal(refunds.length,1,'same-key refund replay creates one movement');
  const returned=refunds[0],providerRefund=providerObject(snap,returned.processorRef);
  assert.deepEqual([returned.status,returned.amountCents,returned.actorType,returned.actorId,returned.reason],['succeeded',700,'operator',operator.id,refund.reason]);
  assert.equal(returned.sourceRef,fee.processorRef,'the refund identifies the original fee charge');
  assert.deepEqual([providerRefund.status,providerRefund.amount,providerRefund.payment_intent],['succeeded',700,fee.processorRef]);
  assert.equal(providerCalls(snap,'/v1/refunds').filter(row=>JSON.parse(row.body).payment_intent===fee.processorRef).length,1,'one actual partial refund reaches Stripe');
  assert.deepEqual([money.ledger.paidCents,money.ledger.feesCents,money.ledger.refundedCents,money.ledger.netCents],[request.intent.object==='payment_intent'?request.intent.amount:0,shownFee,700,(request.intent.object==='payment_intent'?request.intent.amount:0)+shownFee-700]);
  assert.equal(providerObject(snap,fee.processorRef).amount_refunded,700);
}

async function cancelledCapturedApproval(h,priced){
  const {data,call,state}=h;
  const request=await h.authorize(await h.hold(priced,{name:'Jordan Miller',email:`synthetic-pay007-captured-cancel-${priced.id.toLowerCase()}@example.test`}));
  const shownAmount=request.selected.payment.amountCents;
  const token=new URL((await data(`/api/public/payments/${request.returnToken}`)).approvalUrl).pathname.split("/").at(-1);
  assert.equal((await data(`/api/app/booking-approvals/${request.request.id}/decision`,{decision:'approve',reason:'Approved the requested time'})).kind,'capture_pending');
  let snap=await state();noBooking(snap,request.request);
  const captured=providerObject(snap,request.intent.id);
  assert.deepEqual([captured.status,captured.amount_received],['succeeded',shownAmount],'Stripe captured the shown total while its signed fact is withheld');
  await data('/__fixtures/payments/control',{name:'stripe-refund-unavailable',value:1});
  await data(`/api/app/booking-approvals/${request.request.id}/cancel`,{reason:'Host unavailable after reviewing the request'});
  const pendingView=await data(`/api/public/manage/${token}`);assert.equal(pendingView.approval.paymentState,'refund_pending','public status distinguishes a captured refund from an uncharged authorization');assert.equal(pendingView.approval.capturedCents,shownAmount);assert.equal(pendingView.approval.refundedCents,0);
  await data('/__fixtures/payments/control',{name:'stripe-refund-unavailable',value:0});
  await call(`/api/app/booking-approvals/${request.request.id}/cancel`,{reason:'Host unavailable after reviewing the request'},[200,409]);
  snap=await state();noBooking(snap,request.request);
  const closedView=await data(`/api/public/manage/${token}`);assert.equal(closedView.approval.paymentState,'refunded');assert.equal(closedView.approval.refundedCents,shownAmount);
  const refunds=snap.wire_stripe_objects.map(row=>JSON.parse(row.payload)).filter(row=>row.object==='refund'&&row.payment_intent===captured.id);
  assert.equal(refunds.length,1,'cancelling after a processor capture produces one full refund');
  assert.deepEqual([refunds[0].status,refunds[0].amount],['succeeded',shownAmount]);
  const reconciled=providerObject(snap,captured.id);
  assert.deepEqual([reconciled.amount_received,reconciled.amount_refunded],[shownAmount,shownAmount],'processor ledger nets the cancelled authorization to zero');
  const attempts=providerCalls(snap,'/v1/refunds').filter(row=>JSON.parse(row.body).payment_intent===captured.id);assert.equal(attempts.length,2,'one transport refusal and one accepted refund');assert.equal(new Set(attempts.map(row=>JSON.parse(row.headers).idempotency)).size,1,'recovery keeps the same refund command identity');
  audit(snap,'capture',captured.id,shownAmount,'operator');
  audit(snap,'refund',refunds[0].id,shownAmount,'operator');
  const capturedAudit=snap.anonymized_audit.find(row=>row.action==='capture'&&row.processor_ref===captured.id),refundAudit=snap.anonymized_audit.find(row=>row.action==='refund'&&row.processor_ref===refunds[0].id);
  assert.ok(capturedAudit.actor_id&&refundAudit.actor_id,'both money facts retain the operator identity');
  assert.equal(refundAudit.actor_id,capturedAudit.actor_id,'host cancellation and capture record their native actor');
  if(JSON.parse(request.request.payment_json).saveCard){assert.equal(providerObject(snap,request.intent.payment_method).customer,null);audit(snap,'saved_card_detach',request.intent.payment_method,0,'operator');}
  const late=h.event('payment_intent.succeeded',captured);await h.webhook(late);await h.webhook(late);
  const after=await state();noBooking(after,request.request);
  assert.equal(providerCalls(after,'/v1/refunds').filter(row=>JSON.parse(row.body).payment_intent===captured.id).length,attempts.length,'late signed capture replays neither book nor refund twice');
  await call(`/api/app/bookings/${request.request.booking_id}/money`,undefined,404);
}
