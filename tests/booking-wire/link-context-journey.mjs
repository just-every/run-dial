import assert from 'node:assert/strict';
import {bookingMail, textBody, recipient} from './mail-contracts.mjs';

export async function linkContextJourney({data,call,state,deliver,future,checks}) {
 const event=await data('/api/app/event-types',{
  slug:'campaign-consultation',title:'Campaign consultation',description:'Plan your next launch.',durationMinutes:30,color:'#176b5a',
  locationType:'fixed_link',locationLabel:'Video call',locationValue:'https://meet.example.test/launch',listed:true,
  alternativeRequestsEnabled:true,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,
  questions:[{kind:'text',key:'q_campaign_goal_2026',label:'Campaign goal',required:true,options:[]},{kind:'text',key:'q_private_note_2026',label:'Private note',required:false,private:true,options:[]}],
  postBookingRedirect:{url:'https://studio.example.test/thank-you?campaign=launch',fields:['event','start_time','end_time','timezone','host','name','email','booking_reference','answer.q_campaign_goal_2026','utm_source','source']},
  availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:780,endMinute:960})),
 },201);
 const details={...event,availability:undefined,alternativeRequestsEnabled:undefined};
 const refusal=await call(`/api/app/event-types/${event.id}/details`,{...details,postBookingRedirect:{url:'http://studio.example.test/thank-you',fields:[]}},400,'PATCH');
 assert.ok((await refusal.text()).includes('postBookingRedirect'));
 await call(`/api/app/event-types/${event.id}/details`,{...details,postBookingRedirect:{url:'https://studio.example.test/thank-you?nonce=unsafe',fields:[]}},400,'PATCH');
 await call(`/api/app/event-types/${event.id}/details`,{...details,postBookingRedirect:{...event.postBookingRedirect,fields:['answer.q_private_note_2026']}},400,'PATCH');
 await data(`/api/app/event-types/${event.id}/publish`,{});
 const base=`/api/public/book/dial-host/${event.slug}`;
 const slot=(await data(`${base}/availability?week=${future}`)).slots[0];
 const selection=await data(`${base}/selection`,{startAt:slot.startAt,inviteeTimezone:'America/New_York'},201);
 const payload={nonce:selection.nonce,startAt:slot.startAt,inviteeTimezone:'America/New_York',name:'Alex Rivera',email:'edited-campaign@dial.test',answers:{q_campaign_goal_2026:'Launch <new> product',q_private_note_2026:'Confidential target'},attribution:{utm_source:'ads',utm_medium:'paid search',utm_campaign:'autumn',source:'landing-hero'}};
 await call(`${base}/confirm`,{...payload,attribution:{...payload.attribution,manage_token:'forbidden'}},400);
 const confirmed=await data(`${base}/confirm`,payload,201);
 const target=new URL(confirmed.postBookingRedirectUrl);
 assert.equal(target.origin,'https://studio.example.test');assert.equal(target.searchParams.get('event'),event.title);
 assert.equal(Date.parse(target.searchParams.get('start_time')),Date.parse(slot.startAt));assert.match(target.searchParams.get('start_time'),/[+-]\d{2}:\d{2}$/);
 assert.equal(Date.parse(target.searchParams.get('end_time')),Date.parse(slot.endAt));
 assert.equal(target.searchParams.get('name'),payload.name);assert.equal(target.searchParams.get('email'),payload.email);
 assert.equal(target.searchParams.get('utm_source'),'ads');assert.equal(target.searchParams.get('source'),'landing-hero');
 assert.equal(target.searchParams.get('answer.q_campaign_goal_2026'),payload.answers.q_campaign_goal_2026);
 assert.equal(target.searchParams.get('booking_reference'),confirmed.bookingReference);
 assert.ok(!confirmed.postBookingRedirectUrl.includes(payload.nonce));assert.ok(!confirmed.postBookingRedirectUrl.includes('Confidential'));
 assert.ok(!target.searchParams.has('token'));assert.ok(!target.searchParams.has('answer.q_private_note_2026'));
 await data(`/api/app/event-types/${event.id}/details`,{...details,postBookingRedirect:null},200,'PATCH');
 assert.equal((await data(`${base}/confirm`,payload)).postBookingRedirectUrl,confirmed.postBookingRedirectUrl,'replay uses committed redirect after settings change');
 await call(`${base}/confirm`,{...payload,attribution:{...payload.attribution,utm_source:'changed'}},409);
 await deliver();
 const snapshot=await state(), booking=snapshot.bookings.find(row=>row.invitee_email===payload.email);
 assert.equal(confirmed.bookingReference,booking.id);assert.deepEqual(JSON.parse(booking.attribution_json),payload.attribution);
 const operator=await data(`/api/app/bookings/${booking.id}`);assert.deepEqual(operator.attribution,payload.attribution);
 const notices=bookingMail(snapshot,booking.id).filter(mail=>recipient(mail).includes(payload.email)&&mail.subject.startsWith('Confirmed:'));
 assert.equal(notices.length,1);assert.ok(textBody(notices[0]).includes(confirmed.manageUrl));
 const token=new URL(confirmed.manageUrl).pathname.split('/').at(-1);
 assert.equal((await data(`/api/public/manage/${token}`)).postBookingRedirectUrl,undefined);
 await data(`/api/app/event-types/${event.id}/details`,details,200,'PATCH');
 const replacement=(await data(`${base}/availability?week=${future}`)).slots[0];
 const next=await data(`/api/public/manage/${token}/reschedule/selection`,{startAt:replacement.startAt,inviteeTimezone:'America/New_York'},201);
 const moved=await data(`/api/public/manage/${token}/reschedule`,{nonce:next.nonce,startAt:replacement.startAt,inviteeTimezone:'America/New_York'});
 assert.equal(moved.postBookingRedirectUrl,undefined);assert.deepEqual((await data(`/api/app/bookings/${booking.id}`)).attribution,payload.attribution);
 const copy=await data(`/api/app/event-types/${event.id}/duplicate`,{},201);assert.equal(copy.questions.find(question=>question.key==='q_private_note_2026').private,true);
 await data(`/api/app/event-types/${event.id}/details`,{...details,postBookingRedirect:null},200,'PATCH');
 const plainSlot=(await data(`${base}/availability?week=${future}`)).slots[0];const plainNonce=await data(`${base}/selection`,{startAt:plainSlot.startAt,inviteeTimezone:'UTC'},201);
 const plain=await data(`${base}/confirm`,{...payload,nonce:plainNonce.nonce,startAt:plainSlot.startAt,inviteeTimezone:'UTC',email:'plain-campaign@dial.test'},201);
 assert.equal(plain.postBookingRedirectUrl,undefined);
 await data(`/api/app/event-types/${event.id}/details`,{...details,questions:details.questions.map(question=>({...question,private:true})),postBookingRedirect:null},200,'PATCH');
 checks.push('LINK-003: committed editable identity and bounded attribution retained; BOOK-013: HTTPS named projection excludes private answers/capabilities, replay survives edits, email keeps manage link, receipt and manage mutations never redirect');
}
