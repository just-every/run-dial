import { savedUploader } from './upload.mjs';
import assert from 'node:assert/strict';
import { confirmAuthLink } from '../auth-client.mjs';
import { runtime, saved, instant } from './runtime.mjs';
import { refreshManifest } from './capacity.mjs';
import { assertImportedHistory, assertFreshReimport } from './history.mjs';

export async function equalOperatorReplay({complete,databaseSnapshot,ownedRows}){
 let invitation;
 const rt=await runtime({onMail:mail=>{
  const content=mail.content.map(part=>part.value).join('\n');
  invitation=content.match(/https?:[^\s"<>]+\/auth\/confirm\?token=[^\s"<>]+/)?.[0]?.replaceAll('&amp;','&');
 }});
 try{
  const invited=await rt.api('/api/app/operators',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'second-operator@example.test'})});
  assert.equal(invited.status,201);assert.equal((await invited.json()).invitation,'queued');assert.ok(invitation,'Invitation reached paid mail edge');
  const signed=await confirmAuthLink(invitation);assert.equal(signed.status,303);invitation=undefined;
  const cookie=signed.headers.get('set-cookie').split(';')[0];
  const api=(path,init={})=>rt.api(path,{...init,headers:{cookie,...init.headers}});
  const secondSession=await api('/auth/session');assert.equal(secondSession.status,200);const second=await secondSession.json();
  const upload=savedUploader(api,instant);
  const data=async response=>{assert.equal(response.status,200,'Native import response');return response.json();};
  const files=await saved('solo'),preview=await data(await rt.upload('preview',files));
  const secondReview=await data(await upload('preview',files));
  let applied=await data(await rt.upload('apply',files,{fingerprint:preview.report.fingerprint,acknowledged:true}));
  const changed=files.map(file=>({...file,bytes:Buffer.from(file.bytes)}));
  const eventFile=changed.find(file=>file.name==='event_types-1.json'),events=JSON.parse(eventFile.bytes);events.collection[0].name+=' changed';eventFile.bytes=Buffer.from(JSON.stringify(events));refreshManifest(changed);
  const owned=async()=>{
   assert.equal((await upload('preview',files,{uploadIdentity:preview.uploadIdentity})).status,400,'An upload identity cannot cross operator ownership');
   assert.deepEqual((await data(await api('/api/app/move-in/jobs'))).jobs,[]);
   for(const suffix of ['', '/resume','/undo'])assert.equal((await api(`/api/app/move-in/jobs/${applied.job.id}${suffix}`,suffix?{method:'POST'}:{})).status,400);
   assert.equal((await rt.api(`/api/app/move-in/jobs/${applied.job.id}`,{headers:{cookie:''}})).status,401);
   // The custody diagnostic uses the same native kit ownership binding.
   assert.ok((await api(`/__fixtures/import-custody/${applied.job.id}`)).status>=400);
  };
  // While the original job is unfinished, no second saved copy can start.
  const refused=async()=>{
   const before=await databaseSnapshot(rt);
   for(const source of [files,changed])for(const action of ['preview','apply']){
    const response=await upload(action,source,{fingerprint:secondReview.report.fingerprint,acknowledged:true,...(action==='apply'?{uploadIdentity:secondReview.uploadIdentity}:{})});assert.equal(response.status,400);
    const body=await response.json();assert.match(body.error.message,/already saved|retained|Upload review expired or changed/i);
    assert.ok(!JSON.stringify(body).includes(applied.job.id),'Refusal does not expose another operator job');
   }
   for(const action of ['preview','apply'])assert.equal((await rt.upload(action,changed,{fingerprint:preview.report.fingerprint,acknowledged:true})).status,400);
   await owned();
   assert.deepEqual(await databaseSnapshot(rt),before,'Refusals preserve all native rows and private originals/jobs');
  };
  // Once it is applied, the same account's files are a catch-up: every saved record is already here, nothing is saved again.
  const caughtUp=async()=>{
   const before=await databaseSnapshot(rt);
   for(const [operator,source] of [[upload,files],[upload,changed],[rt.upload,changed]]){
    const response=await operator('preview',source);assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.report.mode,'catch-up');assert.deepEqual(body.report.alreadyHere,{profile:1,eventTypes:4,bookings:13});
    assert.equal(body.report.counts.eventTypes.read,0,'the changed event name is not re-imported');assert.ok(body.report.differences.every(item=>item.kind==='unchanged'));
    assert.ok(!JSON.stringify(body).includes(applied.job.id),'A catch-up does not expose another operator job');
   }
   await owned();
   assert.deepEqual(await databaseSnapshot(rt),before,'Catch-up previews write nothing');
  };
  await refused();
  await rt.restart();applied=await complete(rt,applied);await caughtUp();
  await assertImportedHistory(rt,files,instant);
  const native=await ownedRows(rt),calls=rt.calls.length;
  applied=await complete(rt,await data(await rt.api(`/api/app/move-in/jobs/${applied.job.id}/undo`,{method:'POST'})));
  assert.ok(applied.undo.dispositions.every(item=>item.disposition==='reversed'));
  const fresh=await data(await upload('preview',files));
  let replacement=await data(await upload('apply',files,{fingerprint:fresh.report.fingerprint,acknowledged:true}));
  await rt.restart();replacement=await complete({...rt,api},replacement);assert.equal(replacement.job.state,'completed');
  // A different authenticated importer owns the replacement creation; all
  // source/native values apart from the actor and fresh capabilities are equal.
  assertFreshReimport(await ownedRows(rt),{...native,booking_history:native.booking_history.map(row=>({...row,actor_id:second.operator.id}))});
  await assertImportedHistory({...rt,api},files,instant,second.operator.id);
  const booking=(await data(await api('/api/app/bookings'))).find(row=>row.imported);
  assert.equal((await api(`/api/app/bookings/${booking.id}/cancel`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:'Retain owner change'})})).status,200);
  replacement=await complete({...rt,api},await data(await api(`/api/app/move-in/jobs/${replacement.job.id}/undo`,{method:'POST'})));
  assert.ok(replacement.undo.dispositions.some(item=>item.disposition==='retained'));
  const retained=await databaseSnapshot(rt);
  for(const action of ['preview','apply'])assert.equal((await rt.upload(action,files,{fingerprint:preview.report.fingerprint,acknowledged:true})).status,400);
  assert.deepEqual(await databaseSnapshot(rt),retained);assert.equal(rt.calls.length,calls,'Import/undo/replay makes no provider requests');
 }finally{await rt.close();}
}
