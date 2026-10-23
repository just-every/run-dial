import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export const noFees={deposit:{kind:'none'},balanceDueHours:24,freeWindowHours:null,lateCancelFeeCents:0,noShowFeeCents:0};
export const feeTerms={...noFees,freeWindowHours:24,lateCancelFeeCents:1200,noShowFeeCents:2400};
export const providerObject=(snap,id)=>JSON.parse(snap.wire_stripe_objects.find(row=>row.id===id).payload);
export const providerCalls=(snap,path)=>snap.wire_calls.filter(row=>new URL(row.url).pathname===path);
export function noBooking(snap,request){assert.ok(!snap.bookings.some(row=>row.id===request.booking_id),'approval request creates no booking');assert.ok(!snap.delivery_outbox.some(row=>row.booking_id===request.booking_id&&['calendar_upsert','reminder'].includes(row.kind)),'no calendar or reminders before signed capture');}
export function audit(snap,action,reference,amount,actor){const rows=snap.anonymized_audit.filter(row=>row.action===action&&row.processor_ref===reference);assert.equal(rows.length,1,`${action} recorded once`);assert.equal(rows[0].amount_cents,amount);assert.equal(rows[0].actor_type,actor);assert.ok(rows[0].reason,`${action} records its reason`);}
export async function paidApprovalSupport(context){
  const {data,state,future}=context,origin=context.origin??process.env.DIAL_REVIEW_ORIGIN;
  const config=await readFile(new URL('./worker.wrangler.toml',import.meta.url),'utf8');
  const secret=config.match(/^STRIPE_WEBHOOK_SECRET = "([^"]+)"/m)[1];
  const event=(type,object,account='acct_wirehost')=>JSON.stringify({id:`synthetic-pay007-${type}-${object.id}`,object:'event',type,account,created:Math.floor(Date.now()/1000),livemode:false,data:{object}});
  const signature=(payload,timestamp=Math.floor(Date.now()/1000))=>`t=${timestamp},v1=${createHmac('sha256',secret).update(`${timestamp}.${payload}`).digest('hex')}`;
  async function webhook(payload,expected=200,header=signature(payload)){
    const response=await fetch(origin+'/api/webhooks/stripe',{method:'POST',headers:{Origin:origin,'content-type':'application/json',...(header?{'stripe-signature':header}:{})},body:payload});assert.equal(response.status,expected,'signed provider callback status');return response;
  }
  async function makeEvent(slug,{price=null,terms=noFees}={}){
    const value=await data('/api/app/event-types',{slug,title:'Approval strategy consultation',description:'A focused consultation with time reserved for host review.',durationMinutes:30,color:'#176b5a',locationType:'fixed_link',locationLabel:'Consultation room',locationValue:'https://meet.example.test/approval-consultation',listed:true,alternativeRequestsEnabled:false,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:600,endMinute:1200}))},201);
    if(price!==null)await data(`/api/app/event-types/${value.id}/price`,{amountCents:price,durationPrices:[]},200,'PUT');
    if(terms!==noFees)await data(`/api/app/event-types/${value.id}/payment-terms`,terms,200,'PUT');
    await data(`/api/app/event-types/${value.id}/approval`,{required:true,windowHours:24},200,'PUT');await data(`/api/app/event-types/${value.id}/publish`,{});return value;
  }
  const base=event=>`/api/public/book/dial-host/${event.slug}`;
  const slots=async event=>(await data(`${base(event)}/availability?week=${future}`)).slots;
  async function selection(event,startAt){startAt??=(await slots(event))[0].startAt;const created=await data(base(event)+'/selection',{startAt,inviteeTimezone:'UTC'},201);return data(base(event)+'/selection?'+new URLSearchParams({nonce:created.nonce,startAt,inviteeTimezone:'UTC'}));}
  let sequence=0;
  async function hold(event,options={}){
    const selected=options.selection??await selection(event),email=options.email??`synthetic-pay007-${++sequence}@example.test`;
    const payload={nonce:selected.nonce,startAt:selected.selection.startAt,inviteeTimezone:'UTC',name:options.name??'Maya Chen',email,answers:{},...(selected.payment.mode==='payment'?{shownPriceCents:selected.payment.priceCents,shownPaymentCents:selected.payment.amountCents}:{}),...(selected.payment.consent?{cardConsent:{accepted:true,version:selected.payment.consent.version}}:{}),...options.payload};
    const step=await data(base(event)+'/confirm',payload,202),snap=await state(),session=JSON.parse(snap.wire_stripe_sessions.find(row=>JSON.parse(row.payload).url===step.payment.checkoutUrl).payload);
    return {event,selected,payload,step,session,returnToken:new URL(step.payment.returnUrl).searchParams.get('return')};
  }
  async function authorize(held,method='card'){
    const session=await data('/__fixtures/payments/pay',{sessionId:held.session.id,paymentMethod:method});
    const snap=await state(),intent=providerObject(snap,session.payment_intent??session.setup_intent);
    await webhook(event(session.mode==='setup'?'checkout.session.completed':'payment_intent.amount_capturable_updated',session.mode==='setup'?session:intent));
    const request=(await state()).booking_approval_requests.find(row=>row.invitee_email===held.payload.email);assert.ok(request,'signed authorization creates pending approval');return {...held,session,intent,request};
  }
  async function capture(held){const decision=await data(`/api/app/booking-approvals/${held.request.id}/decision`,{decision:'approve',reason:'Reviewed consultation request'});assert.equal(decision.kind,'capture_pending');const snap=await state();noBooking(snap,held.request);const intent=providerObject(snap,held.intent.id);assert.equal(intent.status,'succeeded');await webhook(event('payment_intent.succeeded',intent));return {intent,booking:(await state()).bookings.find(row=>row.id===held.request.booking_id)};}
  return {...context,event,signature,webhook,makeEvent,base,slots,selection,hold,authorize,capture};
}
