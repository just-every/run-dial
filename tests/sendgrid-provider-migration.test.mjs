import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

test("0018 native D1 preserves full prior provider rows, unrelated data, constraints and indexes", async t => {
  const state = await mkdtemp(resolve(tmpdir(), "dial-0018-upgrade-")); t.after(() => rm(state, { recursive: true, force: true }));
  const run = args => new Promise((done, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", "d1", "execute", "dial-provider-runtime-test", "--local", "--persist-to", state, "--config", "tests/providers-worker.wrangler.toml", ...args], { stdio: "pipe", env: { ...process.env, CI: "1" } });
    let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject); child.on("exit", code => code === 0 ? done(output) : reject(new Error(output)));
  });
  const prior = (await Promise.all((await readdir("migrations/core")).filter(name => name < "0018").sort().map(name => readFile(`migrations/core/${name}`, "utf8")))).join("\n");
  const file = resolve(state, "prior.sql");
  await writeFile(file, prior + `
    INSERT INTO provider_connection_health VALUES('google_calendar','healthy','checked-g',NULL,'healthy_announced',4,'created-g','updated-g'),('resend','unhealthy','checked-r','forbidden','unhealthy_announced',7,'created-r','updated-r');
    INSERT INTO provider_webhook_events VALUES('g','google_calendar','ge','occurred-g','received-g','processed-g','processed','hash-g'),('r','resend','re',NULL,'received-r',NULL,'received','hash-r');
    INSERT INTO public_rate_events VALUES('g','client-g',1,0,'google_calendar',11,22,'created-g','updated-g'),('r','client-r',0,1,'resend',33,44,'created-r','updated-r'),('n','client-n',0,0,NULL,55,66,'created-n','updated-n');
    INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES('unrelated','mail_send','retained','{"to":"owner@example.test"}','pending',0,'future','created','updated');
    INSERT INTO base_mail_dispatch VALUES('prior-send','retained-payload','accepted',NULL,'updated');`);
  await run(["--file", file]);
  const query = async sql => JSON.parse(await run(["--json", "--command", sql])).map(item => item.results);
  const select = "SELECT * FROM provider_connection_health ORDER BY provider; SELECT * FROM provider_webhook_events ORDER BY id; SELECT * FROM public_rate_events ORDER BY id; SELECT * FROM delivery_outbox; SELECT * FROM base_mail_dispatch;";
  const before = await query(select);
  const indexes = await query("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='public_rate_events' ORDER BY name");
  await run(["--file", "migrations/core/0018_sendgrid_provider_identity.sql"]);
  assert.deepEqual(await query(select), before);
  assert.deepEqual(await query("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='public_rate_events' ORDER BY name"), indexes);
  await run(["--command", "INSERT INTO provider_connection_health VALUES('sendgrid','healthy','now',NULL,'unannounced',0,'created','updated'); INSERT INTO provider_webhook_events VALUES('s','sendgrid','se',NULL,'received',NULL,'received','hash'); INSERT INTO public_rate_events VALUES('s','sendgrid-client',0,0,'sendgrid',1,2,'created','updated');"]);
  assert.deepEqual(await query("SELECT provider FROM provider_connection_health WHERE provider='sendgrid'; PRAGMA foreign_key_check;"), [[{ provider: "sendgrid" }], []]);
  for (const sql of [
    "UPDATE provider_connection_health SET provider='unknown' WHERE provider='sendgrid'",
    "UPDATE provider_connection_health SET status='unknown' WHERE provider='sendgrid'",
    "UPDATE provider_connection_health SET alert_cycle=-1 WHERE provider='sendgrid'",
    "UPDATE provider_webhook_events SET state='unknown' WHERE id='s'",
    "INSERT INTO provider_webhook_events SELECT 'duplicate',provider,provider_event_id,occurred_at,received_at,processed_at,state,payload_hash FROM provider_webhook_events WHERE id='s'",
    "UPDATE public_rate_events SET booking_mutation=2 WHERE id='s'",
    "UPDATE public_rate_events SET alternative_submission=2 WHERE id='s'",
    "UPDATE public_rate_events SET provider='unknown' WHERE id='s'",
  ]) await assert.rejects(run(["--command", sql]), /constraint|CHECK|UNIQUE/i);
});
