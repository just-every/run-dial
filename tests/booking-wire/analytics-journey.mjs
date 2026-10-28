import assert from "node:assert/strict";

export async function analyticsJourney({data,call,deliver,future,checks}) {
  const snapshot=()=>data("/__fixtures/analytics/state");
  const control=(name,value)=>call("/__fixtures/analytics/control",{name,value},204);
  const due=id=>call("/__fixtures/analytics/due",{id},204);
  const settings={ga4MeasurementId:"G-SYNTHETIC900",gtmContainerId:"GTM-SYNTHETIC900",metaPixelId:"900",googleAds:{conversionId:"AW-900",conversionLabel:"synthetic-dial-904"},linkedInPartnerId:"901"};
  assert.deepEqual(await data("/api/public/analytics"),{});
  const anonymous=await fetch(process.env.DIAL_REVIEW_ORIGIN+"/api/app/analytics",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(settings)});
  assert.equal(anonymous.status,401);
  assert.deepEqual(await data("/api/public/analytics"),{},"anonymous configuration cannot activate tracking");
  await data("/api/app/analytics",settings,200,"PUT");
  assert.deepEqual(await data("/api/public/analytics"),settings);
  await call("/api/app/analytics",{ga4MeasurementId:"https://example.test/script.js"},400,"PUT");
  assert.deepEqual(await data("/api/public/analytics"),settings,"invalid tag cannot replace saved configuration");
  const google={accessToken:"synthetic-dial-900",developerToken:"synthetic-dial-902",customerId:"1234567890",conversionAction:["customers","1234567890","conversionActions","900"].join("/")};
  const linkedin={accessToken:"synthetic-dial-901",conversionId:"901"};
  const connect=async()=>{await data("/api/app/analytics/connections/google_ads",google,200,"PUT");await data("/api/app/analytics/connections/linkedin",linkedin,200,"PUT");};
  await connect();
  const connectionView=await data("/api/app/analytics/connections");
  assert.equal(connectionView.google_ads.connected,true);assert.equal(connectionView.linkedin.connected,true);
  for(const secret of [google.accessToken,google.developerToken,linkedin.accessToken]) {
    assert.ok(!JSON.stringify(connectionView).includes(secret));
    assert.ok(!JSON.stringify((await snapshot()).analytics_connections).includes(secret),"connection credentials are encrypted at rest");
    assert.ok(!JSON.stringify(await data("/api/public/analytics")).includes(secret));
  }
  const event=await data("/api/app/event-types",{slug:"synthetic-dial-analytics",title:"Growth consultation",description:"Plan a launch with your advisor.",durationMinutes:30,color:"#176b5a",locationType:"fixed_link",locationLabel:"Video room",locationValue:"https://example.test/room",listed:true,alternativeRequestsEnabled:false,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[{kind:"text",key:"q_0000000900",label:"Private campaign plan",required:true,private:true,options:[]}],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:0,endMinute:1440}))},201);
  await data(`/api/app/event-types/${event.id}/publish`,{});
  const base=`/api/public/book/dial-host/${event.slug}`;
  async function book(n,extra={}) {
    const slot=(await data(`${base}/availability?week=${future}`)).slots[0];assert.ok(slot);
    const selected=await data(`${base}/selection`,{startAt:slot.startAt,inviteeTimezone:"UTC"},201);
    const payload={nonce:selected.nonce,startAt:slot.startAt,inviteeTimezone:"UTC",name:`Synthetic Dial ${n}`,email:[`synthetic-dial-${n}`,"example.test"].join("@"),answers:{q_0000000900:"synthetic-dial-private-900"},clickIds:{gclid:`synthetic-dial-google-${n}`,li_fat_id:`synthetic-dial-linkedin-${n}`},...extra};
    const confirmed=await data(`${base}/confirm`,payload,201);
    await data(`${base}/confirm`,payload);
    return {confirmed,payload};
  }
  await control("google_ads-failure","lost");await control("linkedin-failure","429");
  const first=await book(910);await deliver();
  let snap=await snapshot();
  const jobs=snap.analytics_deliveries.filter(row=>row.booking_id===first.confirmed.bookingReference);
  assert.equal(jobs.length,2,"one initial conversion job per provider despite confirmation replay");
  for(const job of jobs) await due(job.id);
  await deliver();await deliver();snap=await snapshot();
  assert.equal(snap.uploads.length,2,"response loss and throttling still create one remote conversion per provider");
  const googleUpload=JSON.parse(snap.uploads.find(row=>row.provider==="google_ads").body),linkedinUpload=JSON.parse(snap.uploads.find(row=>row.provider==="linkedin").body);
  assert.equal(googleUpload.conversions.length,1);
  assert.equal(googleUpload.conversions[0].gclid,first.payload.clickIds.gclid);
  assert.equal(googleUpload.conversions[0].conversionAction,google.conversionAction);
  assert.ok(googleUpload.conversions[0].orderId);
  assert.equal(linkedinUpload.conversion,`urn:lla:llaPartnerConversion:${linkedin.conversionId}`);
  assert.deepEqual(linkedinUpload.user.userIds,[{idType:"LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID",idValue:first.payload.clickIds.li_fat_id}]);
  assert.ok(linkedinUpload.eventId);assert.ok(linkedinUpload.conversionHappenedAt);
  assert.ok(snap.requests.length>=2,"both provider request captures are present");
  for(const row of snap.requests) {
    const value=JSON.stringify(row);
    for(const excluded of [first.payload.name,first.payload.email,first.payload.answers.q_0000000900,first.payload.nonce,"answers","invitee"]) assert.ok(!value.includes(excluded),"advertising request excludes invitee data and answers");
  }
  for(const job of jobs) await data("/__fixtures/deliver",{id:job.id,channel:"analytics"});
  assert.equal((await snapshot()).requests.length,snap.requests.length,"completed job replay makes no duplicate HTTP upload");
  const token=new URL(first.confirmed.manageUrl).pathname.split("/").at(-1);
  const next=(await data(`/api/public/manage/${token}/reschedule/availability?week=${future}`)).slots[0];
  const selection=await data(`/api/public/manage/${token}/reschedule/selection`,{startAt:next.startAt,inviteeTimezone:"UTC"},201);
  await data(`/api/public/manage/${token}/reschedule`,{nonce:selection.nonce,startAt:next.startAt,inviteeTimezone:"UTC"});await deliver();
  assert.equal((await snapshot()).uploads.length,2,"rescheduling does not create another initial conversion");
  await book(911,{clickIds:{}});await book(912,{embedded:true});await deliver();
  assert.equal((await snapshot()).uploads.length,2,"missing click IDs and embeds never upload a conversion");
  await control("google_ads-failure","401");await control("linkedin-failure","401");
  const revoked=await book(913);await deliver();snap=await snapshot();
  const revokedJobs=snap.analytics_deliveries.filter(row=>row.booking_id===revoked.confirmed.bookingReference);assert.equal(revokedJobs.length,2);
  assert.ok(revokedJobs.every(row=>row.state==="failed"));
  assert.equal((await data("/api/app/analytics/connections")).google_ads.connected,false,"provider revocation disables the credential");
  await connect();await control("google_ads-failure","429");await control("linkedin-failure","429");
  const pending=await book(914);await deliver();snap=await snapshot();
  const pendingJobs=snap.analytics_deliveries.filter(row=>row.booking_id===pending.confirmed.bookingReference);assert.equal(pendingJobs.length,2);
  const beforeDisconnect=snap.requests.length;
  await call("/api/app/analytics/connections/google_ads",undefined,200,"DELETE");await call("/api/app/analytics/connections/linkedin",undefined,200,"DELETE");
  for(const job of pendingJobs) await data("/__fixtures/deliver",{id:job.id,channel:"analytics"});
  assert.equal((await snapshot()).requests.length,beforeDisconnect,"disconnected queued jobs cannot use removed credentials");
  await connect();await control("google_ads-failure","429");await control("linkedin-failure","429");
  const erased=await book(915);await deliver();snap=await snapshot();
  const erasedJobs=snap.analytics_deliveries.filter(row=>row.booking_id===erased.confirmed.bookingReference);assert.equal(erasedJobs.length,2);
  const preview=await data("/api/app/privacy/preview",{email:erased.payload.email});
  await data("/api/app/privacy/erase",{email:erased.payload.email,confirmation:preview.confirmation,expiresAt:preview.expiresAt});
  const afterErase=await snapshot();assert.ok(afterErase.analytics_deliveries.every(row=>row.booking_id!==erased.confirmed.bookingReference));
  for(const job of erasedJobs) await data("/__fixtures/deliver",{id:job.id,channel:"analytics"});
  assert.equal((await snapshot()).requests.length,afterErase.requests.length,"erased booking and replayed job cannot expose click context again");
  await call(`${base}/confirm`,erased.payload,[404,409,410]);
  checks.push("INTEG-006: configured identifiers only; encrypted owner connections; click-only Google and LinkedIn uploads; replay, response loss, throttle, reschedule, embed, revocation, disconnect and erasure boundaries");
}
