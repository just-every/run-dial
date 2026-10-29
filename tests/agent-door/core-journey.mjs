import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {profile} from './native-owner.mjs';
import {errorCode as code} from '../../modules/agent-door/conformance/protocol.mjs';
export default async function coreJourney({request,origin,cookie,tool}) {
 const headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'};
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
 const preview=await request(origin+'/api/app/privacy/preview',{method:'POST',headers,body:JSON.stringify({email:'synthetic-dial-1@example.invalid'})});assert.equal(preview.status,200);
 const proof=await preview.json();
 const erased=await request(origin+'/api/app/privacy/erase',{method:'POST',headers,body:JSON.stringify({email:'synthetic-dial-1@example.invalid',confirmation:proof.confirmation,expiresAt:proof.expiresAt})});assert.equal(erased.status,200);
 const receipt=await erased.json();assert.equal(receipt.localComplete,true);
 const clients=await tool('dial.clients.list',{});assert.ok(clients.result?.structuredContent);
 assert.equal(JSON.stringify(clients.result.structuredContent).includes('synthetic-dial-1@example.invalid'),false);
}
