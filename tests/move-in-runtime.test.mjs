import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contract } from './contract.mjs';
import { assertReport } from './move-in/report-validator.mjs';
import { capacityFiles, windowFiles, overrideFiles } from './move-in/capacity.mjs';
import { runtime, saved } from './move-in/runtime.mjs';
import { equalOperatorReplay } from './move-in/equal-operators.mjs';
import { endedFiles, endedAsOf } from './move-in/ended.mjs';
import { assertImportedHistory, assertFreshReimport } from './move-in/history.mjs';
import { assertLocationChoice, locationChoices } from './move-in/locations.mjs';
async function result(response,expected=200){assert.equal(response.status,expected,'Native move-in response has unexpected status');return response.json();}
async function complete(rt,current){for(let n=0;!['completed','undone'].includes(current.job.state)&&n<60;n++)current=await result(await rt.api(`/api/app/move-in/jobs/${current.job.id}/resume`,{method:'POST'}));assert.ok(['completed','undone'].includes(current.job.state));return current;}
async function native(rt){return Object.fromEntries(await Promise.all(['host_profiles','event_types','event_questions','recurring_availability_windows','availability_date_overrides','bookings','booking_occurrences','booking_answers','booking_manage_tokens','delivery_outbox','delivery_attempts','base_mail_dispatch','rer_mail_development_outbox','ik_jobs','ik_provenance','ik_originals'].map(async table=>[table,(await rt.db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n])));}
async function ownedRows(rt){return Object.fromEntries(await Promise.all(['host_profiles','profile_focus_areas','social_proof_entries','event_types','event_questions','recurring_availability_windows','availability_date_overrides','availability_date_override_windows','bookings','booking_occurrences','booking_answers','booking_manage_tokens','booking_history','booking_attendance','booking_calendar_conflicts'].map(async table=>[table,(await rt.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));}
async function databaseSnapshot(rt){
 const tables=(await rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results;
 const records=[];
 // Keep native RPC below its in-flight request bound while reading every table.
 for(let offset=0;offset<tables.length;offset+=16)records.push(...await Promise.all(tables.slice(offset,offset+16).map(async({name})=>[name,(await rt.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results])));
 return Object.fromEntries(records);
}
async function effectCounts(rt){
 const tables=(await rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row=>row.name).filter(name=>/delivery|outbox|reminder|calendar|meeting|mail_dispatch|operator_mail_invocations/u.test(name));
 return Object.fromEntries(await Promise.all(tables.map(async name=>[name,(await rt.db.prepare(`SELECT count(*) AS n FROM "${name}"`).first()).n])));
}
async function seedNative(rt){
  // Native host-independent reservations exercise existing occupancy and a claimed slug.
  await rt.db.prepare("INSERT INTO event_types(id,status,slug,title,description,duration_minutes,color,location_type,location_label,created_at,updated_at) VALUES('existing','draft','example-1','Native','',30,'#176b5a','in_person','Here',?,?)").bind('2027-01-01','2027-01-01').run();
  await rt.db.prepare("INSERT INTO bookings(id,event_type_id,event_slug,event_title,duration_minutes,location_type,location_label,location_value,invitee_name,invitee_email,host_timezone,invitee_timezone,state,ical_uid,calendar_state,meeting_state,current_occurrence_id,created_at,updated_at) VALUES('native','existing','native','Native',30,'in_person','Here','','Native','native@example.test','America/New_York','America/New_York','confirmed','native@example.test','succeeded','not_required','native-occurrence',?,?)").bind('2027-01-01','2027-01-01').run();
  await rt.db.prepare("INSERT INTO booking_occurrences(id,booking_id,sequence,start_at,end_at,occupied_start_at,occupied_end_at,host_date,state,is_current,created_at) VALUES('native-occurrence','native',0,?,?,?,?, '2027-01-05','current',1,'2027-01-01')").bind('2027-01-05T15:00:00.000Z','2027-01-05T15:30:00.000Z','2027-01-05T15:00:00.000Z','2027-01-05T15:30:00.000Z').run();
}
contract('DATA-003','saved API previews are inert; authenticated D1 apply resumes cold, reconciles, reimports, reverses and fences revocation',async()=>{
 for(const account of ['solo','edges']){const rt=await runtime();try{
  const files=await saved(account),expected=JSON.parse(await readFile(new URL(`./move-in/fixtures/${account}.expected.json`,import.meta.url),'utf8'));
  if(account==='edges'){
   // Empty-install ground truth from the saved pages: Jan 5 and Jan 6 fit;
   // Jan 6 15:15 overlaps, and the fourth booking belongs to a skipped event.
   expected.eventTypes.slugs=['example-1','example-2'];expected.bookings.confirmed=2;
   expected.bookingCounts.toImport=2;expected.bookingCounts.overlapping=1;
   expected.counts.bookings.imported=2;expected.counts.bookings.rejected=1;
  }
  const before=await native(rt),beforeRows=await ownedRows(rt),beforeEffects=await effectCounts(rt),allBefore=await databaseSnapshot(rt);const preview=await result(await rt.upload('preview',files));assertReport(preview.report);assert.deepEqual(preview.report.counts,expected.counts);assert.deepEqual(preview.report.bookingCounts,expected.bookingCounts);assert.deepEqual(await databaseSnapshot(rt),allBefore);assert.deepEqual(rt.calls,[]);
  const stable=await result(await rt.upload('preview',files,{uploadIdentity:preview.uploadIdentity}));assert.equal(stable.report.fingerprint,preview.report.fingerprint);assert.deepEqual(await databaseSnapshot(rt),allBefore);
  for(const options of [{uploadIdentity:preview.uploadIdentity+'tampered'},{uploadIdentity:undefined},{uploadIdentity:preview.uploadIdentity,asOf:'2027-01-02T00:00:00.000Z'}]){
   assert.equal((await rt.upload('apply',files,{fingerprint:preview.report.fingerprint,acknowledged:true,...options})).status,400);
   assert.deepEqual(await databaseSnapshot(rt),allBefore);
  }
  assert.equal((await rt.upload('apply',files,{fingerprint:preview.report.fingerprint})).status,400);
  assert.equal((await rt.upload('apply',files,{fingerprint:preview.report.fingerprint,acknowledged:true,operatorId:'forged-import-actor'})).status,400);assert.deepEqual(await databaseSnapshot(rt),allBefore);
  let applied=await result(await rt.upload('apply',files,{fingerprint:preview.report.fingerprint,acknowledged:true}));assert.equal(applied.job.checkpoint,0);
  applied=await result(await rt.api(`/api/app/move-in/jobs/${applied.job.id}/resume`,{method:'POST'}));assert.ok(applied.job.checkpoint>0&&applied.job.checkpoint<applied.job.total);
  await rt.restart();applied=await complete(rt,applied);
  const originals=(await rt.db.prepare("SELECT original_key,name FROM ik_originals WHERE job_id=? AND kind='artifact'").bind(applied.job.id).all()).results;
  assert.equal(originals.length,files.length);for(const file of files){const original=originals.find(o=>o.name===file.name);assert.ok(original,file.name);const chunks=(await rt.db.prepare("SELECT bytes FROM ik_d1_original_chunks WHERE job_id=? AND kind='artifact' AND original_key=? ORDER BY ordinal").bind(applied.job.id,original.original_key).all()).results;assert.deepEqual(Buffer.from(chunks.map(c=>c.bytes).join(''),'base64'),file.bytes,file.name);}
  const after=await native(rt),afterRows=await ownedRows(rt);assert.equal(after.bookings,before.bookings+expected.bookings.confirmed);assert.equal(after.event_types,before.event_types+expected.eventTypes.count);assert.equal(after.event_questions,expected.questions.count);assert.equal(after.recurring_availability_windows,expected.availability.windows);assert.equal(after.availability_date_overrides,expected.availability.overrides);assert.equal(after.booking_manage_tokens,expected.bookings.confirmed);
  assert.deepEqual(await effectCounts(rt),beforeEffects);assert.deepEqual(rt.calls,[]);assert.equal((await(await rt.api('/__fixtures/queue-count')).json()).queueCalls,0);
  const bookings=(await result(await rt.api('/api/app/bookings'))).filter(b=>b.imported);assert.equal(bookings.length,expected.bookings.confirmed);assert.ok(bookings.every(b=>b.state==='confirmed'));if(account==='solo'){assert.ok(bookings.some(b=>b.occurrence.startAt===expected.bookings.dstStart));assert.ok(bookings.every(b=>b.answers[0].value==='Discuss the example project'));}
  await assertImportedHistory(rt,files,preview.report.asOf);
  const profile=await rt.db.prepare('SELECT name,handle,timezone FROM host_profiles').first();assert.deepEqual(profile,expected.profile);
  const events=(await rt.db.prepare("SELECT status,slug,listed,location_type FROM event_types WHERE id IN(SELECT id FROM move_in_targets WHERE kind='event') ORDER BY slug").all()).results;assert.deepEqual(events.map(e=>e.status),expected.eventTypes.statuses);assert.deepEqual(events.map(e=>e.slug),expected.eventTypes.slugs);if(expected.eventTypes.locations)assert.deepEqual(events.map(e=>e.location_type),expected.eventTypes.locations);
  const repeat=await result(await rt.upload('preview',files));assert.equal(repeat.report.state,'already here');assert.equal(repeat.report.fingerprint,preview.report.fingerprint);
  const replay=await result(await rt.upload('apply',files,{fingerprint:repeat.report.fingerprint,acknowledged:true}));assert.equal(replay.job.id,applied.job.id);assert.deepEqual(await native(rt),after);
  let undo=await result(await rt.api(`/api/app/move-in/jobs/${applied.job.id}/undo`,{method:'POST'}));undo=await complete(rt,undo);assert.equal(undo.job.state,'undone');for(const table of ['bookings','event_types','host_profiles','booking_manage_tokens'])assert.equal((await native(rt))[table],before[table]);
  assert.ok(undo.undo.dispositions.length>0&&undo.undo.dispositions.every(d=>d.disposition==='reversed'&&d.reason==='unchanged'));assert.deepEqual(await ownedRows(rt),beforeRows);
  const undoneSnapshot=await databaseSnapshot(rt);assert.equal((await rt.upload('apply',files,{fingerprint:preview.report.fingerprint,acknowledged:true,uploadIdentity:preview.uploadIdentity})).status,400);assert.deepEqual(await databaseSnapshot(rt),undoneSnapshot);
  if(account==='edges'){
   const sourceId='https://api.calendly.com/event_types/edges-1',choice={type:'fixed_link',value:'https://meet.example.test/chosen',label:'Meeting'},choices={locations:{[sourceId]:choice}};
   const changed=await result(await rt.upload('preview',files,{choices}));assertLocationChoice(changed.report,sourceId,choice,[{kind:'zoom_conference'}]);
   const chosen=await complete(rt,await result(await rt.upload('apply',files,{choices,fingerprint:changed.report.fingerprint,acknowledged:true})));
   assert.deepEqual({...chosen.report,state:'preview'},changed.report);await assertImportedHistory(rt,files,changed.report.asOf);
   assert.deepEqual(await effectCounts(rt),beforeEffects);assert.deepEqual(rt.calls,[]);assert.equal((await(await rt.api('/__fixtures/queue-count')).json()).queueCalls,0);
   const chosenUndo=await complete(rt,await result(await rt.api(`/api/app/move-in/jobs/${chosen.job.id}/undo`,{method:'POST'})));assert.equal(chosenUndo.job.state,'undone');assert.deepEqual(await ownedRows(rt),beforeRows);
  }
  const capacity=capacityFiles(await saved('capacity'));const capacityBefore=await native(rt);const capacityResponse=await rt.upload('preview',capacity);const capacityExpected=JSON.parse(await readFile(new URL('./move-in/fixtures/capacity.expected.json',import.meta.url),'utf8'));assert.equal(capacityResponse.status,400);assert.match((await capacityResponse.json()).error.message,/limit/i);assert.equal(JSON.parse(capacity.find(f=>f.name==='event_types-1.json').bytes).collection.length,capacityExpected.eventTypesRead);assert.deepEqual(await native(rt),capacityBefore);
  if(account==='solo'){
   const manyWindows=windowFiles(files),sourceRules=JSON.parse(manyWindows.find(f=>f.name==='schedules-1.json').bytes).collection[0].rules;
   const expectedWindows=sourceRules.flatMap((rule,weekday)=>rule.intervals.map(interval=>{const minute=time=>Number(time.slice(0,2))*60+Number(time.slice(3));return {weekday,start_minute:minute(interval.from),end_minute:minute(interval.to)};}));
   const windowsBefore=await databaseSnapshot(rt),windowsPreview=await result(await rt.upload('preview',manyWindows));assert.equal(windowsPreview.report.counts.availability.imported,expectedWindows.length);assert.deepEqual(await databaseSnapshot(rt),windowsBefore);
   let windows=await complete(rt,await result(await rt.upload('apply',manyWindows,{fingerprint:windowsPreview.report.fingerprint,acknowledged:true})));
   assert.deepEqual((await rt.db.prepare('SELECT weekday,start_minute,end_minute FROM recurring_availability_windows ORDER BY weekday,start_minute').all()).results,expectedWindows);
   windows=await complete(rt,await result(await rt.api(`/api/app/move-in/jobs/${windows.job.id}/undo`,{method:'POST'})));assert.equal(windows.job.state,'undone');assert.equal((await native(rt)).recurring_availability_windows,0);
  }
  // Preview again uses the same selected bytes and as-of instant as the first application.
  const undoneBefore=await databaseSnapshot(rt),again=await result(await rt.upload('preview',files));assertReport(again.report);assert.deepEqual(again.report.bookingCounts,expected.bookingCounts);assert.deepEqual(await databaseSnapshot(rt),undoneBefore);
  let replacement=await result(await rt.upload('apply',files,{fingerprint:again.report.fingerprint,acknowledged:true}));assert.notEqual(replacement.job.id,applied.job.id);
  const queuedRetry=await result(await rt.upload('apply',files,{fingerprint:again.report.fingerprint,acknowledged:true}));assert.equal(queuedRetry.job.id,replacement.job.id);
  await rt.restart();replacement=await complete(rt,replacement);assert.equal(replacement.job.state,'completed');assert.equal((await native(rt)).bookings,after.bookings);
  assertFreshReimport(await ownedRows(rt),afterRows);
  await assertImportedHistory(rt,files,again.report.asOf);
  const reappliedBefore=await databaseSnapshot(rt),reapplied=await result(await rt.upload('apply',files,{fingerprint:again.report.fingerprint,acknowledged:true}));assert.equal(reapplied.job.id,replacement.job.id);assert.deepEqual(await databaseSnapshot(rt),reappliedBefore);assert.deepEqual(await effectCounts(rt),beforeEffects);assert.deepEqual(rt.calls,[]);
  const target=(await result(await rt.api('/api/app/bookings'))).find(b=>b.imported);
  if(account==='solo'){
   assert.equal((await rt.api(`/api/app/bookings/${target.id}`,{method:'DELETE'})).status,202);
   const erasedBefore=await databaseSnapshot(rt);assert.equal((await rt.upload('preview',files)).status,400);assert.equal((await rt.upload('apply',files,{fingerprint:again.report.fingerprint,acknowledged:true})).status,400);assert.deepEqual(await databaseSnapshot(rt),erasedBefore);
   for(const id of [applied.job.id,replacement.job.id]){const custody=await result(await rt.api(`/__fixtures/import-custody/${id}`));assert.ok(custody.originals.every(o=>o.original.status==='unavailable'&&o.original.reason==='unavailable-after-erasure'));}
  }else{
   const futureBefore=await databaseSnapshot(rt),future=await rt.api(`/api/app/bookings/${target.id}/attendance`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'attended',note:'Too early'})});
   assert.equal(future.status,409);assert.equal((await future.json()).error.code,'booking_not_ended');assert.deepEqual(await databaseSnapshot(rt),futureBefore);
   assert.equal((await rt.api(`/api/app/bookings/${target.id}/cancel`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:'Preserve this owner change'})})).status,200);
   const partial=await complete(rt,await result(await rt.api(`/api/app/move-in/jobs/${replacement.job.id}/undo`,{method:'POST'})));assert.ok(partial.undo.dispositions.some(d=>d.disposition==='retained'));
   const retainedBefore=await databaseSnapshot(rt);for(const action of ['preview','apply']){const refused=await rt.upload(action,files,{fingerprint:again.report.fingerprint,acknowledged:true});assert.equal(refused.status,400);assert.match((await refused.json()).error.message,/retained.*records/i);}assert.deepEqual(await databaseSnapshot(rt),retainedBefore);
  }
 }finally{await rt.close();}}
 await equalOperatorReplay({complete,databaseSnapshot,ownedRows});
 // An existing event requires the imported singleton profile even after every
 // unchanged imported booking/event is undone. Preserve the native rows exactly.
 const rt=await runtime();try{
  await seedNative(rt);const nativeBefore={event:await rt.db.prepare("SELECT * FROM event_types WHERE id='existing'").first(),booking:await rt.db.prepare("SELECT * FROM bookings WHERE id='native'").first()};
  const files=await saved('edges'),preview=await result(await rt.upload('preview',files));
  const imported=await complete(rt,await result(await rt.upload('apply',files,{fingerprint:preview.report.fingerprint,acknowledged:true})));
  const profileBefore=await rt.db.prepare('SELECT * FROM host_profiles').first();
  const undo=await complete(rt,await result(await rt.api(`/api/app/move-in/jobs/${imported.job.id}/undo`,{method:'POST'})));
  assert.equal(undo.job.state,'undone');const profile=undo.undo.dispositions.find(d=>d.targetKind==='profile');assert.equal(profile.disposition,'retained');assert.equal(profile.reason,'dependency');assert.ok(profile.protectedBy.some(p=>p.cause.table==='event_types'&&p.cause.recordId==='existing'));
  assert.ok(undo.undo.dispositions.filter(d=>d.targetKind!=='profile').every(d=>d.disposition==='reversed'&&d.reason==='unchanged'));
  assert.deepEqual(await rt.db.prepare('SELECT * FROM host_profiles').first(),profileBefore);assert.deepEqual(await rt.db.prepare("SELECT * FROM event_types WHERE id='existing'").first(),nativeBefore.event);assert.deepEqual(await rt.db.prepare("SELECT * FROM bookings WHERE id='native'").first(),nativeBefore.booking);
  const after=await native(rt);assert.equal(after.bookings,1);assert.equal(after.event_types,1);assert.equal(after.host_profiles,1);assert.equal(after.booking_manage_tokens,0);
 }finally{await rt.close();}
});
contract('DATA-003','edge losses, deliberate owner choices, malformed custody and overlapping bookings are reported from documented fixtures',async()=>{
 const rt=await runtime();try{
  const files=await saved('edges');
  const manifest=JSON.parse(await readFile(new URL('../seed.json',import.meta.url),'utf8'));
  const maximum=manifest.limits.maxAvailabilityOverridesPerEventType;
  const empty=await databaseSnapshot(rt);
  for(const open of [false,true])for(const count of [maximum,maximum+1]){
   const preview=await result(await rt.upload('preview',overrideFiles(await saved('solo'),count,open)));assertReport(preview.report);
   assert.equal(preview.report.counts.overrides.read,count);
   assert.equal(preview.report.counts.eventTypes.rejected,Number(count>maximum));
   assert.equal(preview.report.counts.overrides.imported,count>maximum?0:count);
   assert.equal(preview.report.counts.overrides.skipped,count>maximum?count:0);
   assert.equal(preview.report.events.filter(event=>event.mapped!==null).length,Number(count<=maximum));
   assert.deepEqual(await databaseSnapshot(rt),empty);
  }
  await seedNative(rt);
  const expected=JSON.parse(await readFile(new URL('./move-in/fixtures/edges.expected.json',import.meta.url),'utf8'));
  const preview=await result(await rt.upload('preview',files));assertReport(preview.report);assert.deepEqual(preview.report.counts,expected.counts);assert.deepEqual(preview.report.bookingCounts,expected.bookingCounts);assert.equal(preview.report.counts.bookings.rejected,2);
  const sourceId='https://api.calendly.com/event_types/edges-1',choice={type:'fixed_link',value:'https://meet.example.test/chosen',label:'Meeting'},choices={zone:'Europe/London',locations:{[sourceId]:choice}};
  const changed=await result(await rt.upload('preview',files,{choices}));assert.equal(changed.report.counts.availability.imported,2);assert.equal(changed.report.counts.overrides.imported,2);assert.notEqual(changed.report.fingerprint,preview.report.fingerprint);
  assertLocationChoice(changed.report,sourceId,choice,[{kind:'zoom_conference'}]);
  assert.equal(changed.report.counts.locations.read,preview.report.counts.locations.read);assert.equal(changed.report.counts.locations.changed,preview.report.counts.locations.changed+1);assert.equal(changed.report.counts.locations.skipped,preview.report.counts.locations.skipped-1);
  await locationChoices(rt,files,result,databaseSnapshot);
  const skipped=await result(await rt.upload('preview',files,{choices:{skipEvents:['https://api.calendly.com/event_types/edges-1']}}));assert.equal(skipped.report.counts.bookings.imported,0);
  const corrupt=files.map(f=>({...f,bytes:Buffer.from(f.bytes)}));corrupt.find(f=>f.name==='event_types-1.json').bytes[0]=0;assert.equal((await rt.upload('preview',corrupt)).status,400);
  let applied=await result(await rt.upload('apply',files,{fingerprint:preview.report.fingerprint,acknowledged:true}));
  // A real SQLite trigger revokes authority inside the native batch. The kit must roll the whole transaction back.
  applied=await result(await rt.api(`/api/app/move-in/jobs/${applied.job.id}/resume`,{method:'POST'}));
  await rt.db.prepare("CREATE TRIGGER import_authority_probe AFTER INSERT ON event_types BEGIN UPDATE oa_sessions SET revoked_at=1; END").run();const boundaryBefore=await native(rt);
  assert.equal((await rt.api(`/api/app/move-in/jobs/${applied.job.id}/resume`,{method:'POST'})).status,400);assert.deepEqual(await native(rt),boundaryBefore);await rt.db.prepare('DROP TRIGGER import_authority_probe').run();
  const before=await native(rt);await rt.db.prepare('UPDATE oa_sessions SET revoked_at=? WHERE id=?').bind(Date.now(),rt.session).run();assert.equal((await rt.api(`/api/app/move-in/jobs/${applied.job.id}/resume`,{method:'POST'})).status,401);assert.deepEqual(await native(rt),before);
 }finally{await rt.close();}
});
contract('DATA-002','erasure scrubs planted personal data from originals, plans and provenance while peers stay resumable; undo retains every native conflict kind',async()=>{
 const rt=await runtime();try{
  const files=await endedFiles();const marker='ERASE-PRIVATE-EXAMPLE-9281';
  const inviteeFile=files.find(f=>f.name==='invitees-1.json'),invitee=JSON.parse(inviteeFile.bytes);invitee.collection[0].name=marker;invitee.collection[0].email='erased-9281@example.test';invitee.collection[0].questions_and_answers[0].answer=marker;inviteeFile.bytes=Buffer.from(JSON.stringify(invitee));
  const {createHash}=await import('node:crypto');const mf=files.find(f=>f.name==='manifest.json'),manifest=JSON.parse(mf.bytes),entry=manifest.files.find(f=>f.name===inviteeFile.name);entry.size=inviteeFile.bytes.length;entry.sha256=createHash('sha256').update(inviteeFile.bytes).digest('hex');mf.bytes=Buffer.from(JSON.stringify(manifest));
  const preview=await result(await rt.upload('preview',files,{asOf:endedAsOf}));let applied=await result(await rt.upload('apply',files,{asOf:endedAsOf,fingerprint:preview.report.fingerprint,acknowledged:true}));
  let target;for(let i=0;!target&&i<30;i++){applied=await result(await rt.api(`/api/app/move-in/jobs/${applied.job.id}/resume`,{method:'POST'}));target=(await result(await rt.api('/api/app/bookings'))).find(b=>b.inviteeEmail==='erased-9281@example.test');}assert.ok(target);assert.ok(applied.job.checkpoint<applied.job.total);
  const importHistory=target.history[0];assert.ok(importHistory);
  const effectsBeforeErase=await effectCounts(rt);
  assert.equal((await rt.api(`/api/app/bookings/${target.id}`,{method:'DELETE'})).status,202);
  assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM booking_history WHERE booking_id=?').bind(target.id).first()).n,0);
  assert.deepEqual(await rt.db.prepare("SELECT entity_kind,action,actor_type,actor_id,happened_at FROM anonymized_audit WHERE action='created' AND happened_at=?").bind(importHistory.createdAt).first(),{entity_kind:'booking',action:'created',actor_type:'operator',actor_id:rt.operator,happened_at:importHistory.createdAt});
  assert.deepEqual(await effectCounts(rt),effectsBeforeErase);assert.deepEqual(rt.calls,[]);
  await rt.restart();applied=await complete(rt,applied);const bookings=await result(await rt.api('/api/app/bookings'));
  const retained=await result(await rt.api(`/__fixtures/import-custody/${applied.job.id}`));assert.ok(retained.originals.every(o=>o.original.status==='unavailable'&&o.original.reason==='unavailable-after-erasure'));assert.ok(!JSON.stringify(retained).includes(marker)&&!JSON.stringify(retained).includes('erased-9281@example.test'));
  const tables=(await rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'").all()).results;
  for(const {name}of tables){const rows=(await rt.db.prepare(`SELECT * FROM "${name}"`).all()).results;const encoded=JSON.stringify(rows);assert.ok(!encoded.includes(marker)&&!encoded.includes('erased-9281@example.test'),`${name}: personal copy remained`);}
  assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM bookings').first()).n,9);assert.equal((await rt.upload('preview',files)).status,400);
  const remaining=bookings.filter(b=>b.id!==target.id);
  // Actual authenticated cancellation has exactly one ordinary invitee notification and no calendar command.
  assert.equal((await rt.api(`/api/app/bookings/${remaining[0].id}/cancel`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:'Owner cancellation'})})).status,200);
  const outbox=(await rt.db.prepare('SELECT kind,payload_json FROM delivery_outbox').all()).results;assert.equal(outbox.length,1);assert.equal(outbox[0].kind,'mail_send');assert.equal(JSON.parse(outbox[0].payload_json).to,remaining[0].inviteeEmail);
  const delivered=await result(await rt.api('/__fixtures/drain',{method:'POST'}));assert.equal(delivered.succeeded,1);assert.deepEqual(rt.calls,[{url:'https://api.sendgrid.com/v3/mail/send',method:'POST'}]);
  const field=await result(await rt.api('/api/app/custom-fields',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({entity:'booking',label:'Operator annotation',kind:'long_text',options:[]})}),201);
  const annotated=remaining[5];
  assert.equal((await rt.api(`/api/app/custom-fields/booking/${annotated.id}/${field.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({value:'Preserve later operator annotation'})})).status,200);
  const attendanceBefore=new Map();
  for(const [index,status]of [[1,'attended'],[2,'no_show']]){
   const booking=remaining[index];assert.ok(Date.parse(booking.occurrence.endAt)<Date.now());
   attendanceBefore.set(booking.id,(await rt.db.prepare('SELECT * FROM booking_occurrences WHERE booking_id=? ORDER BY sequence').bind(booking.id).all()).results);
   assert.equal((await rt.api(`/api/app/bookings/${booking.id}/attendance`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status,note:'Keep this note'})})).status,200);
   assert.deepEqual((await rt.db.prepare('SELECT * FROM booking_occurrences WHERE booking_id=? ORDER BY sequence').bind(booking.id).all()).results,attendanceBefore.get(booking.id));
  }
  await rt.db.prepare("UPDATE booking_occurrences SET start_at='2027-06-01T15:00:00.000Z',end_at='2027-06-01T15:30:00.000Z' WHERE booking_id=?").bind(remaining[3].id).run();
  const events=(await rt.db.prepare('SELECT id FROM event_types ORDER BY slug').all()).results;
  await rt.db.prepare("UPDATE event_types SET description='Native edit without revision change' WHERE id=?").bind(events[0].id).run();
  await rt.db.prepare("UPDATE event_types SET status='published' WHERE id=?").bind(events[1].id).run();
  const existing=await rt.db.prepare('SELECT * FROM bookings WHERE id=?').bind(remaining[4].id).first();const native={...existing,id:'01NATIVE0000000000000000000',event_type_id:events[2].id,ical_uid:'new-native@example.test',imported:0,current_occurrence_id:null};const columns=Object.keys(native);await rt.db.prepare(`INSERT INTO bookings(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(c=>native[c])).run();
  let undo=await result(await rt.api(`/api/app/move-in/jobs/${applied.job.id}/undo`,{method:'POST'}));undo=await complete(rt,undo);assert.equal(undo.job.state,'undone');
  for(const booking of remaining.slice(0,4))assert.ok(await rt.db.prepare('SELECT id FROM bookings WHERE id=?').bind(booking.id).first());
  for(const [index,status]of [[1,'attended'],[2,'no_show']]){const booking=remaining[index],disposition=undo.undo.dispositions.find(d=>d.targetId===booking.id);assert.equal(disposition.disposition,'retained');assert.equal(disposition.reason,'edited');assert.deepEqual(await rt.db.prepare('SELECT status,note FROM booking_attendance WHERE booking_id=?').bind(booking.id).first(),{status,note:'Keep this note'});assert.deepEqual((await rt.db.prepare('SELECT * FROM booking_occurrences WHERE booking_id=? ORDER BY sequence').bind(booking.id).all()).results,attendanceBefore.get(booking.id));}
  const annotationDisposition=undo.undo.dispositions.find(d=>d.targetId===annotated.id);
  assert.equal(annotationDisposition.disposition,'retained');assert.equal(annotationDisposition.reason,'edited');
  const annotations=await result(await rt.api(`/api/app/custom-fields/booking/${annotated.id}`));assert.equal(annotations.find(value=>value.id===field.id).value,'Preserve later operator annotation');
  assert.equal((await rt.api(`/api/app/bookings/${annotated.id}`,{method:'DELETE'})).status,202,'explicit privacy erasure still removes an annotated imported booking');
  assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM ext_custom_field_values WHERE booking_id=?').bind(annotated.id).first()).n,0);
  for(const event of events.slice(0,3))assert.ok(await rt.db.prepare('SELECT id FROM event_types WHERE id=?').bind(event.id).first());
  assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM host_profiles').first()).n,1);
 }finally{await rt.close();}
});
