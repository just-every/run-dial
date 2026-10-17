import assert from 'node:assert/strict';

export async function offeredTimesJourney({data,call,future,checks}) {
  const event=await data('/api/app/event-types',{slug:'offered-times',title:'Planning conversation',description:'Choose one of the times we discussed.',durationMinutes:30,color:'#176b5a',locationType:'fixed_link',locationLabel:'Video call',locationValue:'https://meeting.example.test/planning',listed:true,alternativeRequestsEnabled:false,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:1080,endMinute:1380}))},201);
  await data(`/api/app/event-types/${event.id}/publish`,{});
  const base=`/api/public/book/dial-host/${event.slug}`;
  const available=()=>data(`${base}/availability?week=${future}`);
  const slots=(await available()).slots.slice(0,4);assert.equal(slots.length,4);
  const create=(offeredStarts,holdHours=48)=>data('/api/app/booking-links',{eventTypeId:event.id,kind:'single_use',offeredStarts,holdHours,expiresAt:new Date(Date.now()+4*86400000).toISOString()},201);
  const offer=await create(slots.slice(0,3).map(s=>s.startAt)),link=new URL(offer.url).searchParams.get('link');
  const held=(await available()).slots;for(const slot of slots.slice(0,3)) assert.ok(!held.some(s=>s.startAt===slot.startAt),'offered holds leave ordinary availability');
  assert.ok(held.some(s=>s.startAt===slots[3].startAt));
  const offered=await data(`${base}/availability?link=${link}`);assert.deepEqual(offered.slots.map(s=>s.startAt),slots.slice(0,3).map(s=>s.startAt));
  await call(`${base}/selection`,{startAt:slots[0].startAt,inviteeTimezone:'UTC'},409);
  const selection=await data(`${base}/selection`,{link,startAt:slots[0].startAt,inviteeTimezone:'UTC'},201);
  const receipt=await data(`${base}/confirm`,{link,nonce:selection.nonce,startAt:slots[0].startAt,inviteeTimezone:'UTC',name:'Taylor Morgan',email:'taylor-offer@dial.test',answers:{}},201);
  assert.ok(receipt.manageUrl);
  const released=(await available()).slots;for(const slot of slots.slice(1,3)) assert.ok(released.some(s=>s.startAt===slot.startAt),'unselected holds release with the claim');
  assert.deepEqual(await data(`/api/public/events/dial-host/${event.slug}?link=${link}`),{linkState:'used'});
  const unheld=await create([slots[3].startAt],0), unheldToken=new URL(unheld.url).searchParams.get('link');
  assert.ok((await available()).slots.some(s=>s.startAt===slots[3].startAt));
  const unheldSelection=await data(`${base}/selection`,{link:unheldToken,startAt:slots[3].startAt,inviteeTimezone:'UTC'},201);
  const ordinarySelection=await data(`${base}/selection`,{startAt:slots[3].startAt,inviteeTimezone:'UTC'},201);
  await data(`${base}/confirm`,{nonce:ordinarySelection.nonce,startAt:slots[3].startAt,inviteeTimezone:'UTC',name:'Another invitee',email:'taken-offer@dial.test',answers:{}},201);
  await call(`${base}/confirm`,{link:unheldToken,nonce:unheldSelection.nonce,startAt:slots[3].startAt,inviteeTimezone:'UTC',name:'Late invitee',email:'late-offer@dial.test',answers:{}},409);
  const revoked=await create([slots[1].startAt]);await data(`/api/app/booking-links/${revoked.id}/revoke`,{});
  assert.ok((await available()).slots.some(s=>s.startAt===slots[1].startAt));
  const expired=await create([slots[1].startAt]);await call('/__fixtures/expire-link',{id:expired.id},204);
  assert.ok((await available()).slots.some(s=>s.startAt===slots[1].startAt));
  // Two claims for an identical held offer cannot both reserve the slot.
  const payload={eventTypeId:event.id,kind:'single_use',offeredStarts:[slots[1].startAt],holdHours:48,expiresAt:new Date(Date.now()+86400000).toISOString()};
  const responses=await Promise.all([call('/api/app/booking-links',payload,[201,409]),call('/api/app/booking-links',payload,[201,409])]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const list=await data('/api/app/booking-links');assert.equal(list.filter(r=>r.offeredStarts?.includes(slots[1].startAt)&&r.state==='active').length,1);
  checks.push('LINK-002: exact live offered times, private selection, held and unheld behavior, one booking releases alternatives, final stale-time refusal, expiry/revocation and competing hold creation');
}
