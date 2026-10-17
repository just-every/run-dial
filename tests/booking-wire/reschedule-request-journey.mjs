import assert from "node:assert/strict";
import { bookingMail, textBody } from "./mail-contracts.mjs";

export async function rescheduleRequestJourney({data,call,state,deliver,future,checks}) {
 const event=await data('/api/app/event-types',{slug:'portfolio-review',title:'Portfolio review',description:'Review your next exhibition.',durationMinutes:60,color:'#176b5a',locationType:'google_meet',locationLabel:'Studio video call',locationValue:'',listed:true,alternativeRequestsEnabled:true,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:15,afterBufferMinutes:15,hostDayBookingLimit:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:360,endMinute:720}))},201);
 await data(`/api/app/event-types/${event.id}/publish`,{});
 const base=`/api/public/book/dial-host/${event.slug}`;
 async function book(email) {
  const slots=(await data(`${base}/availability?week=${future}`)).slots,slot=slots[0];assert.ok(slot);
  const selection=await data(`${base}/selection`,{startAt:slot.startAt,inviteeTimezone:'America/New_York'},201);
  const receipt=await data(`${base}/confirm`,{nonce:selection.nonce,startAt:slot.startAt,inviteeTimezone:'America/New_York',name:'Jordan Rivera',email,answers:{}},201);
  await deliver();const booking=(await state()).bookings.find(row=>row.invitee_email===email);
  return {booking,receipt,manage:`/api/public/manage/${new URL(receipt.manageUrl).pathname.split('/').at(-1)}`};
 }
 const first=await book('request-pick@dial.test');
 const originalIcs=await (await call(new URL(first.receipt.icsUrl).pathname)).text();
 const anonymous=await fetch(new URL(`/api/app/bookings/${first.booking.id}/reschedule-request`,first.receipt.manageUrl),{method:'POST',headers:{origin:new URL(first.receipt.manageUrl).origin,'content-type':'application/json'},body:JSON.stringify({message:'Unauthorized request',releaseTime:true,expiresInDays:14,reminderHours:null})});assert.equal(anonymous.status,401);await anonymous.arrayBuffer();
 assert.ok(!(await state()).booking_reschedule_requests.some(row=>row.booking_id===first.booking.id));
 const templates=await data(`/api/app/event-types/${event.id}/correspondence`);
 await data(`/api/app/event-types/${event.id}/correspondence`,{templates:{...templates.templates,rescheduleRequestSubject:'A new time for {invitee first name}',rescheduleRequestBody:'Please choose again. {message}\n{manage link}',rescheduleRequestReminderSubject:'Still need a new time, {invitee first name}',rescheduleRequestReminderBody:'A reminder: {message}\n{manage link}'}},200,'PUT');
 await data(`/api/app/event-types/${event.id}/booking-policy`,{rescheduleCutoffMinutes:20000,cancellationCutoffMinutes:20000,maxInviteeReschedules:0},200,'PUT');
 await call(`${first.manage}/reschedule/availability?week=${future}`,undefined,409);
 const requested=await data(`/api/app/bookings/${first.booking.id}/reschedule-request`,{message:'The gallery opening moved. Please pick another time.',releaseTime:true,expiresInDays:14,reminderHours:48});
 assert.equal(requested.rescheduleRequest.state,'open');assert.equal(requested.rescheduleRequest.releaseTime,true);
 await call(`/api/app/bookings/${first.booking.id}/reschedule-request`,{message:'Duplicate',releaseTime:true,expiresInDays:14,reminderHours:null},409);
 await deliver();let snap=await state();
 assert.equal(snap.booking_occurrences.find(row=>row.id===first.booking.current_occurrence_id).blocks_time,0);
 assert.ok(!snap.delivery_outbox.some(row=>row.booking_id===first.booking.id&&row.kind==='reminder'&&row.state==='pending'));
 const retired=snap.delivery_outbox.filter(row=>row.booking_id===first.booking.id&&row.kind==='reminder');assert.ok(retired.length);
 const recovery=await data(`/api/app/bookings/${first.booking.id}/deliveries`);assert.ok(retired.every(row=>!recovery.some(command=>command.id===row.id)));
 await call(`/api/app/bookings/${first.booking.id}/deliveries/${retired[0].id}/retry`,{},409);
 assert.ok(!(await data('/api/app/bookings?deliveryFailed=true')).some(row=>row.id===first.booking.id));
 assert.ok((await data('/api/app/bookings?deliveryFailed=false')).some(row=>row.id===first.booking.id));
 const mail=bookingMail(snap,first.booking.id).filter(mail=>mail.subject==='A new time for Jordan');assert.equal(mail.length,1);assert.ok(textBody(mail[0]).includes('The gallery opening moved.'));assert.ok(textBody(mail[0]).includes(first.receipt.manageUrl));
 const provider=snap.wire_events.map(row=>JSON.parse(row.payload)).find(event=>event.extendedProperties.private['dial-booking-id']===first.booking.id);assert.equal(provider.transparency,'transparent');assert.ok(provider.summary.startsWith('Reschedule requested:'));
 assert.ok((await data(`${base}/availability?week=${future}`)).slots.some(slot=>slot.startAt===first.receipt.occurrence.startAt));
 const other=await book('request-old-time@dial.test');assert.equal(other.receipt.occurrence.startAt,first.receipt.occurrence.startAt);
 const options=await data(`${first.manage}/reschedule/availability?week=${future}`),slot=options.slots[0];assert.ok(slot);assert.equal((await data(first.manage)).event.durationMinutes,60);
 const choice=await data(`${first.manage}/reschedule/selection`,{startAt:slot.startAt,inviteeTimezone:'America/New_York',durationMinutes:60},201);
 const changed=await data(`${first.manage}/reschedule`,{nonce:choice.nonce,startAt:slot.startAt,inviteeTimezone:'America/New_York',durationMinutes:60});assert.equal(changed.rescheduleRequest.state,'picked');assert.equal(changed.manageUrl,first.receipt.manageUrl);
 await deliver();snap=await state();const moved=snap.bookings.find(row=>row.id===first.booking.id);assert.equal(moved.ical_uid,first.booking.ical_uid);assert.equal(moved.calendar_provider_event_id,first.booking.calendar_provider_event_id);
 const restored=snap.wire_events.map(row=>JSON.parse(row.payload)).find(event=>event.id===provider.id);assert.equal(restored.transparency,'opaque');assert.ok(!restored.summary.startsWith('Reschedule requested:'));assert.deepEqual(restored.conferenceData,provider.conferenceData);
 const movedIcs=await (await call(new URL(first.receipt.icsUrl).pathname)).text();assert.ok(Number(/SEQUENCE:(\d+)/.exec(movedIcs)[1])>Number(/SEQUENCE:(\d+)/.exec(originalIcs)[1]));
 assert.equal((await data('/api/app/bookings?rescheduleRequest=picked')).some(row=>row.id===moved.id),true);
 await data(`/api/app/event-types/${event.id}/booking-policy`,{},200,'PUT');
 const held=await book('request-held@dial.test');await data(`/api/app/bookings/${held.booking.id}/reschedule-request`,{message:'Please pick a more convenient time.',releaseTime:false,expiresInDays:14,reminderHours:1});
 assert.ok(!(await data(`${base}/availability?week=${future}`)).slots.some(slot=>slot.startAt===held.receipt.occurrence.startAt));
 const heldRecord=await data(`/api/app/bookings/${held.booking.id}`),reminderTime=new Date(Date.parse(heldRecord.rescheduleRequest.reminderAt)+1000).toISOString();
 await call('/__fixtures/request-time',{id:held.booking.id,now:reminderTime},204);await call('/__fixtures/request-time',{id:held.booking.id,now:reminderTime},204);await deliver();
 const reminderRows=(await state()).delivery_outbox.filter(row=>row.idempotency_key===`request:${heldRecord.rescheduleRequest.id}:reminder`);assert.equal(reminderRows.length,1);await call('/__fixtures/due',{id:reminderRows[0].id},204);await deliver();assert.equal(bookingMail(await state(),held.booking.id).filter(mail=>mail.subject==='Still need a new time, Jordan').length,1);
 await call('/__fixtures/request-time',{id:held.booking.id,now:new Date(Date.parse(heldRecord.rescheduleRequest.expiresAt)+1000).toISOString()},204);assert.equal((await data(`/api/app/bookings/${held.booking.id}`)).state,'confirmed');
 const expires=await book('request-expire@dial.test'),expiryRequest=await data(`/api/app/bookings/${expires.booking.id}/reschedule-request`,{message:'Choose another time.',releaseTime:true,expiresInDays:1,reminderHours:null});
 const expiresAt=new Date(Date.parse(expiryRequest.rescheduleRequest.expiresAt)+1000).toISOString();await call('/__fixtures/request-time',{id:expires.booking.id,now:expiresAt},204);await call('/__fixtures/request-time',{id:expires.booking.id,now:expiresAt},204);
 const expired=await data(`/api/app/bookings/${expires.booking.id}`);assert.equal(expired.state,'cancelled');assert.equal(expired.cancelledReason,'no new time picked');assert.equal(expired.rescheduleRequest.state,'expired');assert.equal(expired.history.filter(row=>row.action==='cancelled').length,1);
 checks.push('BOOK-014/BOOK-015/NOTIFY-009: release/hold requests, custom note templates, stable identity/calendar PATCH, cut-off/cap bypass, one reminder and held/released expiry through native public/operator routes');
}
