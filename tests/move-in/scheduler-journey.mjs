import assert from 'node:assert/strict';
import { confirmAuthLink } from '../auth-client.mjs';
import { runtime, instant } from './runtime.mjs';
import { savedUploader } from './upload.mjs';
import { schedulerCases, calCapture, savvyCapture, captureFiles, genericFiles, invitee } from './scheduler-fixtures.mjs';
import { assertReport } from './report-validator.mjs';

async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function complete(rt,current,state='completed'){for(let i=0;current.job.state!==state&&i<60;i++)current=await result(await rt.api(`/api/app/move-in/jobs/${current.job.id}/resume`,{method:'POST'}));assert.equal(current.job.state,state);return current;}
async function snapshot(rt){
 const tables=(await rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results;
 const rows={};for(const {name}of tables)rows[name]=(await rt.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results;return rows;
}
async function noEffects(rt){
 assert.deepEqual(rt.calls,[]);
 const tables=(await rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r=>r.name).filter(name=>/delivery|outbox|reminder|calendar|meeting|mail_dispatch/u.test(name));
 for(const name of tables)assert.equal((await rt.db.prepare(`SELECT count(*) AS n FROM "${name}"`).first()).n,0,`${name} stays silent`);
 assert.equal((await result(await rt.api('/__fixtures/queue-count'))).queueCalls,0);
}
export async function schedulerImports(){
 const cases=schedulerCases();assert.deepEqual(cases.map(source=>source.name),['Cal.com','SavvyCal','CSV','calendar']);
 for(const source of cases){
  const rt=await runtime();try{
   const before=await snapshot(rt),review=await result(await rt.upload('preview',source.files));assertReport(review.report);
   assert.deepEqual(await snapshot(rt),before,`${source.name} preview writes nothing`);
   assert.equal(review.report.bookingCounts.toImport,1,source.name);
   const losses=new Set(review.report.items.filter(item=>item.outcome==='skipped').map(item=>item.name));
   for(const field of source.losses)assert.ok(losses.has(field),`${source.name}: dropped ${field} is disclosed`);
   const applied=await complete(rt,await result(await rt.upload('apply',source.files,{fingerprint:review.report.fingerprint,acknowledged:true})));
   const bookings=await result(await rt.api('/api/app/bookings'));
   assert.equal(bookings.length,1);const [booking]=bookings;
   assert.equal(booking.inviteeName,'Ada Example');assert.equal(booking.inviteeEmail,invitee);assert.equal(booking.eventTitle,'Project with Ada');assert.equal(booking.imported,1);
   assert.equal(booking.occurrence.startAt,'2027-01-05T15:00:00.000Z');assert.equal(booking.occurrence.endAt,'2027-01-05T15:30:00.000Z');
   assert.equal(booking.locationValue,'Main office');
   assert.ok(booking.answers.some(answer=>answer.label==='Project goal'&&answer.value==='A new, useful\nworkspace'));
   const events=(await result(await rt.api('/api/app/event-types')));assert.equal(events.length,1);assert.equal(events[0].status,'draft');
   if(source.name!=='SavvyCal')assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM recurring_availability_windows WHERE weekday=2 AND start_minute=540 AND end_minute=1020').first()).n,1);
   await noEffects(rt);
   const repeated=await result(await rt.upload('preview',source.files));assert.equal(repeated.report.state,'already here');assert.equal((await result(await rt.upload('apply',source.files,{fingerprint:repeated.report.fingerprint,acknowledged:true}))).job.id,applied.job.id);
   const custody=await result(await rt.api(`/__fixtures/import-custody/${applied.job.id}`));
   for(const file of source.files){const original=custody.originals.find(item=>item.name===file.name);assert.ok(original);assert.equal(Buffer.from(original.original.base64,'base64').compare(file.bytes),0,'Original bytes retained exactly');}
   await complete(rt,await result(await rt.api(`/api/app/move-in/jobs/${applied.job.id}/undo`,{method:'POST'})),'undone');
   assert.deepEqual(await result(await rt.api('/api/app/bookings')),[]);assert.deepEqual(await result(await rt.api('/api/app/event-types')),[]);await noEffects(rt);
   const fresh=await result(await rt.upload('preview',source.files));const reapplied=await complete(rt,await result(await rt.upload('apply',source.files,{fingerprint:fresh.report.fingerprint,acknowledged:true})));
   const [restored]=await result(await rt.api('/api/app/bookings'));
   assert.equal((await rt.api(`/api/app/bookings/${restored.id}`,{method:'DELETE'})).status,202);
   assert.equal((await rt.upload('preview',source.files)).status,400,'Erasure fences a replay of the capture');
   const retained=await result(await rt.api(`/__fixtures/import-custody/${reapplied.job.id}`));
   assert.ok(retained.originals.length>0);assert.ok(retained.originals.every(item=>item.original.status==='unavailable'));
   assert.ok(!JSON.stringify(await snapshot(rt)).includes(invitee),'Erasure removes every retained personal copy');
   await rt.db.prepare('UPDATE oa_sessions SET revoked_at=? WHERE id=?').bind(Date.now(),rt.session).run();
   assert.equal((await rt.api(`/api/app/move-in/jobs/${reapplied.job.id}`)).status,401,'Revoked native session cannot read custody');
   assert.equal((await rt.upload('preview',source.files)).status,401,'Revoked native session cannot issue a review');
  }finally{await rt.close();}
 }
}

export async function schedulerConnections(){
 let invitation;const cal=calCapture(),savvy=savvyCapture();
 const rt=await runtime({onMail:mail=>{invitation=mail.content.map(part=>part.value).join('\n').match(/https?:[^\s"<>]+\/auth\/confirm\?token=[^\s"<>]+/)?.[0]?.replaceAll('&amp;','&');},onRequest:async request=>{
  const url=new URL(request.url);if(!['api.cal.com','api.savvycal.com'].includes(url.hostname))return;
  assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Bearer synthetic-dial-700');
  assert.ok(!url.search.includes('synthetic-dial-700'));
  if(url.hostname==='api.cal.com'){
   const body=url.pathname==='/v2/me'?{status:'success',data:cal.user}:url.pathname==='/v2/event-types'?{status:'success',data:cal.eventTypes}:url.pathname==='/v2/schedules'?{status:'success',data:cal.schedules}:{status:'success',data:cal.bookings,pagination:{hasMore:false,nextCursor:null}};
   return Response.json(body);
  }
  return Response.json(url.pathname==='/v1/me'?savvy.user:{entries:url.pathname==='/v1/links'?(url.searchParams.has('state')?[]:savvy.eventTypes):savvy.bookings,metadata:{after:null,before:null,limit:100}});
 }});
 try{
  for(const provider of ['calcom','savvycal']){
   const before=await snapshot(rt),capture=await result(await rt.api(`/api/app/move-in/connections/${provider}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'synthetic-dial-700'})}));
   assert.equal(capture.provider,provider);assert.equal(capture.bookings.length,1);assert.deepEqual(await snapshot(rt),before,'Connection captures without database writes');
   assert.equal((await rt.upload('preview',captureFiles(capture))).status,200,'Captured network responses can be reviewed');
  }
  assert.ok(!JSON.stringify(await snapshot(rt)).includes('synthetic-dial-700'),'Provider credential is not persisted');
  const email=['synthetic-dial-701','example.test'].join('@');
  await rt.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES('synthetic-dial-701',?,'Member','member','active',1,?)").bind(email,Date.now()).run();
  const signIn=async()=>{
   invitation=undefined;await result(await rt.api('/auth/magic-link',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,returnTo:'/app'})}),202);
   assert.ok(invitation,'Native sign-in reaches the paid mail edge');const signed=await confirmAuthLink(invitation);assert.equal(signed.status,303);return signed.headers.get('set-cookie').split(';')[0];
  };
  const cookie=await signIn(),api=(path,init={})=>rt.api(path,{...init,headers:{cookie,...init.headers}}),upload=savedUploader(api,instant);
  const before=await snapshot(rt),calls=rt.calls.length;
  const denied=await result(await api('/api/app/move-in/connections/calcom',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'synthetic-dial-700'})}),403);assert.equal(denied.error.code,'role_forbidden');
  const preview=await result(await upload('preview',genericFiles()),403);assert.equal(preview.error.code,'role_forbidden');assert.equal(preview.uploadIdentity,undefined);
  assert.equal(rt.calls.length,calls,'Member cannot contact a provider');assert.deepEqual(await snapshot(rt),before,'Refusals write nothing');
  await rt.db.prepare("UPDATE oa_operators SET role='admin' WHERE id='synthetic-dial-701'").run();
  const adminCookie=await signIn(),admin=(path,init={})=>rt.api(path,{...init,headers:{cookie:adminCookie,...init.headers}});
  const adminUpload=savedUploader(admin,instant),adminFiles=genericFiles(),review=await result(await adminUpload('preview',adminFiles));
  const adminApplied=await complete({api:admin},await result(await adminUpload('apply',adminFiles,{fingerprint:review.report.fingerprint,acknowledged:true})));
  assert.equal((await result(await admin('/api/app/move-in/jobs'))).jobs.length,1,'Native admin owns the completed import');
  await complete({api:admin},await result(await admin(`/api/app/move-in/jobs/${adminApplied.job.id}/undo`,{method:'POST'})),'undone');
  await rt.db.prepare("UPDATE oa_operators SET role='member' WHERE id='synthetic-dial-701'").run();
  assert.equal((await savedUploader(admin,instant)('preview',genericFiles())).status,401,'Role change invalidates prior native authority');
 }finally{await rt.close();}
}
