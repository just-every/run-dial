import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

test("OPER-002 migration preserves prior operator identity, session and authored data until explicit removal", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "dial-access-transition-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const config = "tests/operator-management/worker.wrangler.toml";
  const run = (args) => new Promise((done, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", "d1", "execute", "dial-operator-management-test", "--local", "--persist-to", temporary, "--config", config, ...args], { cwd: new URL("../", import.meta.url), env: process.env, stdio: "pipe" });
    let output = "", diagnostics = "";
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { diagnostics += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done(output) : reject(new Error((output + diagnostics).slice(-8000))));
  });
  const migrationDirectory = new URL("../migrations/core/", import.meta.url);
  const names = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql") && name < "0013").sort();
  const baseline = (await Promise.all(names.map((name) => readFile(new URL(name, migrationDirectory), "utf8")))).join("\n");
  const old = resolve(temporary, "prior.sql");
  await writeFile(old, baseline + `
    INSERT INTO operators VALUES ('prior-id','prior@example.test','prior@example.test','created','updated');
    INSERT INTO operator_sessions VALUES ('session-id','prior-id','session-hash','2099-01-01','seen',NULL,'created','updated');
    INSERT INTO magic_link_tokens VALUES ('link-id','prior-id','link-hash','2099-01-01',NULL,'created','updated');
    CREATE TABLE retained_authorship (operator_id TEXT REFERENCES operators(id), value TEXT);
    INSERT INTO retained_authorship VALUES ('prior-id','authored before upgrade');
    INSERT INTO calendar_connections(singleton_key,provider,status,authorised_by_operator_id,account_email,created_at,updated_at) VALUES ('default','google','disconnected','prior-id','calendar@example.test','created','updated');`);
  await run(["--file", old]);
  const snapshot = async () => JSON.parse(await run(["--json", "--command", "SELECT id,email,normalized_email,created_at,updated_at FROM operators; SELECT * FROM operator_sessions; SELECT * FROM magic_link_tokens; SELECT * FROM retained_authorship; SELECT * FROM calendar_connections;"])).map((result) => result.results);
  const before = await snapshot();
  await run(["--file", "migrations/core/0013_operator_access.sql"]);
  assert.deepEqual(await snapshot(), before, "forward upgrade preserves every prior value");
  const setup = JSON.parse(await run(["--json", "--command", "SELECT * FROM operator_setup_identity;"]));
  assert.deepEqual(setup[0].results, [], "migration invents no setup authority");
  await run(["--command", "UPDATE operators SET removed_at = 'removed', updated_at = 'removed' WHERE id = 'prior-id';"]);
  const after = await snapshot();
  assert.deepEqual(after[3], before[3]); assert.deepEqual(after[4], before[4], "removal preserves the actual deployment calendar connection"); assert.equal(after[0][0].id, "prior-id");
  assert.equal(after[1][0].revoked_at, "removed"); assert.equal(after[2][0].consumed_at, "removed");
  const googleBefore = await snapshot();
  await run(["--file", "migrations/core/0084_microsoft_calendar.sql"]);
  assert.deepEqual(await snapshot(), googleBefore, "Microsoft provider upgrade preserves the populated prior connection and authored rows");
  await run(["--command", "UPDATE calendar_connections SET provider='microsoft' WHERE singleton_key='default';"]);
  const microsoft = await snapshot();
  assert.equal(microsoft[4][0].provider, "microsoft");
  assert.deepEqual({ ...microsoft[4][0], provider: "google" }, googleBefore[4][0]);

});
