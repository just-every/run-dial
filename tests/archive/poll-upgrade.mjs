import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { migrationFiles,tableQuery,quote } from '../../scripts/archive/schema.mjs';
export async function pollUpgrade(source){const prior=new DatabaseSync(':memory:');try{
 const migrations=await migrationFiles(),added=migrations.find(m=>m.file.endsWith('_meeting_polls.sql'));
 // A trigger or index cannot be installed on a table this upgrade has not
 // created yet. Defer those dependent migrations, retaining their real order.
 const tables=[...added.sql.matchAll(/\bCREATE TABLE\s+([a-z_]+)/gi)].map(match=>match[1]);
 const reference=new RegExp(`\\b(?:ON|REFERENCES|ALTER TABLE)\\s+(?:${tables.join('|')})\\b`,'i');
 const dependent=migrations.filter(m=>m!==added&&reference.test(m.sql));
 for(const migration of migrations.filter(m=>m!==added&&!dependent.includes(m)))prior.exec(migration.sql);prior.exec('PRAGMA foreign_keys=OFF');const triggers=prior.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();for(const trigger of triggers)prior.exec(`DROP TRIGGER ${quote(trigger.name)}`);const before=new Map();
 for(const {name}of prior.prepare(tableQuery).all()){if(name==='sqlite_sequence')continue;const columns=prior.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>c.name),selected=columns.map(quote).join(','),rows=source.prepare(`SELECT ${selected} FROM ${quote(name)}`).all();prior.exec(`DELETE FROM ${quote(name)}`);for(const row of rows)prior.prepare(`INSERT INTO ${quote(name)}(${selected}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));before.set(name,{selected,rows});}
 for(const trigger of triggers)prior.exec(trigger.sql);prior.exec(added.sql);for(const migration of dependent)prior.exec(migration.sql);for(const [name,{selected,rows}]of before)assert.deepEqual(prior.prepare(`SELECT ${selected} FROM ${quote(name)}`).all(),rows,`${name}: poll migration preserves populated prior rows`);for(const table of ['meeting_polls','poll_candidates','poll_participants','poll_votes','poll_vote_tokens'])assert.equal(prior.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
 await reminderUpgrade(source,migrations);
 const token=randomBytes(32).toString('base64url'),hash=randomBytes(32).toString('base64url');source.prepare("INSERT INTO poll_vote_tokens(participant_id,token_hash,created_at,updated_at) VALUES('poll_participants-1',?,'2026-10-07T00:00:00.000Z','2026-10-07T00:00:00.000Z')").run(hash);source.prepare("UPDATE delivery_outbox SET payload_json=json_set(payload_json,'$.pollLink',?)").run(`https://dial.example.test/poll/meeting_polls-1?token=${token}`);
 source.prepare("UPDATE meeting_polls SET reminder_offsets_json='[120,60]'").run();
 const reminderId='synthetic-dial-archive-poll-reminder';
 source.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
  VALUES(?,'mail_send','poll-reminder:poll_participants-1:60',?,'pending',0,'2026-10-07T00:00:00.000Z','2026-10-07T00:00:00.000Z','2026-10-07T00:00:00.000Z')`).run(reminderId,JSON.stringify({to:source.prepare("SELECT email FROM poll_participants WHERE id='poll_participants-1'").get().email,subject:'Planning reminder',text:`Choose your availability: https://dial.example.test/poll/meeting_polls-1?token=${token}`,pollId:'meeting_polls-1',pollParticipantId:'poll_participants-1',pollReminderOffsetMinutes:60}));
 return {token,hash,reminderId};
 }finally{prior.close();}}

async function reminderUpgrade(source,migrations){const prior=new DatabaseSync(':memory:');try{
 const added=migrations.find(m=>m.file==='core/0095_poll_reminders.sql');assert.ok(added,'the reminder migration exists');
 for(const migration of migrations.filter(m=>m!==added))prior.exec(migration.sql);
 prior.exec('PRAGMA foreign_keys=OFF');
 const triggers=prior.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();for(const trigger of triggers)prior.exec(`DROP TRIGGER ${quote(trigger.name)}`);
 const before=new Map();
 for(const {name}of prior.prepare(tableQuery).all()){if(name==='sqlite_sequence')continue;const columns=prior.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>c.name),selected=columns.map(quote).join(','),rows=source.prepare(`SELECT ${selected} FROM ${quote(name)}`).all();prior.exec(`DELETE FROM ${quote(name)}`);for(const row of rows)prior.prepare(`INSERT INTO ${quote(name)}(${selected}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));before.set(name,{selected,rows});}
 assert.ok(before.get('meeting_polls').rows.length,'the older database contains a real poll');assert.ok(before.get('poll_participants').rows.length,'the older poll has participants');
 for(const trigger of triggers)prior.exec(trigger.sql);prior.exec(added.sql);
 for(const [name,{selected,rows}]of before)assert.deepEqual(prior.prepare(`SELECT ${selected} FROM ${quote(name)}`).all(),rows,`${name}: reminder migration preserves populated prior facts`);
 assert.ok(prior.prepare('SELECT reminder_offsets_json FROM meeting_polls').all().every(row=>row.reminder_offsets_json==='[]'),'every existing poll keeps reminders disabled');
 }finally{prior.close();}}
