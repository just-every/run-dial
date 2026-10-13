import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

test("OPER-002 invocation journal upgrade preserves prior notifications and erasure custody", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "dial-invocation-upgrade-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const run = (args) => new Promise((done, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", "d1", "execute", "dial-operator-mail-order-test", "--local", "--persist-to", temporary, "--config", "tests/operator-mail-order/worker.wrangler.toml", ...args], { cwd: new URL("../", import.meta.url), env: process.env, stdio: "pipe" });
    let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done(output) : reject(new Error(output)));
  });
  const directory = new URL("../migrations/core/", import.meta.url);
  const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql") && file < "0014").sort();
  const prior = (await Promise.all(migrations.map((file) => readFile(new URL(file, directory), "utf8")))).join("\n");
  const input = resolve(temporary, "prior.sql");
  await writeFile(input, prior + `
    INSERT INTO operators(id,email,normalized_email,created_at,updated_at) VALUES ('prior','prior@example.test','prior@example.test','created','updated');
    INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,last_error_code,created_at,updated_at)
      VALUES ('prior-command','mail_send','prior-key','{"to":"prior@example.test","recipientRole":"operator","wireMail":{"to":"prior@example.test","subject":"frozen","text":"prior message","idempotencyKey":"prior-key"}}','failed',1,'2000','provider_timeout','created','updated');
    INSERT INTO delivery_attempts(id,outbox_id,attempt_number,outcome,error_code,attempted_at) VALUES ('prior-attempt','prior-command',1,'failed','provider_timeout','attempted');`);
  await run(["--file", input]);
  const query = async (command) => JSON.parse(await run(["--json", "--command", command])).map((result) => result.results);
  const before = await query("SELECT * FROM operators; SELECT * FROM delivery_outbox; SELECT * FROM delivery_attempts;");
  await run(["--file", "migrations/core/0014_operator_mail_invocations.sql"]);
  assert.deepEqual(await query("SELECT * FROM operators; SELECT * FROM delivery_outbox; SELECT * FROM delivery_attempts;"), before);
  assert.deepEqual(await query("SELECT * FROM operator_mail_invocations; PRAGMA foreign_key_check;"), [[], []]);
  await run(["--command", "INSERT INTO operator_mail_invocations(outbox_id,attempt_number,provider_key,state,started_at) VALUES ('prior-command',2,'prior-key','invoking','started');"]);
  assert.equal((await query("SELECT * FROM operator_mail_invocations;"))[0][0].state, "invoking");
  await run(["--command", "DELETE FROM delivery_outbox WHERE id = 'prior-command';"]);
  assert.deepEqual(await query("SELECT * FROM operator_mail_invocations; SELECT * FROM delivery_attempts; PRAGMA foreign_key_check;"), [[], [], []]);
  await run(["--command", "INSERT INTO operators(id,email,normalized_email,removed_at,created_at,updated_at) VALUES ('former','former@example.test','former@example.test','removed-before-upgrade','created','updated');"]);
  const operators = await query("SELECT id,email,normalized_email,removed_at,created_at,updated_at FROM operators;");
  await run(["--file", "migrations/core/0015_operator_notification_generation.sql"]);
  assert.deepEqual(await query("SELECT id,email,normalized_email,removed_at,created_at,updated_at FROM operators;"), operators);
  assert.deepEqual((await query("SELECT id,access_generation FROM operators ORDER BY id;"))[0], [{ id: "former", access_generation: 1 }, { id: "prior", access_generation: 0 }]);
  await run(["--command", "UPDATE operators SET removed_at = 'removed' WHERE id = 'prior'; UPDATE operators SET removed_at = NULL WHERE id = 'prior';"]);
  assert.equal((await query("SELECT access_generation FROM operators WHERE id = 'prior';"))[0][0].access_generation, 1);
  await run(["--command", `INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES
    ('delayed','mail_send','delayed','{"to":"prior@example.test","recipientRole":"operator","operatorAccess":{"id":"prior","generation":0}}','pending',0,'2000','created','updated'),
    ('legacy','mail_send','connection:resend:old:operator:prior','{"to":"prior@example.test"}','pending',0,'2000','created','updated'),
    ('fresh','mail_send','fresh','{"to":"prior@example.test","recipientRole":"operator","operatorAccess":{"id":"prior","generation":1}}','pending',0,'2000','created','updated');`]);
  const [rows] = await query("SELECT id,state,last_error_code FROM delivery_outbox ORDER BY id;");
  assert.deepEqual(rows, [
    { id: "delayed", state: "failed", last_error_code: "operator_removed" },
    { id: "fresh", state: "pending", last_error_code: null },
    { id: "legacy", state: "failed", last_error_code: "operator_removed" },
  ]);
  assert.deepEqual(await query("PRAGMA foreign_key_check;"), [[]]);
});
