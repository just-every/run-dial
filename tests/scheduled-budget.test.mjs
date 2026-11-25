import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";

const require = createRequire(import.meta.resolve("wrangler"));
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare")));
const root = new URL("../", import.meta.url), day = 86400000, ceiling = 250;

test("the minute Cron reads a flat number of D1 rows however much history a company has stored", async () => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL("tests/scheduled-budget/worker.mjs", root))], bundle: true, format: "esm", platform: "browser", write: false,
    external: ["cloudflare:*", "node:*"], conditions: ["workerd", "worker", "browser"], jsx: "automatic", loader: { ".svg": "text" } });
  const state = await mkdtemp(join(tmpdir(), "dial-scheduled-budget-"));
  const runtime = { ENVIRONMENT: "development", APP_URL: "http://localhost:8787", SESSION_SECRET: "s".repeat(40), MAIL_PROVIDER: "development", AUTH_LOCAL: "true" };
  const mf = new Miniflare({ cf: false, resourcePersistencePath: state, workers: [{ config: {
    type: "worker", name: "scheduled-budget", compatibilityDate: "2026-09-08", compatibilityFlags: ["nodejs_compat"],
    env: { DB: { type: "d1", id: "scheduled-budget" }, ...Object.fromEntries(Object.entries(runtime).map(([name, value]) => [name, { type: "text", value }])) },
    manifest: { mainModule: "worker.mjs", modulesRoot: state, modules: { "worker.mjs": { type: "esm", contents: compiled.outputFiles[0].text } } },
  } }] });
  try {
    const db = await mf.getD1Database("DB");
    const directory = fileURLToPath(new URL("migrations/core/", root));
    for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort())
      await db.batch(splitSqlQuery(await readFile(directory + file, "utf8")).map(statement => db.prepare(statement)));

    // A company at defaults: 90 days of ten confirmed bookings a day, each already served by its workflow rule,
    // its Slack notice, its refund and a poll with reminders that has since closed.
    const now = Date.now(), iso = at => new Date(at).toISOString(), pending = [];
    const add = (sql, ...values) => pending.push(db.prepare(sql).bind(...values));
    const flush = async () => { for (let i = 0; i < pending.length; i += 80) await db.batch(pending.slice(i, i + 80)); pending.length = 0; };
    add("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('o1','o@x.test','O','owner','active',0)");
    add("INSERT INTO event_types(id,status,slug,title,description,duration_minutes,color,location_type,location_label,created_at,updated_at) VALUES('et1','published','s','T','d',30,'c','online','l','t','t')");
    add("INSERT INTO workspace_notice_destinations(id,status,target,external_key,masked_tail,created_at,updated_at) VALUES('slack','connected','t','e','x','t','t')");
    add("INSERT INTO workflow_rules(id,name,event_type_id,operator_id,enabled,enabled_at,subject,text,created_at,updated_at) VALUES('wr1','n','et1','o1',1,?,'s','t',?,?)", iso(now - 91 * day), iso(now - 91 * day), iso(now - 91 * day));
    const booking = (id, at) => {
      add("INSERT INTO bookings(id,event_type_id,event_slug,event_title,duration_minutes,location_type,location_label,location_value,invitee_name,invitee_email,host_timezone,invitee_timezone,state,ical_uid,calendar_state,meeting_state,created_at,updated_at) VALUES(?,'et1','s','T',30,'online','l','v','n','e@x.test','UTC','UTC','confirmed',?,'succeeded','not_required',?,?)", id, `u${id}`, iso(at), iso(at));
      add("INSERT INTO booking_occurrences(id,booking_id,sequence,start_at,end_at,occupied_start_at,occupied_end_at,host_date,state,is_current,created_at) VALUES(?,?,0,?,?,?,?,?,'current',1,?)", `oc${id}`, id, iso(at + day), iso(at + day + 1800000), iso(at + day), iso(at + day + 1800000), iso(at + day).slice(0, 10), iso(at));
      add("UPDATE bookings SET current_occurrence_id=? WHERE id=?", `oc${id}`, id);
    };
    for (let d = 0; d < 90; d++) for (let i = 0; i < 10; i++) {
      const at = now - d * day - i * 60000 - 3600000, id = `b${d}_${i}`;
      booking(id, at);
      add("INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,state,next_attempt_at,payload_json,created_at,updated_at) VALUES(?,'mail_send',?,?,'succeeded',?,'{}',?,?)", `ob${id}`, `k${id}`, id, iso(at), iso(at), iso(at));
      add("INSERT INTO workflow_dispatches(id,workflow_id,booking_id,outbox_id,workflow_version,created_at) VALUES(?,'wr1',?,?,1,?)", `wd${id}`, id, `ob${id}`, iso(at));
      add("INSERT INTO workspace_notice_deliveries(id,destination_id,generation,account_id,channel_id,booking_id,occurrence_id,event_kind,idempotency_key,state,next_attempt_at,created_at,updated_at) VALUES(?,'slack',1,'a','c',?,?,'created',?,'succeeded',?,?,?)", `wn${id}`, id, `oc${id}`, `wnk${id}`, iso(at), iso(at), iso(at));
      add("INSERT INTO payment_movements(id,booking_id,kind,amount_cents,status,actor_type,reason,account_id,idempotency_key,created_at,updated_at) VALUES(?,?,'refund',1000,'succeeded','policy','r','acct',?,?,?)", `pm${id}`, id, `pk${id}`, iso(at), iso(at));
    }
    for (let d = 1; d < 90; d++) {
      const id = `p${d}`, at = now - d * day;
      add("INSERT INTO meeting_polls(id,event_type_id,title,closes_at,state,created_at,updated_at,reminder_offsets_json) VALUES(?,'et1','t',?,'closed',?,?,'[60]')", id, iso(at + day / 2), iso(at), iso(at));
      for (let k = 0; k < 3; k++) {
        add("INSERT INTO poll_participants(id,poll_id,name,email,revision,created_at,updated_at) VALUES(?,?,'n',?,0,?,?)", `${id}_${k}`, id, `${id}_${k}@x.test`, iso(at), iso(at));
        add("INSERT INTO poll_vote_tokens(participant_id,token_hash,created_at,updated_at) VALUES(?,?,?,?)", `${id}_${k}`, `h${id}_${k}`, iso(at), iso(at));
      }
    }
    await flush();

    const cron = async () => (await (await mf.dispatchFetch("http://cron.test/")).json()).rowsRead;
    await cron();
    const steady = await cron();
    assert.ok(steady < ceiling, `a steady run read ${steady} rows over 90 days of history; the ceiling is ${ceiling}`);

    // The newest booking still reaches its workflow, and finding it stays inside the same budget.
    booking("fresh", now);
    await flush();
    const served = await cron();
    assert.ok(served < ceiling, `a run that queues a workflow mail read ${served} rows; the ceiling is ${ceiling}`);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM workflow_dispatches WHERE booking_id='fresh'").first()).n, 1, "the booking made after the history is served");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM delivery_outbox WHERE idempotency_key='workflow:wr1:fresh'").first()).n, 1);
  } finally { await mf.dispose(); await rm(state, { recursive: true, force: true }); }
});
