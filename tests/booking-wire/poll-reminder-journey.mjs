import assert from 'node:assert/strict';
import { pollEvent, pollInput, pollLinks } from '../polls/fixture.mjs';
import { wireMail, recipient, textBody, htmlBody } from './mail-contracts.mjs';

export async function pollReminderJourney({data,call,state,deliver,future,checks,phase,persisted}) {
 const fixture=(action,now,id)=>data('/__fixtures/poll-reminders',{action,now,id});
 const reminders=(snapshot,id)=>snapshot.delivery_outbox.filter(r=>{const p=JSON.parse(r.payload_json);return p.pollId===id&&p.pollReminderOffsetMinutes!==undefined;});
 const sent=(snapshot,id)=>wireMail(snapshot).filter(m=>m.subject==='Reminder: Project planning'&&textBody(m).includes(`/poll/${id}?`));
 const vote=async (id,link)=>{const host=await data(`/api/app/polls/${id}`);return data(`/api/public/polls/${id}/votes`,{token:link.token,votes:host.candidates.map(c=>({candidateId:c.id,choice:'yes'}))});};
 const erase=async email=>{const preview=await data('/api/app/privacy/preview',{email});return data('/api/app/privacy/erase',{email,confirmation:preview.confirmation,expiresAt:preview.expiresAt});};
 if (phase==='after-restart') {
  const {id,second,links}=persisted;
  assert.equal(sent(await state(),id).length,2,"the second offset has not fired before restart");
  await Promise.all([fixture('sweep',second),fixture('sweep',second)]);
  await Promise.all([fixture('deliver',second),fixture('deliver',second)]);
  await fixture('sweep',second);await fixture('deliver',second);
  const snapshot=await state(),queued=reminders(snapshot,id),mail=sent(snapshot,id);
  assert.equal(queued.length,4,'the durable configuration yields two offsets for each unanswered participant across restart');
  assert.equal(mail.length,4,'concurrent delivery and replay send each configured reminder once');
  for(const link of links.slice(0,2)) {
   const own=mail.filter(m=>recipient(m).includes(link.email));assert.equal(own.length,2);
   assert.ok(own.every(m=>textBody(m).includes(`token=${link.token}`)&&htmlBody(m).includes(`token=${link.token}`)));
   const view=await data(`/api/public/polls/${id}?token=${link.token}`);
   assert.equal(view.name,link.name);assert.equal(Object.hasOwn(view,'participants'),false);assert.deepEqual(view.votes,[]);
   assert.ok(mail.filter(m=>!recipient(m).includes(link.email)).every(m=>!JSON.stringify(m).includes(link.token)),'each live link reaches only its participant');
  }
  await call(`/api/app/polls/${id}/reminders`,{offsetsMinutes:[30]},409);
  checks.push('POLL-001 configured reminders survive a native Worker restart, concurrent sweeps and delivery replay without extra sends; each mail has a private live link.');
  return;
 }
 const event=await pollEvent(data,'synthetic-dial-1210');
 const slots=(await data(`/api/public/book/dial-host/${event.slug}/availability?week=${future}`)).slots;
 const create=async (number,count=1)=>{
  const people=Array.from({length:count},(_,index)=>({name:`Participant ${number+index}`,email:[`synthetic-dial-${number+index}`,'example.test'].join('@')}));
  const created=await data('/api/app/polls',pollInput(event,slots,people),201);
  const host=await data(`/api/app/polls/${created.id}`);
  assert.deepEqual(host.reminderOffsetsMinutes,[],'new polls default to no reminders');
  const links=pollLinks((await state()).delivery_outbox,created.id).map(link=>({...link,name:people.find(p=>p.email===link.email).name}));
  return {...created,host,links};
 };
 const poll=await create(1220,4),id=poll.id;
 const before=new Date(Date.parse(poll.host.closesAt)-121*60000).toISOString();
 const first=new Date(Date.parse(poll.host.closesAt)-120*60000).toISOString();
 const second=new Date(Date.parse(poll.host.closesAt)-60*60000).toISOString();
 const snapshot=await state();
 const anonymous=await fetch(process.env.DIAL_REVIEW_ORIGIN+`/api/app/polls/${id}/reminders`,{method:'POST',headers:{'content-type':'application/json',origin:process.env.DIAL_REVIEW_ORIGIN},body:JSON.stringify({offsetsMinutes:[120,60]})});
 assert.equal(anonymous.status,401);await anonymous.arrayBuffer();
 assert.deepEqual((await state()).meeting_polls,snapshot.meeting_polls,'anonymous configuration changes nothing');
 for(const offsetsMinutes of [[0],[-1],[10081],[1.5],[60,60],[240,120,60,30]])await call(`/api/app/polls/${id}/reminders`,{offsetsMinutes},400);
 await call(`/api/app/polls/${id}/reminders`,{offsetsMinutes:[10080]},409);
 const silent=await create(1240);
 await fixture('sweep',second);await fixture('deliver',second);
 assert.equal(reminders(await state(),silent.id).length,0,'an unconfigured poll never gains implicit reminders');
 await data(`/api/app/polls/${id}/reminders`,{offsetsMinutes:[60,120]});
 assert.deepEqual((await data(`/api/app/polls/${id}`)).reminderOffsetsMinutes,[120,60]);
 await deliver();
 await vote(id,poll.links[2]);await erase(poll.links[3].email);
 await Promise.all([fixture('sweep',before),fixture('sweep',before)]);
 assert.equal(reminders(await state(),id).length,0,'no early reminder is queued');
 await Promise.all([fixture('sweep',first),fixture('sweep',first)]);
 await Promise.all([fixture('deliver',first),fixture('deliver',first)]);
 assert.equal(sent(await state(),id).length,2,'only the two unanswered participants receive the first configured reminder');
 assert.equal(reminders(await state(),id).length,2);
 await fixture('sweep',first);await fixture('deliver',first);
 assert.equal(sent(await state(),id).length,2,'a repeated sweep does not resend the same offset');
 // Each terminal transition is exercised with a reminder already admitted to the durable outbox.
 for(const [index,action] of ['vote','close','expire','erase','disable','restore-closed'].entries()) {
  const target=await create(1250+index*2,2);
  await deliver();
  await data(`/api/app/polls/${target.id}/reminders`,{offsetsMinutes:[240,180]});
  const due=new Date(Date.parse(target.host.closesAt)-240*60000).toISOString();
  await fixture('sweep',due);
  assert.equal(reminders(await state(),target.id).length,2);
  if(action==='vote') {
   await data('/wire/control',{name:`mail-rate-limited:${target.links[0].email}`,value:1});
   await fixture('deliver',due);
   const attempt=reminders(await state(),target.id).find(r=>JSON.parse(r.payload_json).to===target.links[0].email);
   assert.equal(attempt.state,'pending');assert.ok(JSON.parse(attempt.payload_json).wireMail,'a rejected attempt freezes the reminder bytes before the vote');
   await vote(target.id,target.links[0]);
  }
  if(action==='close')await data(`/api/app/polls/${target.id}/close`,{});
  if(action==='expire')await fixture('expire',new Date(Date.now()-60000).toISOString(),target.id);
  if(action==='erase')await erase(target.links[0].email);
  if(action==='disable')await data(`/api/app/polls/${target.id}/reminders`,{offsetsMinutes:[]});
  if(action==='restore-closed')await fixture('restore-closed',due,target.id);
  await fixture('sweep',new Date(Date.parse(target.host.closesAt)-180*60000).toISOString());
  await fixture('deliver',new Date(Date.parse(target.host.closesAt)-180*60000).toISOString());
  const after=await state(),messages=sent(after,target.id);
  const eligible=['vote','erase'].includes(action);
  assert.equal(messages.length,action==='vote'?3:eligible?2:0,`${action}: queued and subsequent reminders respect live eligibility`);
  assert.equal(messages.filter(m=>recipient(m).includes(target.links[0].email)).length,action==='vote'?1:0,`${action}: the canceled participant receives no mail`);
  if(action==='erase') {
   assert.equal(after.poll_participants.some(p=>p.email===target.links[0].email),false);
   assert.equal(after.delivery_outbox.some(r=>r.payload_json.includes(target.links[0].email)||r.payload_json.includes(target.links[0].token)),false,'erasure removes queued reminder address and capability');
  }
 }
 checks.push('POLL-001 native reminders default off; owner-only bounded future configuration; no early mail; voting, closure, expiry, erasure, disabling and restored closure stop queued and future reminders.');
 return {id,second,links:poll.links};
}
