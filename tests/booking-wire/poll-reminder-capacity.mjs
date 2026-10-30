import assert from 'node:assert/strict';
import { pollEvent, pollInput, pollLinks } from '../polls/fixture.mjs';
import { wireMail, recipient, textBody } from './mail-contracts.mjs';

export async function pollReminderCapacity({data,state,future,checks}) {
 const event=await pollEvent(data,'synthetic-dial-1300');
 const slots=(await data(`/api/public/book/dial-host/${event.slug}/availability?week=${future}`)).slots;
 const people=Array.from({length:50},(_,index)=>({name:`Participant ${index+1}`,email:`synthetic-dial-${1301+index}@example.test`}));
 const poll=await data('/api/app/polls',pollInput(event,slots,people),201);
 const host=await data(`/api/app/polls/${poll.id}`);
 await data(`/api/app/polls/${poll.id}/reminders`,{offsetsMinutes:[1]});
 const links=pollLinks((await state()).delivery_outbox,poll.id);
 assert.equal(links.length,people.length);
 const cron=now=>data('/__fixtures/poll-cron',{now});
 const invitations=snapshot=>snapshot.delivery_outbox.filter(row=>links.some(link=>link.row.id===row.id));
 // Invitations also use Cron -> Queue -> production delivery, with no fixture drain limit.
 for(let pass=0;pass<people.length;pass++) {
  if(invitations(await state()).every(row=>row.state==='succeeded'))break;
  await cron(new Date().toISOString());
 }
 assert.equal(invitations(await state()).filter(row=>row.state==='succeeded').length,people.length,'every invitation delivered before the reminder window');
 const reminders=snapshot=>snapshot.delivery_outbox.filter(row=>JSON.parse(row.payload_json).pollId===poll.id&&JSON.parse(row.payload_json).pollReminderOffsetMinutes!==undefined);
 const sent=snapshot=>wireMail(snapshot).filter(mail=>mail.subject===`Reminder: ${host.title}`&&textBody(mail).includes(`/poll/${poll.id}?`));
 const first=await cron(new Date(Date.parse(host.closesAt)-45000).toISOString());
 assert.equal(first.acknowledged,first.enqueued);
 const beforeClose=await state();
 const afterClosure=new Date(Date.parse(host.closesAt)+15000).toISOString();
 await cron(afterClosure);
 const after=await state(),rows=reminders(after);
 const succeeded=reminders(beforeClose).filter(row=>row.state==='succeeded').length;
 const inactive=rows.filter(row=>row.last_error_code==='poll_reminder_inactive').length;
 console.log(`PROBE POLL-001 50 participants / one-minute offset: before-close succeeded=${succeeded}, after-close inactive=${inactive}`);
 assert.equal(succeeded,people.length,'the actual Cron producer dispatches the entire due reminder batch before closure');
 assert.equal(rows.length,people.length,'one configured reminder exists for each participant');
 assert.equal(inactive,0,'no reminder is starved until closure');
 assert.ok(rows.every(row=>row.state==='succeeded'&&Date.parse(row.succeeded_at)<Date.parse(host.closesAt)));
 const mail=sent(after);
 assert.equal(mail.length,people.length);
 for(const link of links) {
  const own=mail.filter(message=>recipient(message).includes(link.email));
  assert.equal(own.length,1,'each unanswered participant receives exactly one reminder');
  assert.ok(textBody(own[0]).includes(`token=${link.token}`));
 }
 await cron(afterClosure);
 assert.equal(sent(await state()).length,people.length,'a repeated Cron pass never sends a duplicate');
 assert.equal(reminders(await state()).length,people.length);
 checks.push('POLL-001: all 50 unanswered participants receive one configured one-minute reminder before closure through the actual Worker Cron and Queue exports; no inactive failure or repeat send.');
}
