import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readArchive } from '@runeditrun/rer/modules/portability';
import { contract } from './contract.mjs';
import { checkout, run } from './archive/transfer.mjs';
import { platformLedgerDdl } from './archive/deployed-fixture.mjs';
import { storageState } from './archive/storage-state.mjs';
import { quote } from '../scripts/archive/schema.mjs';
import { splitSqlStatements } from '../scripts/delivery/base/sql-statements.mjs';

// A native backup the listed release (bb5d650f, migrations up to 0061) made of a
// populated install with two files, retained unchanged. Its owner-held salt is synthetic.
const fixture = new URL('./fixtures/archive/listed-bb5d650f.rer', import.meta.url);
const deploymentSpec = new URL('../management/integration/deployment-spec.json', import.meta.url);
const salt = 'synthetic-qualification-owner-salt';
const sorted = row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a < b ? -1 : 1)));
const local = root => ({ configPath: join(root, 'wrangler.toml'), persist: { path: join(root, '.wrangler/state/v3') }, remoteBindings: false });
// 0063 and 0064 turn confirmation and invitation access on for older correspondence.
function confirmed(table, row) {
  if (!['event_correspondence', 'booking_correspondence'].includes(table)) return row;
  const templates = JSON.parse(row.templates_json);
  return { ...row, templates_json: JSON.stringify({ ...templates, inviteeConfirmationEnabled: templates.inviteeConfirmationEnabled ?? true, invitationManageLinkEnabled: templates.invitationManageLinkEnabled ?? true }) };
}
// Run Edit Run Platform's runner applies each deployment-spec migration in one D1
// request that first records its name and hash in rer_migrations (platform
// src/integrations/migration-batch.ts), using the same statement splitter; it never
// creates Wrangler's ledger. Its effect stands in for the hosted service here.
async function platformMigrations(root, getPlatformProxy) {
  execFileSync(process.execPath, ['scripts/render-wrangler.mjs'], { cwd: root, stdio: 'pipe' });
  const { migrations } = JSON.parse(await readFile(deploymentSpec, 'utf8'));
  const proxy = await getPlatformProxy(local(root));
  try {
    const { DB } = proxy.env;
    await DB.prepare(platformLedgerDdl).run();
    for (const { name, sha256, sql } of migrations) await DB.batch([DB.prepare('INSERT INTO rer_migrations(name,sha256) VALUES (?,?)').bind(name, sha256), ...splitSqlStatements(sql).map(statement => DB.prepare(statement))]);
  } finally { await proxy.dispose(); }
}

contract('DATA-001', 'a backup made by the listed release restores through rer import with every archived value and file, under either migration ledger', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dial-prior-backup-'));
  const { getPlatformProxy } = await import('wrangler');
  const records = []; for await (const record of readArchive(new Blob([await readFile(fixture)]).stream())) records.push(record);
  const [manifest] = records, items = records.filter(record => record.kind === 'part').flatMap(record => record.items);
  let proxy;
  try {
    for (const platform of [false, true]) {
      const label = platform ? 'Platform' : 'native', root = join(directory, label);
      await checkout(root);
      const settings = await readFile(join(root, '.dev.vars'), 'utf8');
      await writeFile(join(root, '.dev.vars'), settings.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${salt}`), { mode: 0o600 });
      // A native destination is empty, and import prepares its schema with Wrangler.
      if (platform) await platformMigrations(root, getPlatformProxy);
      // rer import reads only an owner-private input, whatever mode the checkout gave the fixture.
      await copyFile(fixture, join(root, 'exports/prior.rer')); await chmod(join(root, 'exports/prior.rer'), 0o600);
      await run(root, ['import', '--target', 'local', '--input', 'exports/prior.rer', '--yes']);
      // The restored installation backs up again through the same door.
      await run(root, ['export', '--target', 'local', '--output', 'exports/restored.rer']);

      proxy = await getPlatformProxy(local(root));
      const { DB, FILES } = proxy.env;
      let rows = 0;
      for (const table of manifest.tables) {
        const archived = table.columns.map(column => column.name);
        const columns = (await DB.prepare(`PRAGMA table_info(${quote(table.name)})`).all()).results.map(column => column.name);
        const expected = items.filter(item => item.kind === 'row' && item.table === table.name).map(item => sorted(confirmed(table.name, item.row))).sort();
        const actual = (await DB.prepare(`SELECT ${archived.map(quote).join(',')} FROM ${quote(table.name)}`).all()).results.map(sorted).sort();
        assert.deepEqual(actual, expected, `${label}: every archived value: ${table.name}`);
        // Columns added after the backup (0062) hold their default for restored rows.
        for (const column of columns.filter(name => !archived.includes(name))) {
          const defaultValue = ['event_types', 'bookings'].includes(table.name) && column === 'guest_limit' ? 0 : null;
          assert.equal((await DB.prepare(`SELECT count(*) AS n FROM ${quote(table.name)} WHERE ${quote(column)} IS NOT ?`).bind(defaultValue).first()).n, 0, `${label}: ${table.name}.${column} has its additive default`);
        }
        rows += expected.length;
      }
      assert.ok(rows > 60, 'the backup is populated');
      assert.equal(manifest.objects.length, 2);
      for (const object of manifest.objects) {
        const stored = await FILES.get(object.key); assert.ok(stored, object.key);
        const chunks = items.filter(item => item.kind === 'object' && item.key === object.key).sort((a, b) => a.offset - b.offset);
        assert.deepEqual(Buffer.from(await stored.arrayBuffer()), Buffer.concat(chunks.map(item => Buffer.from(item.data, 'base64'))), `${label}: ${object.key}`);
        assert.equal(stored.httpMetadata.contentType, object.httpMetadata.contentType, `${label}: ${object.key}`);
      }
      assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
      assert.deepEqual((await DB.prepare('SELECT * FROM calendar_connection_health_changes').all()).results, [], 'an older backup cannot invent past connection-health facts');
      // Each runner stays the only migration authority of its installation: Wrangler never adds its ledger beside Platform's.
      const ledgers = (await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rer_migrations','d1_migrations','_rer_deploy_migrations')").all()).results.map(row => row.name);
      assert.deepEqual(ledgers, [platform ? 'rer_migrations' : 'd1_migrations'], `${label} ledger`);
      await proxy.dispose(); proxy = undefined;
    }
  } finally {
    await proxy?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [shape, statements] of [
  ['missing a required column', ['ALTER TABLE rer_migrations DROP COLUMN applied_at']],
  ['with an extra column', ['ALTER TABLE rer_migrations ADD COLUMN unknown_note TEXT']],
  ['with a wrong-type nullable timestamp holding NULL', [
    'ALTER TABLE rer_migrations RENAME TO prior_ledger',
    'CREATE TABLE rer_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER)',
    'INSERT INTO rer_migrations(name,sha256) SELECT name,sha256 FROM prior_ledger',
    'DROP TABLE prior_ledger',
  ]],
  ['applied in an impossible order (rowid reversed)', ['UPDATE rer_migrations SET rowid = -rowid']],
]) contract('DATA-001', `a Platform ledger ${shape} refuses export and import before any write, leaving storage unchanged`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dial-malformed-ledger-'));
  const { getPlatformProxy } = await import('wrangler');
  try {
    // Export is refused from a populated installation, import into an otherwise empty migrated one.
    // An import is tried with the prior-release backup and with a current archive this checkout exported before the ledger changed.
    const current = join(directory, 'current.rer');
    for (const [command, args, populate, input] of [['export', ['export', '--target', 'local', '--output', 'exports/probe.rer'], true], ['import', ['import', '--target', 'local', '--input', 'exports/prior.rer', '--yes'], false, fixture], ['import-current', ['import', '--target', 'local', '--input', 'exports/prior.rer', '--yes'], false, current]]) {
      const root = join(directory, command);
      await checkout(root);
      const settings = await readFile(join(root, '.dev.vars'), 'utf8');
      await writeFile(join(root, '.dev.vars'), settings.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${salt}`), { mode: 0o600 });
      await platformMigrations(root, getPlatformProxy);
      await copyFile(input ?? fixture, join(root, 'exports/prior.rer')); await chmod(join(root, 'exports/prior.rer'), 0o600);
      if (populate) {
        await run(root, ['import', '--target', 'local', '--input', 'exports/prior.rer', '--yes']);
        await run(root, ['export', '--target', 'local', '--output', 'exports/current.rer']);
        await copyFile(join(root, 'exports/current.rer'), current);
      }
      const proxy = await getPlatformProxy(local(root));
      try {
        // Portability's runtime lease table is created on first use, so none may already stand in for a write.
        await proxy.env.DB.prepare('DROP TABLE IF EXISTS rer_portability_import_leases').run();
        await proxy.env.DB.batch(statements.map(sql => proxy.env.DB.prepare(sql)));
      } finally { await proxy.dispose(); }
      const before = await storageState(root);
      await assert.rejects(run(root, args), /"exitCode":4/, `${command} is refused`);
      assert.deepEqual(await storageState(root), before, `${command}: no table, row or ledger changed`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
