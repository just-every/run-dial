import assert from 'node:assert/strict';
// After approval, the request link reads the booking only while the booking's own manage link is live.
export async function approvalAccessJourney({data,call,state,future,checks}){
  const event=await data('/api/app/event-types',{slug:'synthetic-dial-approval-access',title:'Approval access consultation',description:'A synthetic approval request.',durationMinutes:30,color:'#176b5a',locationType:'fixed_link',locationLabel:'Meeting room',locationValue:'https://meet.example.test/approval-access-room',listed:true,alternativeRequestsEnabled:false,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:600,endMinute:1200}))},201);
  await data(`/api/app/event-types/${event.id}/approval`,{required:true,windowHours:24},200,'PUT');
  await data(`/api/app/event-types/${event.id}/publish`,{});
  const base=`/api/public/book/dial-host/${event.slug}`;
  const approved=async email=>{
    const startAt=(await data(`${base}/availability?week=${future}`)).slots[0].startAt;
    const selection=await data(`${base}/selection`,{startAt,inviteeTimezone:'UTC'},201);
    const step=await data(`${base}/confirm`,{nonce:selection.nonce,startAt,inviteeTimezone:'UTC',name:'Synthetic Dial Approval Access',email,answers:{}},202);
    const request=(await state()).booking_approval_requests.find(row=>row.invitee_email===email);
    await data(`/api/app/booking-approvals/${request.id}/decision`,{decision:'approve'});
    const link=`/api/public/manage/${new URL(step.approval.url).pathname.split('/').at(-1)}`;
    assert.equal((await data(link)).state,'confirmed','an approved request link opens the confirmed booking');
    return {bookingId:request.booking_id,link};
  };
  const closed=async(link,label)=>{
    const response=await call(link,undefined,410),body=await response.text();
    assert.equal(JSON.parse(body).error.code,'manage_token_expired',label);
    assert.ok(!body.includes('example.test'),`${label}: no location or invitee details`);
  };
  const rotated=await approved('synthetic-dial-approval-access-1@example.test');
  const replacement=await data(`/api/app/bookings/${rotated.bookingId}/manage-link/rotate`,{});
  await closed(rotated.link,'a replaced manage link also closes the request link');
  assert.equal((await data(new URL(replacement.manageUrl).pathname.replace(/^\/manage\//u,'/api/public/manage/'))).state,'confirmed','the replacement manage link opens the booking');
  const lapsed=await approved('synthetic-dial-approval-access-2@example.test');
  await call('/__fixtures/manage-expiry',{id:lapsed.bookingId},204);
  await closed(lapsed.link,'an expired manage link also closes the request link');
  checks.push('approved request links answer 410 with no booking details once the booking manage link is replaced or expired; the replacement manage link still opens the booking');
}
