import assert from 'node:assert/strict';
import { createArchive, restoreArchive } from '../archive/artifact.mjs';
import { testPlatform } from '../archive/fixture.mjs';
import { schemaModel } from '../../scripts/archive/schema.mjs';
import { pollEvent, pollInput, pollLinks } from '../polls/fixture.mjs';

// Part of CUSTOM-002's existing record-deletion journey: the poll owns a real
// hold and a participant capability, and another event observes slot release.
export async function assertPollDeletion(f) {
 const data=(path,body,status=200)=>f.json(path,{method:body?'POST':'GET',body},status);
 assert.equal((await f.request('/api/app/calendar/connection',{method:'DELETE'})).status,204);
 const event=await pollEvent(data,'synthetic-dial-1030');
 const control=await pollEvent(data,'synthetic-dial-1031');
 const week=new Date(Date.now()+20*86400000).toISOString().slice(0,10);
 const availability=e=>`/api/public/book/host/${e.slug}/availability?week=${week}`;
 const slots=(await data(availability(event))).slots;
 const created=await data('/api/app/polls',pollInput(event,slots,[{name:'Planning participant',email:'synthetic-dial-1032@example.test'}],true),201);
 const poll=await data(`/api/app/polls/${created.id}`);
 const rows=(await f.db.prepare('SELECT * FROM delivery_outbox').all()).results;
 const [link]=pollLinks(rows,created.id);
 assert.ok(link);
 const saved=await data(`/api/public/polls/${created.id}/votes`,{token:link.token,votes:poll.candidates.map(c=>({candidateId:c.id,choice:'yes'}))});
 assert.equal((await data(`/api/app/polls/${created.id}`)).participants[0].votes.length,poll.candidates.length);
 const held=await data(availability(control));
 for(const candidate of poll.candidates)assert.ok(!held.slots.some(s=>s.startAt===candidate.startAt),'poll hold blocks another event type');
 const deletion=await f.request(`/api/app/event-types/${event.id}`,{method:'DELETE'});
 assert.equal(deletion.status,204,await deletion.text());
 assert.equal((await f.request(`/api/app/polls/${created.id}`)).status,404);
 assert.equal((await f.request(`/api/public/polls/${created.id}?token=${saved.token}`,{auth:false})).status,404);
 for(const table of ['meeting_polls','poll_candidates','poll_participants','poll_votes','poll_vote_tokens'])assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0,`${table} removed`);
 assert.equal(await f.db.prepare('SELECT id FROM booking_links WHERE id=?').bind(poll.holdLinkId).first(),null);
 assert.equal(await f.db.prepare('SELECT id FROM delivery_outbox WHERE id=?').bind(link.row.id).first(),null,'invitation capability and its command removed');
 assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 const destination=await schemaModel();
 try {
  const archive=await createArchive({...testPlatform(destination.db),binding:f.db});
  for(const table of ['meeting_polls','poll_candidates','poll_participants','poll_votes'])assert.equal(archive.tables.find(t=>t.name===table).rows.length,0,'deleted polls do not enter the archive');
  assert.equal(archive.tables.some(t=>t.name==='poll_vote_tokens'),false);
  const platform=testPlatform(destination.db);await restoreArchive(platform,archive);assert.deepEqual(await createArchive(platform),archive);
 } finally {destination.db.close();}
 const released=await data(availability(control));
 for(const candidate of poll.candidates)assert.ok(released.slots.some(s=>s.startAt===candidate.startAt),'deletion releases the slot through public availability');
}
