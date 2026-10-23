import assert from 'node:assert/strict';
import { pollEvent,pollInput,pollLinks } from './fixture.mjs';
export async function personalPoll(rt,{email,name}){
 const event=await pollEvent(rt.data),week=new Date(Date.now()+20*86400000).toISOString().slice(0,10),slots=(await rt.data(`/api/public/book/dial-host/${event.slug}/availability?week=${week}`)).slots;
 const control='synthetic-dial-1013@example.test',created=await rt.data('/api/app/polls',pollInput(event,slots,[{name,email},{name:'Morgan Lee',email:control}],true),201);
 const mail=(await rt.db.prepare('SELECT * FROM delivery_outbox').all()).results,links=pollLinks(mail,created.id);
 const host=await rt.data(`/api/app/polls/${created.id}`);
 const records=async()=>Object.fromEntries(await Promise.all(['meeting_polls','poll_candidates','poll_participants','poll_votes','poll_vote_tokens'].map(async table=>[table,(await rt.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
 const publicCall=async(id,token,votes,status=200)=>{const response=await rt.api(`/api/public/polls/${id}/votes`,{method:'POST',headers:{cookie:'','content-type':'application/json'},body:JSON.stringify({token,votes})});assert.equal(response.status,status);return response.json();};
 const votes=host.candidates.map(c=>({candidateId:c.id,choice:'yes'}));
 const foreignId=(await rt.data('/api/app/polls',pollInput(event,slots.slice(4),[{name:'Other contact',email:'synthetic-dial-1024@example.test'}]),201)).id;
 const before=await records();await publicCall(created.id,links[0].token.slice(0,-1)+(links[0].token.endsWith('a')?'b':'a'),votes,404);assert.deepEqual(await records(),before);
 await publicCall(foreignId,links[0].token,votes,404);assert.deepEqual(await records(),before,'foreign poll capability writes no domain state');
 const close=host.closesAt;await rt.db.prepare("UPDATE meeting_polls SET closes_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(created.id).run();const expired=await records();await publicCall(created.id,links[0].token,votes,404);assert.deepEqual(await records(),expired,'expired capability writes no domain state');await rt.db.prepare('UPDATE meeting_polls SET closes_at=? WHERE id=?').bind(close,created.id).run();
 let targetToken;
 for(const link of links){const result=await publicCall(created.id,link.token,votes);if(link.email===email)targetToken=result.token;const snapshot=await records();await publicCall(created.id,link.token,votes,404);assert.deepEqual(await records(),snapshot,'replayed vote capability has no domain write');}
 const controlRows=async()=>{const person=await rt.db.prepare('SELECT * FROM poll_participants WHERE email=?').bind(control).first();return {person,votes:(await rt.db.prepare('SELECT * FROM poll_votes WHERE participant_id=? ORDER BY candidate_id').bind(person.id).all()).results,token:await rt.db.prepare('SELECT * FROM poll_vote_tokens WHERE participant_id=?').bind(person.id).first()};};
 const saved=await controlRows();
 // A changed vote invalidates an earlier erasure preview just like a changed client note.
 const preview=await rt.data('/api/app/privacy/preview',{email});await publicCall(created.id,targetToken,votes.map(v=>({...v,choice:'if_needed'})));await rt.data('/api/app/privacy/erase',{email,confirmation:preview.confirmation,expiresAt:preview.expiresAt},409);
 return {assertErased:async()=>{assert.equal(await rt.db.prepare('SELECT 1 FROM poll_participants WHERE email=?').bind(email).first(),null);assert.deepEqual(await controlRows(),saved,'control participant votes and capability stay byte-identical');assert.ok(await rt.db.prepare('SELECT 1 FROM meeting_polls WHERE id=?').bind(created.id).first());}};
}
