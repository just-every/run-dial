import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";

/** The machine door delegates payment and approval to their ordinary native authorities. */
export async function continuationJourney({call,json,issue,week,db,origin}) {
 const address=n=>`synthetic-dial-continuation-${n}${String.fromCharCode(64)}example.test`;
 const credential=await issue(["bookings:read","bookings:write","workflows:manage"]),options={secret:credential.secret};
 const operator=(path,body,status=200,method)=>json(path,{session:true,body,method},status);
 const oauth=await call("/api/app/payments/stripe/oauth/start",{session:true});assert.equal(oauth.status,302);
 const state=new URL(oauth.headers.get("location")).searchParams.get("state");
 assert.equal((await call(`/api/payments/stripe/oauth/callback?${new URLSearchParams({state,code:"wire-stripe-consent"})}`,{session:true})).status,302);
 const config=await readFile(new URL("../booking-wire/worker.wrangler.toml",import.meta.url),"utf8");
 const signingSecret=config.match(/^STRIPE_WEBHOOK_SECRET = "([^"]+)"/m)[1];
 let sequence=0;
 const snapshot=()=>json("/wire/state");
 const webhook=async(type,object,valid=true)=>{
  const timestamp=Math.floor(Date.now()/1000),payload=JSON.stringify({id:`synthetic-dial-event-${++sequence}`,type,account:"acct_wirehost",livemode:false,created:timestamp,data:{object}});
  const signature=createHmac("sha256",signingSecret).update(`${timestamp}.${payload}`).digest("hex");
  const response=await fetch(origin+"/api/webhooks/stripe",{method:"POST",headers:{"content-type":"application/json","stripe-signature":`t=${timestamp},v1=${valid?signature:"synthetic-dial-invalid"}`},body:payload});
  assert.equal(response.status,valid?200:401);await response.arrayBuffer();
 };
 const makeEvent=async(number,{approval=false,price=null,terms}={})=>{
  const event=await operator("/api/app/event-types",{slug:`synthetic-dial-continuation-${number}`,title:"Synthetic API consultation",description:"A provider-edge booking continuation.",durationMinutes:30,color:"#176b5a",locationType:"in_person",locationLabel:"Meeting room",locationValue:"Synthetic room",listed:true,alternativeRequestsEnabled:false,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:0,endMinute:1440}))},201);
  if(price!==null)await operator(`/api/app/event-types/${event.id}/price`,{amountCents:price,durationPrices:[]},200,"PUT");
  if(terms)await operator(`/api/app/event-types/${event.id}/payment-terms`,terms,200,"PUT");
  if(approval)await operator(`/api/app/event-types/${event.id}/approval`,{required:true,windowHours:24},200,"PUT");
  await operator(`/api/app/event-types/${event.id}/publish`,{});
  return event;
 };
 const booking=async(event,number,extra={})=>{
  const slots=await json(`/api/v1/availability?eventTypeId=${event.id}&week=${week}&inviteeTimezone=UTC`,options);
  assert.ok(slots.slots.length);
  return {eventTypeId:event.id,startAt:slots.slots.at(-number-2).startAt,inviteeTimezone:"UTC",name:"Synthetic API invitee",email:address(number),answers:{},...extra};
 };
 const book=(body,key,status=202)=>json("/api/v1/bookings",{...options,key,body},status);
 const noBooking=async id=>assert.equal(await db.prepare("SELECT id FROM bookings WHERE id=?").bind(id).first(),null,"no booking before its native approval or signed payment");
 const safe=response=>{const text=JSON.stringify(response);assert.ok(!text.includes("/manage/")&&!text.includes("return=")&&!text.includes("token"),"machine response never returns management or return authority");};
 const free=await makeEvent(1,{approval:true}),freeBody=await booking(free,1),freeKey="synthetic-dial-free-approval";
 const pending=await book(freeBody,freeKey);assert.equal(pending.state,"pending_approval");assert.ok(pending.id);safe(pending);await noBooking(pending.id);
 const request=await db.prepare("SELECT id FROM booking_approval_requests WHERE booking_id=?").bind(pending.id).first();
 assert.ok(!(await json(`/api/v1/availability?eventTypeId=${free.id}&week=${week}&inviteeTimezone=UTC`,options)).slots.some(slot=>slot.startAt===freeBody.startAt),"approval holds the selected slot");
 assert.equal((await json(`/api/v1/bookings/${pending.id}`,options)).state,"pending_approval");
 assert.ok((await json("/api/v1/bookings",options)).data.some(row=>row.id===pending.id),"pending resource appears in ordinary cursor listings");
 const replay=await call("/api/v1/bookings",{...options,key:freeKey,body:freeBody});assert.equal(replay.headers.get("Idempotent-Replay"),"true");assert.deepEqual(await replay.json(),pending);
 assert.equal((await call(`/api/app/booking-approvals/${request.id}/decision`,{...options,body:{decision:"approve"}})).status,401);await noBooking(pending.id);
 assert.equal((await call(`/api/v1/bookings/${pending.id}/approve`,{...options,key:"synthetic-dial-machine-approval",body:{}})).status,404);await noBooking(pending.id);
 await operator(`/api/app/booking-approvals/${request.id}/decision`,{decision:"approve"});
 assert.equal((await json(`/api/v1/bookings/${pending.id}`,options)).state,"confirmed");
 const terms={deposit:{kind:"fixed",amountCents:1000},balanceDueHours:24,freeWindowHours:24,lateCancelFeeCents:0,noShowFeeCents:0};
 const priced=await makeEvent(2,{price:4000,terms}),paidBody=await booking(priced,2);
 const paymentRule=await json("/api/v1/workflows",{...options,key:"synthetic-dial-payment-workflow",body:{name:"Synthetic payment follow-through",eventTypeId:priced.id,enabled:true,trigger:"payment-received",subject:"Synthetic payment proof",text:"Your deposit was received."}},201);
 const before=(await snapshot()).payment_holds.length;
 for(const override of [{amountCents:1},{price:0},{paid:true}])assert.equal((await call("/api/v1/bookings",{...options,key:"synthetic-dial-price-override",body:{...paidBody,...override}})).status,400);
 assert.equal((await snapshot()).payment_holds.length,before,"money overrides create no hold");
 const paid=await book(paidBody,"synthetic-dial-paid-booking");safe(paid);assert.equal(paid.state,"payment_required");assert.equal(paid.payment.amountCents,1000);assert.ok(paid.payment.checkoutUrl);await noBooking(paid.id);
 const held=await snapshot(),session=JSON.parse(held.wire_stripe_sessions.find(row=>JSON.parse(row.payload).url===paid.payment.checkoutUrl).payload);
 const paidReplay=await book(paidBody,"synthetic-dial-paid-booking");assert.deepEqual(paidReplay,paid);assert.equal((await snapshot()).wire_stripe_sessions.length,held.wire_stripe_sessions.length);
 const completed=await json("/__fixtures/payments/pay",{body:{sessionId:session.id}});
 await webhook("checkout.session.completed",completed,false);await noBooking(paid.id);
 await webhook("checkout.session.completed",completed);await webhook("checkout.session.completed",completed);
 const confirmed=await json(`/api/v1/bookings/${paid.id}`,options);assert.equal(confirmed.state,"confirmed");assert.equal(confirmed.payment.amountCents,1000);
 for(let i=0;i<2;i++){const tick=await call("/cdn-cgi/local/scheduled?format=json");assert.equal(tick.status,200);await tick.arrayBuffer();await json("/__fixtures/deliver",{body:{}});}
 const paymentRuns=(await json(`/api/v1/workflows/${paymentRule.id}/runs`,options)).data;assert.equal(paymentRuns.length,1);assert.equal(paymentRuns[0].outcome,"sent","a signed deposit payment fires its workflow once");
 const cancelKey="synthetic-dial-paid-cancel";
 await json(`/api/v1/bookings/${paid.id}/cancel`,{...options,key:cancelKey,body:{}});
 await json(`/api/v1/bookings/${paid.id}/cancel`,{...options,key:cancelKey,body:{}});
 const cancelled=await snapshot(),refunds=cancelled.payment_movements.filter(row=>row.booking_id===paid.id&&row.kind==="refund");assert.equal(refunds.length,1);assert.equal(refunds[0].amount_cents,1000,"ordinary cancellation refunds the deposit once under the saved policy");
 const approvedPrice=await makeEvent(3,{price:6400,approval:true}),approvalBody=await booking(approvedPrice,3),approvalStep=await book(approvalBody,"synthetic-dial-paid-approval");safe(approvalStep);
 assert.equal(approvalStep.payment.amountCents,6400);await noBooking(approvalStep.id);
 const approvalSnapshot=await snapshot(),approvalSession=JSON.parse(approvalSnapshot.wire_stripe_sessions.find(row=>JSON.parse(row.payload).url===approvalStep.payment.checkoutUrl).payload);
 assert.equal(approvalSession.payment_intent_data.capture_method,"manual");
 const authorized=await json("/__fixtures/payments/pay",{body:{sessionId:approvalSession.id,paymentMethod:"card"}});
 let snap=await snapshot(),intent=JSON.parse(snap.wire_stripe_objects.find(row=>row.id===authorized.payment_intent).payload);
 await webhook("payment_intent.amount_capturable_updated",intent);await noBooking(approvalStep.id);
 const approvalRequest=snap=await snapshot(),approvalRow=approvalRequest.booking_approval_requests.find(row=>row.booking_id===approvalStep.id);
 assert.equal((await json(`/api/v1/bookings/${approvalStep.id}`,options)).state,"pending_approval");
 assert.equal((await operator(`/api/app/booking-approvals/${approvalRow.id}/decision`,{decision:"approve"})).kind,"capture_pending");await noBooking(approvalStep.id);
 snap=await snapshot();intent=JSON.parse(snap.wire_stripe_objects.find(row=>row.id===authorized.payment_intent).payload);
 await webhook("payment_intent.succeeded",intent,false);await noBooking(approvalStep.id);
 await webhook("payment_intent.succeeded",intent);assert.equal((await json(`/api/v1/bookings/${approvalStep.id}`,options)).state,"confirmed");
 const feeEvent=await makeEvent(6,{terms:{...terms,deposit:{kind:"none"},lateCancelFeeCents:1200,noShowFeeCents:2400}}),feeBody=await booking(feeEvent,6);
 const notConsented=await call("/api/v1/bookings",{...options,key:"synthetic-dial-no-fee-consent",body:feeBody});assert.equal(notConsented.status,422);assert.equal((await notConsented.json()).error.code,"card_consent_required");
 const selection=await json(`/api/public/book/dial-host/${feeEvent.slug}/selection`,{body:{startAt:feeBody.startAt,inviteeTimezone:"UTC"}},201);
 const disclosed=await json(`/api/public/book/dial-host/${feeEvent.slug}/selection?${new URLSearchParams({startAt:feeBody.startAt,nonce:selection.nonce,inviteeTimezone:"UTC"})}`);
 const consented=await book({...feeBody,cardConsent:{accepted:true,version:disclosed.payment.consent.version}},"synthetic-dial-consented-card");safe(consented);assert.equal(consented.payment.mode,"setup");assert.equal(consented.payment.amountCents,0);await noBooking(consented.id);
 snap=await snapshot();const feeSession=JSON.parse(snap.wire_stripe_sessions.find(row=>JSON.parse(row.payload).url===consented.payment.checkoutUrl).payload);
 const setupComplete=await json("/__fixtures/payments/pay",{body:{sessionId:feeSession.id}});
 await webhook("checkout.session.completed",setupComplete,false);await noBooking(consented.id);
 await webhook("checkout.session.completed",setupComplete);assert.equal((await json(`/api/v1/bookings/${consented.id}`,options)).state,"confirmed");
 // Both tentative resource families retain an erased-key tombstone.
 for(const [event,number] of [[free,4],[priced,5]]){
  const body=await booking(event,number),key=`synthetic-dial-erased-pending-${number}`,step=await book(body,key);
  const preview=await operator("/api/app/privacy/preview",{email:body.email});
  await operator("/api/app/privacy/erase",{email:body.email,confirmation:preview.confirmation,expiresAt:preview.expiresAt});
  assert.equal((await call(`/api/v1/bookings/${step.id}`,options)).status,404);
  const erased=await call("/api/v1/bookings",{...options,key,body});assert.equal(erased.status,410);assert.equal((await erased.json()).error.code,"erased");await noBooking(step.id);
 }
}
