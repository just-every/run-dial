import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contract } from './contract.mjs';
import { runtime, saved } from './move-in/runtime.mjs';
import { checkout, run, setupToken } from './archive/transfer.mjs';
import { openInstall } from './archive/operator-runtime.mjs';
import { resetRetainingJournal, refuseOldArchive, scanArchive } from './erasure/cli-fence.mjs';
import { excluded } from '../scripts/archive/policy.mjs';
function ordered(rows){return rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
contract('DATA-003','[DATA-002] native CLI carries erasure fences and refuses old archives in otherwise empty reset destinations',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dial-move-in-portability-')),source=join(directory,'source'),target=join(directory,'target');let rt,proxy;
 try{
  await checkout(source);await checkout(target);
  // The public command creates the actual fully migrated local state.
  await run(source,['export','--target','local','--output','exports/empty.rer']);
  rt=await runtime({state:join(source,'.wrangler/state/v3'),databaseId:'00000000-0000-0000-0000-000000000000',initialize:false});
  const files=await saved('solo');
  // Synthetic saved pages still enter through the real upload/manifest verification.
  const manifest=JSON.parse(files.find(file=>file.name==='manifest.json').bytes);
  const erasedEmail='erased-cli-person@example.test', erasedText='CLI_ERASE_PRIVATE_78321';let firstInvitee=true;
  for(const file of files.filter(file=>file.name.startsWith('invitees-'))){const page=JSON.parse(file.bytes);for(const invitee of page.collection){invitee.name='Imported Straße Σςσ\0Élodie';if(firstInvitee){invitee.name+=' '+erasedText;invitee.email=erasedEmail;invitee.questions_and_answers[0].answer=erasedText;firstInvitee=false;}}file.bytes=Buffer.from(JSON.stringify(page));const entry=manifest.files.find(entry=>entry.name===file.name);entry.size=file.bytes.length;entry.sha256=createHash('sha256').update(file.bytes).digest('hex');}
  files.find(file=>file.name==='manifest.json').bytes=Buffer.from(JSON.stringify(manifest));
  const preview=await(await rt.upload('preview',files)).json();
  let response=await rt.upload('apply',files,{fingerprint:preview.report.fingerprint,acknowledged:true});assert.equal(response.status,200,'Native move-in response has unexpected status');let current=await response.json();
  const complete=async()=>{for(let i=0;current.job.state!=='completed'&&i<30;i++){response=await rt.api(`/api/app/move-in/jobs/${current.job.id}/resume`,{method:'POST'});assert.equal(response.status,200,'Native move-in response has unexpected status');current=await response.json();}assert.equal(current.job.state,'completed');};
  await complete();
  // A catch-up job and a difference-driven release travel as native rows; their private custody does not.
  const later=await saved('solo-later'),catchUp=await(await rt.upload('preview',later,{asOf:'2027-01-02T00:00:00.000Z'})).json();assert.equal(catchUp.report.mode,'catch-up');
  response=await rt.upload('apply',later,{fingerprint:catchUp.report.fingerprint,acknowledged:true});assert.equal(response.status,200,'Native move-in response has unexpected status');current=await response.json();await complete();
  const released=(await rt.db.prepare("SELECT id FROM bookings WHERE invitee_email='guest-5@example.test'").first()).id;
  assert.equal((await rt.api(`/api/app/bookings/${released}/release-imported`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,200);
  const authorEmail='erased-policy-author@example.test';
  const invitedAuthor=await rt.api('/api/app/operators',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:authorEmail})});assert.equal(invitedAuthor.status,201);const author=(await invitedAuthor.json()).operator;
  await rt.db.prepare('INSERT INTO oa_domain_rules(domain,provider_id,created_by,created_at) VALUES(?,?,?,?)').bind('retained-policy.example.test','historical-provider',author.id,1234).run();
  await rt.offline(()=>run(source,['export','--target','local','--output','exports/before-erasure.rer']));
  assert.equal((await rt.api(`/api/app/operators/${author.id}/remove`,{method:'POST'})).status,204);
  const authorReference=await rt.db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(author.id).first();assert.equal(authorReference.status,'inactive');assert.equal(authorReference.email,'erased:'+author.id);

  const erase=await rt.db.prepare('SELECT id FROM bookings WHERE invitee_email=?').bind(erasedEmail).first();assert.equal((await rt.api(`/api/app/bookings/${erase.id}`,{method:'DELETE'})).status,202);
  const tables=['bookings','booking_occurrences','booking_answers','booking_history','event_types','move_in_targets','move_in_captures','move_in_source_links','move_in_differences','ik_d1_erased_sources','ik_d1_erased_targets','oa_operators','operators','oa_domain_rules'];
  const original=Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await rt.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));assert.equal(original.bookings.length,11);
  assert.equal(original.move_in_captures.length,2);assert.equal(original.move_in_differences.length,9,'the erased booking took its difference row with it');
  assert.ok(original.booking_history.some(row=>row.booking_id===released&&row.action==='cancelled'&&row.actor_type==='operator'));
  const searched=await rt.api('/api/app/bookings?'+new URLSearchParams({query:'IMPORTED STRASSE ςςς'}));assert.equal(searched.status,200);assert.equal(Number(searched.headers.get('X-Total-Count')),9);assert.equal((await searched.json()).length,9);
  const embedded=await rt.api('/api/app/bookings?'+new URLSearchParams({query:'\0ÉLODIE'}));assert.equal(embedded.status,200);assert.equal((await embedded.json()).length,9);assert.ok(original.ik_d1_erased_targets.length>0);
  await rt.close();rt=undefined;
  proxy=await openInstall(source);
  const oldAuthority=await proxy.signIn();
  await proxy.dispose();proxy=undefined;
  await run(source,['export','--target','local','--output','exports/imported.rer']);await cp(join(source,'exports/imported.rer'),join(target,'exports/imported.rer'));
  await scanArchive(join(source,'exports/imported.rer'),[erasedEmail,erasedText,authorEmail]);
  await cp(join(source,'exports/before-erasure.rer'),join(target,'exports/before-erasure.rer'));
  await run(target,['import','--target','local','--input','exports/imported.rer','--yes']);
  proxy=await openInstall(target);
  for(const table of tables){const rows=(await proxy.env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;assert.deepEqual(ordered(rows),ordered(original[table]),table);}
  for(const table of [...Object.keys(excluded),'delivery_outbox'])assert.equal((await proxy.env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,0,table);
  const restored=proxy;
  assert.equal((await restored.request('/api/app/bookings',{cookie:oldAuthority.cookie})).status,401);
  assert.equal((await restored.request('/auth/confirm',{body:{token:oldAuthority.token}})).status,400);
  assert.equal((await restored.request('/auth/bootstrap',{body:{token:setupToken,displayName:'Replacement owner',returnTo:'/app'}})).status,409);
  const authority=await restored.signIn();
  const reactivate=await restored.request('/auth/operator/status',{cookie:authority.cookie,body:{operatorId:author.id,status:'active'}});assert.equal(reactivate.status,404);await reactivate.arrayBuffer();
  assert.equal((await restored.env.DB.prepare('SELECT status FROM oa_operators WHERE id=?').bind(author.id).first()).status,'inactive');

  const searchedAfter=await restored.request('/api/app/bookings?'+new URLSearchParams({query:'IMPORTED STRASSE ςςς'}),{cookie:authority.cookie});assert.equal(searchedAfter.status,200);assert.equal(Number(searchedAfter.headers.get('X-Total-Count')),9);assert.equal((await searchedAfter.json()).length,9);
  const embeddedAfter=await restored.request('/api/app/bookings?'+new URLSearchParams({query:'\0ÉLODIE'}),{cookie:authority.cookie});assert.equal(embeddedAfter.status,200);assert.equal((await embeddedAfter.json()).length,9);
  await proxy.dispose();proxy=undefined;await run(target,['export','--target','local','--output','exports/reexport.rer']);assert.ok((await readFile(join(target,'exports/reexport.rer'))).length>0);
  // Both destinations are reset to otherwise empty application stores. The
  // second learned its trusted fence only by importing the later native archive.
  await resetRetainingJournal(source);await refuseOldArchive(source,'exports/before-erasure.rer');
  await resetRetainingJournal(target);await refuseOldArchive(target,'exports/before-erasure.rer');
 }finally{await rt?.close();await proxy?.dispose();await rm(directory,{recursive:true,force:true});}
});
