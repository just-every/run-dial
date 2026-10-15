import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnOwned } from '../native-process/lifecycle.mjs';
import { environment } from './runtime.mjs';

// The local source already ran every migration through Wrangler. Give this
// disposable stand-in the hash-bearing ledger that rer's hosted installer
// records, after proving the names/order; no application SQL or data changes.
export async function hostedLedger(directory) {
 const migrations = [];
 const path = join(directory, 'migrations/core');
 for (const name of (await readdir(path)).filter(name => name.endsWith('.sql')).sort()) migrations.push({ name, sha256: createHash('sha256').update(await readFile(join(path, name))).digest('hex') });
 const execute = async sql => {
  let output = '';
  const child = spawnOwned(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'dial-local', '--local', '--persist-to', '.wrangler/state', '--config', 'wrangler.toml', '--command', sql, '--json'], { cwd: directory, env: environment() }, { label: 'hosted migration ledger fixture' });
  child.child.stdout.on('data', chunk => { output += chunk; });
  try { await child.waitForClose(60_000); return JSON.parse(output).at(-1).results; }
  catch { throw Error('Hosted ledger fixture failed; private diagnostics omitted.'); }
  finally { await child.stop(); }
 };
 assert.deepEqual(await execute('SELECT name FROM d1_migrations ORDER BY id'), migrations.map(({ name }) => ({ name })));
 const literal = value => "'" + value.replaceAll("'", "''") + "'";
 const rows = await execute('ALTER TABLE d1_migrations ADD COLUMN sha256 TEXT; ALTER TABLE d1_migrations ADD COLUMN state TEXT;' + migrations.map(row => `UPDATE d1_migrations SET sha256=${literal(row.sha256)},state='applied' WHERE name=${literal(row.name)};`).join('\n') + 'SELECT name,sha256,state FROM d1_migrations ORDER BY id;');
 assert.deepEqual(rows, migrations.map(row => ({ ...row, state: 'applied' })));
 return migrations.map(row => row.name);
}
