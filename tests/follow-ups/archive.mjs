import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrationFiles, tableQuery } from "../../scripts/archive/schema.mjs";
export async function followUpUpgrade(source) {
  const prior = new DatabaseSync(":memory:"), migrations = await migrationFiles(), upgrade = migrations.find(row => row.file.endsWith("_post_meeting_follow_ups.sql")); assert.ok(upgrade);
  try {
    for (const migration of migrations.filter(row => row !== upgrade)) prior.exec(migration.sql);
    prior.exec("PRAGMA foreign_keys=OFF"); const triggers = prior.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all(); for (const trigger of triggers) prior.exec(`DROP TRIGGER "${trigger.name}"`);
    const before = [];
    for (const { name } of prior.prepare(tableQuery).all()) {
      if (name === "sqlite_sequence") continue; const columns = prior.prepare(`PRAGMA table_info("${name}")`).all().map(column => column.name), fields = columns.map(column => `"${column}"`).join(","), rows = source.prepare(`SELECT ${fields} FROM "${name}"`).all();
      prior.exec(`DELETE FROM "${name}"`); for (const row of rows) prior.prepare(`INSERT INTO "${name}" (${fields}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map(column => row[column])); before.push({ name, fields, rows });
    }
    for (const trigger of triggers) prior.exec(trigger.sql); prior.exec(upgrade.sql);
    for (const { name, fields, rows } of before) assert.deepEqual(prior.prepare(`SELECT ${fields} FROM "${name}"`).all(), rows, `${name}: the follow-up migration preserves populated prior records`);
    for (const table of ["event_follow_up_settings", "follow_up_runs"]) assert.equal(prior.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table}: no retroactive outbound job is invented`);
  } finally { prior.close(); }
  const booking = source.prepare("SELECT id,current_occurrence_id AS occurrenceId,event_type_id AS eventId FROM bookings LIMIT 1").get(), now = "2026-10-07T00:00:00.000Z";
  source.prepare("UPDATE event_follow_up_settings SET enabled=1,kind='rebooking',message_text='Synthetic resources 1740 for {invitee first name}',target_event_type_id=?").run(booking.eventId);
  source.prepare("INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,succeeded_at,created_at,updated_at) VALUES ('synthetic-dial-1741','mail_send','synthetic-dial-1741',?,?,?,'succeeded',1,?,?,?,?)").run(booking.id,booking.occurrenceId,JSON.stringify({to:"synthetic-dial-1742@example.test",recipientRole:"invitee",messageKind:"follow_up",subject:"Synthetic follow-up",text:"Synthetic resources 1740"}),now,now,now,now);
  source.prepare("UPDATE follow_up_runs SET state='queued',reason=NULL,outbox_id='synthetic-dial-1741'").run();
}
export function assertFollowUpArchive(source, target) {
  assert.deepEqual(target.prepare("SELECT * FROM event_follow_up_settings").all(),source.prepare("SELECT * FROM event_follow_up_settings").all(),"follow-up settings and the next-event selection round-trip");
  const runs=target.prepare("SELECT r.archive_historical AS historical,r.state,r.outbox_id AS outboxId,d.state AS deliveryState FROM follow_up_runs r LEFT JOIN delivery_outbox d ON d.id=r.outbox_id").all(); assert.ok(runs.length);
  assert.ok(runs.every(run=>run.historical===1&&run.deliveryState==="succeeded"&&run.state==="queued"),"restored sent history retains its outcome but no run can regain sending authority");
}
