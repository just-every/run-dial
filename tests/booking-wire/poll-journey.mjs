import assert from 'node:assert/strict';
import { pollEvent,pollInput,pollLinks } from '../polls/fixture.mjs';
import { wireMail,recipient,textBody } from './mail-contracts.mjs';
export async function pollJourney({data,call,state,deliver,future,checks}){
 const event=await pollEvent(data,'synthetic-dial-1025'),base=`/api/public/book/dial-host/${event.slug}`;
 const slots=(await data(`${base}/availability?week=${future}`)).slots;
 const people=Array.from({length:4},(_,index)=>({name:`Planning participant ${index+1}`,email:`synthetic-dial-${1026+index}@example.test`}));
 const created=await data('/api/app/polls',pollInput(event,slots,people,true),201),host=await data(`/api/app/polls/${created.id}`);
 const links=pollLinks((await state()).delivery_outbox,created.id);assert.equal(links.length,4);
 const visible=await data(`${base}/availability?week=${future}`);for(const candidate of host.candidates)assert.ok(!visible.slots.some(s=>s.startAt===candidate.startAt));
 const domain=s=>Object.fromEntries(['meeting_polls','poll_candidates','poll_participants','poll_vote_tokens','poll_votes'].map(t=>[t,s[t]]));
 const before=domain(await state());const forged=(links[0].token[0]==='a'?'b':'a')+links[0].token.slice(1);
 await call(`/api/public/polls/${created.id}/votes`,{token:forged,votes:host.candidates.map(c=>({candidateId:c.id,choice:'yes'}))},404);assert.deepEqual(domain(await state()),before);
 for(const link of links){const own=await data(`/api/public/polls/${created.id}?token=${link.token}`);assert.equal(Object.hasOwn(own,'tally'),false);assert.equal(Object.hasOwn(own,'participants'),false);const saved=await data(`/api/public/polls/${created.id}/votes`,{token:link.token,votes:host.candidates.map(c=>({candidateId:c.id,choice:'yes'}))});await call(`/api/public/polls/${created.id}/votes`,{token:link.token,votes:host.candidates.map(c=>({candidateId:c.id,choice:'no'}))},404);link.token=saved.token;}
 const changed=await data(`/api/public/polls/${created.id}/votes`,{token:links[0].token,votes:host.candidates.map(c=>({candidateId:c.id,choice:'if_needed'}))});links[0].token=changed.token;
 await data(`/api/app/polls/${created.id}/tally`,{show:true});const tally=(await data(`/api/public/polls/${created.id}?token=${links[0].token}`)).tally;assert.ok(tally.every(t=>t.yes===3&&t.ifNeeded===1&&t.no===0));
 await deliver();await deliver();const mail=wireMail(await state()).filter(m=>textBody(m).includes(`/poll/${created.id}?`));for(const person of people)assert.equal(mail.filter(m=>recipient(m).includes(person.email)).length,1,'each participant invitation sends once at the synthetic mail edge');
 await data(`/api/app/polls/${created.id}/close`,{});for(const link of links)await call(`/api/public/polls/${created.id}/votes`,{token:link.token,votes:host.candidates.map(c=>({candidateId:c.id,choice:'yes'}))},404);
 const released=await data(`${base}/availability?week=${future}`);for(const candidate of host.candidates)assert.ok(released.slots.some(s=>s.startAt===candidate.startAt));
 checks.push('POLL-001 private rotating participant votes, counts-only optional tally, one invitation per participant at the synthetic SendGrid edge, held candidates disappear and return immediately at close; winning booking and timed reminders remain unbuilt.');
}
