import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fixture } from './archive/fixture.mjs';
import { openInstall } from './archive/operator-runtime.mjs';
import { quote, restoreStatements } from '../scripts/archive/schema.mjs';
import { internal } from '../scripts/archive/policy.mjs';
import { foldBookingSearch } from '../src/core/features/bookings/search/case-fold.mjs';

// A populated upgrade is high-stakes data work, separate from the single OPER-003 journey.
test('native D1 migration upgrades populated pre-0030 data without changing any installed value, then searches Unicode through HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dial-search-upgrade-'));
  const source = await fixture();
  let runtime;
  try {
    await mkdir(join(root, 'migrations'));
    const directory = new URL('../migrations/core/', import.meta.url);
    const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
    // These are the unchanged 0001–0029 migration bytes installed at initial head 91c27cd.
    const prior = names.filter(name => name < '0030');
    for (const name of prior) await cp(new URL(name, directory), join(root, 'migrations', name));
    await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({
      name: 'dial-search-upgrade', compatibility_date: '2026-09-08',
      d1_databases: [{ binding: 'DB', database_name: 'dial-upgrade', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: 'migrations' }],
    }));
    await writeFile(join(root, '.dev.vars'), [
      'ENVIRONMENT=development', 'APP_URL=http://127.0.0.1', 'OWNER_EMAIL=owner@example.test',
      'MAIL_PROVIDER=development', 'MAIL_FROM=noreply@example.test',
      'SESSION_SECRET=synthetic-search-upgrade-session-secret-at-least-32',
      'SETUP_TOKEN=synthetic-search-upgrade-setup-token-at-least-32',
    ].join('\n'), { mode: 0o600 });
    await migrate(root);
    runtime = await openInstall(root);
    const db = runtime.env.DB;
    const catalog = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results;
    const tables = catalog.filter(({ name }) => !Object.hasOwn(internal, name));
    const columns = {};
    const values = [];
    for (const { name } of tables) {
      columns[name] = (await db.prepare(`PRAGMA table_info(${quote(name)})`).all()).results.map(column => column.name);
      values.push({ name, rows: source.db.prepare(`SELECT ${columns[name].map(quote).join(',')} FROM ${quote(name)}`).all() });
    }
    const triggers = (await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).results;
    await db.batch(restoreStatements(values, triggers).map(({ sql, params }) => db.prepare(sql).bind(...params)));
    await db.prepare("UPDATE bookings SET invitee_name=? WHERE id='bookings-1'").bind('Prior Straße ẞ Σςσ\0Élodie').run();
    const before = await snapshot(db, columns);
    await runtime.dispose(); runtime = undefined;

    for (const name of names.filter(name => name >= '0030')) await cp(new URL(name, directory), join(root, 'migrations', name));
    await migrate(root);
    runtime = await openInstall(root);
    const after = await snapshot(runtime.env.DB, columns);
    for (const name of Object.keys(before)) assert.ok(JSON.stringify(after[name]) === JSON.stringify(before[name]), `Every installed ${name} value survives the forward migration`);
    const row = await runtime.env.DB.prepare("SELECT invitee_name,invitee_email,invitee_name_folded,invitee_email_folded FROM bookings WHERE id='bookings-1'").first();
    assert.equal(row.invitee_name_folded, foldBookingSearch(row.invitee_name));
    assert.equal(row.invitee_email_folded, foldBookingSearch(row.invitee_email));
    assert.equal((await runtime.env.DB.prepare('SELECT count(*) AS n FROM bookings b JOIN booking_occurrences o ON b.current_occurrence_id=o.id').first()).n, 1, 'the prior booking retains its current occurrence');
    const authority = await runtime.signIn();
    for (const query of ['STRASSE', 'ςςς', '\0élodie']) {
      const response = await runtime.request('/api/app/bookings?' + new URLSearchParams({ query }), { cookie: authority.cookie });
      assert.equal(response.status, 200);
      const records = await response.json();
      assert.deepEqual(records.map(booking => booking.id), ['bookings-1'], `Upgrade search ${JSON.stringify(query)}`);
      assert.equal(records[0].inviteeName, row.invitee_name);
    }
    const history = (await runtime.env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map(row => row.name);
    console.log(`Actual native migration ledger after upgrade: ${history.join(', ')}.`);
    console.log(`Populated native D1 upgrade: ${prior.length} prior migrations, ${tables.length} prior tables checked (${values.filter(table => table.rows.length).length} populated), every prior column retained; Unicode HTTP searches passed.`);
  } finally {
    await runtime?.dispose(); source.db.close(); await rm(root, { recursive: true, force: true });
  }
});

async function snapshot(db, columns) {
  const result = {};
  for (const [name, selected] of Object.entries(columns)) result[name] = (await db.prepare(`SELECT ${selected.map(quote).join(',')} FROM ${quote(name)}`).all()).results
    .map(row => Object.fromEntries(selected.map(column => [column, row[column]]))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
}

async function migrate(root) {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'dial-upgrade', '--local', '--persist-to', join(root, '.wrangler/state'), '--config', join(root, 'wrangler.jsonc')], {
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' }, stdio: 'pipe',
    });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Native Wrangler migration failed (${code}): ${output.slice(-2000)}`)));
  });
}
