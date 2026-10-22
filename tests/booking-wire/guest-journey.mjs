import assert from "node:assert/strict";
import { bookingMail, textBody, recipient } from "./mail-contracts.mjs";

export async function guestJourney({data,call,state,deliver,future,checks}) {
  const event=await data('/api/app/event-types',{slug:'synthetic-dial-guests',title:'Guest consultation',description:'A synthetic guest booking.',durationMinutes:30,color:'#176b5a',locationType:'fixed_link',locationLabel:'Meeting room',locationValue:'https://meet.example.test/guest-room',listed:true,alternativeRequestsEnabled:false,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:600,endMinute:1200}))},201);
  assert.deepEqual(await data(`/api/app/event-types/${event.id}/guests`),{guestLimit:0},'guests default off');
  await call(`/api/app/event-types/${event.id}/guests`,{guestLimit:21},400,'PUT');
  await data(`/api/app/event-types/${event.id}/guests`,{guestLimit:2},200,'PUT');
  const copy=await data(`/api/app/event-types/${event.id}/duplicate`,{},201);
  assert.deepEqual(await data(`/api/app/event-types/${copy.id}/guests`),{guestLimit:2},'duplicating preserves the host guest setting');
  await data(`/api/app/event-types/${event.id}/publish`,{});
  const base=`/api/public/book/dial-host/${event.slug}`;
  const slot=(await data(`${base}/availability?week=${future}`)).slots[0];assert.ok(slot);
  const selection=await data(`${base}/selection`,{startAt:slot.startAt,inviteeTimezone:'UTC'},201);
  const query=new URLSearchParams({nonce:selection.nonce,startAt:slot.startAt,inviteeTimezone:'UTC'});
  assert.equal((await data(`${base}/selection?${query}`)).guestLimit,2);
  const guests=['synthetic-dial-1@example.test','synthetic-dial-2@example.test'];
  const payload={nonce:selection.nonce,startAt:slot.startAt,inviteeTimezone:'UTC',name:'Synthetic Dial Invitee',email:'synthetic-dial-0@example.test',answers:{},guests};
  for(const invalid of [[...guests,'synthetic-dial-3@example.test'],[guests[0],guests[0].toUpperCase()],[payload.email],['invalid']])await call(`${base}/confirm`,{...payload,guests:invalid},400);
  const confirmed=await data(`${base}/confirm`,payload,201);const token=new URL(confirmed.manageUrl).pathname.split('/').at(-1);
  assert.deepEqual(confirmed.guests,guests);assert.equal(confirmed.guestLimit,2);
  await call(`${base}/confirm`,payload,200);await call(`${base}/confirm`,{...payload,guests:[]},409);
  await deliver();await deliver();
  let snap=await state();const booking=snap.bookings.find(row=>row.invitee_email===payload.email);assert.ok(booking);
  const calendar=JSON.parse(snap.wire_events.find(row=>row.id===booking.calendar_provider_event_id).payload);
  assert.deepEqual(calendar.attendees.map(row=>row.email).sort(),[payload.email,...guests].sort(),'destination calendar invites the invitee and both guests');
  assert.ok(!calendar.description.includes('/manage/'),'provider invitation does not expose manage capability to guests');
  const mail=bookingMail(snap,booking.id);
  for(const email of guests){const guestMail=mail.filter(row=>recipient(row).includes(email));assert.equal(guestMail.length,1,'exactly one guest confirmation');assert.ok(textBody(guestMail[0]).includes('Guest invitation confirmed'));assert.ok(!JSON.stringify(guestMail).includes(token)&&!JSON.stringify(guestMail).includes('/manage/'),'guest mail has no manage link');}
  const allowed=new Set([payload.email,...guests,...snap.delivery_outbox.filter(row=>row.booking_id===booking.id&&JSON.parse(row.payload_json).recipientRole==='operator').map(row=>JSON.parse(row.payload_json).to)]);
  assert.ok(mail.every(row=>recipient(row).every(email=>allowed.has(email))),'no extra recipient receives the booking');
  await call(`/api/public/manage/${guests[0]}`,undefined,404);
  await call(`/api/public/manage/${guests[0]}/guests`,{guests:[]},404,'PUT');
  await data(`/api/public/manage/${token}/guests`,{guests:[guests[1]]},200,'PUT');
  await data(`/api/public/manage/${token}/guests`,{guests:[guests[1]]},200,'PUT');
  await deliver();await deliver();snap=await state();
  const removed=bookingMail(snap,booking.id).filter(row=>recipient(row).includes(guests[0])&&textBody(row).includes('Guest invitation cancelled'));
  assert.equal(removed.length,1,'removing a guest sends one cancellation on retry');
  assert.deepEqual(JSON.parse(snap.wire_events.find(row=>row.id===booking.calendar_provider_event_id).payload).attendees.map(row=>row.email).sort(),[payload.email,guests[1]].sort(),'calendar attendee is removed in place');
  assert.deepEqual((await data(`/api/public/manage/${token}`)).guests,[guests[1]]);
  await data(`/api/public/manage/${token}/guests`,{guests:[]},200,'PUT');await deliver();snap=await state();
  assert.ok(!JSON.parse(snap.wire_events.find(row=>row.id===booking.calendar_provider_event_id).payload).description.includes('/manage/'),'removing the last guest never reintroduces a capability into the provider cancellation');
  await data(`/api/public/manage/${token}/guests`,{guests:[guests[1]]},200,'PUT');await deliver();
  // Erasing a guest removes the guest row and their notices without deleting the invitee's booking or control guest.
  const preview=await data('/api/app/privacy/preview',{email:guests[1]});
  await data('/api/app/privacy/erase',{email:guests[1],confirmation:preview.confirmation,expiresAt:preview.expiresAt});
  snap=await state();assert.ok(snap.bookings.some(row=>row.id===booking.id),'guest erasure preserves the invitee booking');
  assert.equal(snap.booking_guests.filter(row=>row.email===guests[1]).length,0);
  assert.ok(!JSON.stringify(snap.delivery_outbox).includes(guests[1]),'guest erasure deletes recipient notices');
  const control=await data(`/api/public/manage/${token}/guests`,{guests:['synthetic-dial-4@example.test']},200,'PUT');assert.deepEqual(control.guests,['synthetic-dial-4@example.test']);
  await call(`/api/public/manage/${token}/cancel`,{});await deliver();await deliver();snap=await state();
  assert.equal(bookingMail(snap,booking.id).filter(row=>recipient(row).includes('synthetic-dial-4@example.test')&&textBody(row).includes('Guest invitation cancelled')).length,1,'a booking cancellation notifies its remaining guest once');
  checks.push('EVENT-009 guests default off, obey the configured maximum, receive one calendar invitation and capability-free confirmation each; manage add/remove patches attendees and sends one removal cancellation on retry; guest address grants no manage access; guest erasure preserves the invitee booking and clears guest rows and notices; booking cancellation notifies remaining guests once');
}
