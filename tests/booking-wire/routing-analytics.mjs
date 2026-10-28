import assert from 'node:assert/strict';

export const routingClickIds={gclid:'synthetic-dial-routing-google',li_fat_id:'synthetic-dial-routing-linkedin'};
const google={accessToken:'synthetic-dial-900',developerToken:'synthetic-dial-902',customerId:'1234567890',conversionAction:'customers/1234567890/conversionActions/900'};
const linkedin={accessToken:'synthetic-dial-901',conversionId:'901'};

export async function connectRoutingAnalytics(data) {
 await data('/api/app/analytics/connections/google_ads',google,200,'PUT');
 await data('/api/app/analytics/connections/linkedin',linkedin,200,'PUT');
 const connections=await data('/api/app/analytics/connections');
 assert.equal(connections.google_ads.connected,true);assert.equal(connections.linkedin.connected,true);
}

export async function proveRoutingUploads({data,deliver,bookingReference,excluded}) {
 const snapshot=()=>data('/__fixtures/analytics/state');
 const before=await snapshot(),jobs=before.analytics_deliveries.filter(row=>row.booking_id===bookingReference);
 assert.equal(jobs.length,2,'routing handoff and confirmation replay enqueue one conversion per provider');
 await deliver();await deliver();
 const after=await snapshot();
 for(const job of jobs) {
  const uploads=after.uploads.filter(row=>row.provider===job.provider&&row.event_id===job.event_id);
  assert.equal(uploads.length,1,'each routed booking uploads one conversion per provider');
  const body=JSON.parse(uploads[0].body);
  if(job.provider==='google_ads')assert.deepEqual(body,{partialFailure:true,conversions:[{gclid:routingClickIds.gclid,conversionAction:google.conversionAction,conversionDateTime:job.confirmed_at.slice(0,19).replace('T',' ')+'+00:00',orderId:job.event_id}]});
  else assert.deepEqual(body,{conversion:`urn:lla:llaPartnerConversion:${linkedin.conversionId}`,conversionHappenedAt:Date.parse(job.confirmed_at),eventId:job.event_id,user:{userIds:[{idType:'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID',idValue:routingClickIds.li_fat_id}]}});
  const requests=after.requests.filter(row=>row.provider===job.provider&&JSON.stringify(JSON.parse(row.body)).includes(job.event_id));
  assert.equal(requests.length,1,'confirmation replay makes one advertising request per provider');
  for(const request of requests)for(const value of [...excluded,'answers','invitee'])assert.ok(!request.body.includes(value),'routing advertising requests contain no answers, person details or capabilities');
  await data('/__fixtures/deliver',{id:job.id,channel:'analytics'});
 }
 const replayed=await snapshot();assert.equal(replayed.requests.length,after.requests.length);assert.equal(replayed.uploads.length,after.uploads.length);
}

export async function pendingRoutingJobs(data,bookingReference) {
 const jobs=(await data('/__fixtures/analytics/state')).analytics_deliveries.filter(row=>row.booking_id===bookingReference);
 assert.equal(jobs.length,2);assert.ok(jobs.every(row=>row.state==='pending'),'edited booking keeps pending click conversions before source erasure');
 return jobs;
}

export async function proveRoutingAnalyticsErased(data,bookingReferences,jobs) {
 const after=await data('/__fixtures/analytics/state');
 assert.ok(after.analytics_deliveries.every(row=>!bookingReferences.includes(row.booking_id)),'erasing the original routing identity removes its stored analytics jobs from retained edited bookings');
 for(const job of jobs)await data('/__fixtures/deliver',{id:job.id,channel:'analytics'});
 assert.equal((await data('/__fixtures/analytics/state')).requests.length,after.requests.length,'replaying erased pending jobs cannot send the routing click IDs');
}
