import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {profile,mergeAudits} from './native-owner.mjs';
import {errorCode as code} from '../../modules/agent-door/conformance/protocol.mjs';
export async function afterStep({step,result,phase}) {
 if(step.tool==='dial.events.list') {
  assert.ok(Array.isArray(result.events));
  assert.ok(result.events.length<=step.args.limit);
  assert.ok(result.cursor===null||typeof result.cursor==='string');
 }
 if(step.tool!=='dial.clients.merge'||result?.merged!==true)return;
 const audits=await mergeAudits(),audit=audits.at(-1);
 assert.equal(audit?.actor_type,'agent','native merge audit must not turn agent preparation into a person action');
 const attribution=JSON.parse(audit.reason);
 assert.ok(audit.actor_id&&attribution.sponsor&&attribution.preparedBy.includes(' for '));
 assert.notEqual(audit.actor_id,attribution.sponsor);
 assert.equal(attribution.approvers.length,phase==='held'?1:0,'only a real held-policy decision supplies an approver');
}
export default async function coreJourney({request,origin,cookie,tool}) {
 const headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'};
 // The pinned Base mounts this read-only tool even for the CORE subset.
 // Its native store supplies stable policy facts, never invented product events.
 const events=async args=>{const response=await tool('dial.events.list',args);assert.notEqual(response.result?.isError,true);return response.result.structuredContent;};
 const firstPage=await events({limit:1});
 assert.equal(firstPage.events.length,1,'native policy adoption supplies a visible retained fact');
 assert.equal(firstPage.events[0].type,'policy.adopted');
 assert.equal(firstPage.cursor,firstPage.events[0].id);
 const replayPage=await events({limit:1});assert.deepEqual(replayPage,firstPage,'the same cursor position returns the same retained event');
 const nextPage=await events({after:firstPage.cursor,limit:1});
 assert.ok(nextPage.events.every(event=>event.id!==firstPage.cursor),'after advances past the retained event');
 for(const limit of [0,201])assert.equal(code(await tool('dial.events.list',{limit})),'invalid_arguments');
 const witness=async()=>{const r=await request(origin+'/api/app/profile',{headers});assert.equal(r.status,200);return r.json();};
 const before=await witness(),key=randomUUID(),args={...profile,idempotency_key:key};
 const first=await tool('dial.profile.save',args),after=await witness();assert.notEqual(first.result?.isError,true);
 const replay=await tool('dial.profile.save',args);assert.deepEqual(replay.result?.structuredContent,first.result?.structuredContent);assert.deepEqual(await witness(),after);
 const conflict=await tool('dial.profile.save',{...args,title:'Conflicting replay'});assert.equal(code(conflict),'idempotency_conflict');assert.deepEqual(await witness(),after);
 const stale=await tool('dial.profile.save',{...profile,idempotency_key:randomUUID(),expected_revision:randomUUID()});assert.equal(code(stale),'revision_conflict');assert.deepEqual(await witness(),after);
 const pause=async paused=>{const r=await request(origin+'/agents/api/pause',{method:'POST',headers,body:JSON.stringify({paused})});assert.equal(r.status,200);};
 await pause(true);
 try{const refused=await tool('dial.profile.save',{...profile,title:'Paused change',idempotency_key:randomUUID()});assert.equal(code(refused),'agents_paused');assert.deepEqual(await witness(),after);}finally{await pause(false);}
 assert.equal(before.id,after.id,'native singleton identity survives writes and replay');
 // Exercise the existing native erasure lifecycle after approvals and retained reads.
 const catalogue=await tool('dial.clients.list',{});
 const subject=catalogue.result?.structuredContent?.clients?.find(client=>client.email.endsWith('@example.invalid'))?.email;
 assert.ok(subject,'native fixture must retain a client for erasure');
 const preview=await request(origin+'/api/app/privacy/preview',{method:'POST',headers,body:JSON.stringify({email:subject})});assert.equal(preview.status,200);
 const proof=await preview.json();
 const erased=await request(origin+'/api/app/privacy/erase',{method:'POST',headers,body:JSON.stringify({email:subject,confirmation:proof.confirmation,expiresAt:proof.expiresAt})});assert.equal(erased.status,200);
 const receipt=await erased.json();assert.equal(receipt.localComplete,true);
 const clients=await tool('dial.clients.list',{});assert.ok(clients.result?.structuredContent);
 assert.equal(JSON.stringify(clients.result.structuredContent).includes(subject),false);
}
