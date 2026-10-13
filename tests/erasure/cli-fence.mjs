import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openInstall } from '../archive/operator-runtime.mjs';
import { run } from '../archive/transfer.mjs';
import { archiveDiagnostic } from '../archive/command-diagnostics.mjs';
import { spawnOwned } from '../native-process/lifecycle.mjs';
import { environment } from '../local-setup/runtime.mjs';
import { exported, excluded } from '../../scripts/archive/policy.mjs';
import { readArchive } from '../../scripts/base-cli/modules/portability/index.mjs';
import { containsPersonal } from './scan.mjs';

const trustTables = ['rer_portability_state', 'rer_portability_epochs', 'rer_portability_journal'];
async function trustedRows(db) {
  const trust = {};
  for (const table of trustTables) trust[table] = (await db.prepare(`SELECT * FROM ${table}`).all()).results
    .map(row => JSON.stringify(row)).sort();
  return JSON.stringify(trust);
}
async function emptyDestinationTrust(root) {
  const install = await openInstall(root);
  try {
    for (const table of [...exported, ...Object.keys(excluded)]) assert.equal((await install.env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0, `${table}: protected destination remains empty`);
    assert.ok((await install.env.DB.prepare('SELECT count(*) AS n FROM rer_portability_journal').first()).n > 0, 'destination retains a genuine erasure journal');
    const state = await install.env.DB.prepare('SELECT import_job, applying FROM rer_portability_state WHERE id=1').first();
    assert.ok(state?.import_job === null && state.applying === 0, 'protected destination has no active import');
    return await trustedRows(install.env.DB);
  } finally { await install.dispose(); }
}

/** Actual reset, followed only by restoring already-trusted privacy metadata.
 * No source person rows or fake journal entries are carried into the empty store. */
export async function resetRetainingJournal(root) {
  let install = await openInstall(root);
  const trust = {};
  try {
    for (const table of trustTables) trust[table] = (await install.env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
    assert.ok(trust.rer_portability_journal.length > 0);
  } finally { await install.dispose(); }
  const settings = await readFile(join(root, '.dev.vars'));
  await run(root, ['reset', '--yes']);
  await writeFile(join(root, '.dev.vars'), settings, { mode: 0o600 });
  await run(root, ['export', '--target', 'local', '--output', `exports/reset-${crypto.randomUUID()}.rer`]);
  install = await openInstall(root);
  try {
    const db = install.env.DB;
    for (const table of [...exported, ...Object.keys(excluded)]) assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0, `${table}: reset destination is empty`);
    const statements = [];
    for (const [table, rows] of Object.entries(trust)) {
      statements.push(db.prepare(`DELETE FROM ${table}`));
      for (const row of rows) statements.push(db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?')})`).bind(...Object.values(row)));
    }
    await db.batch(statements);
  } finally { await install.dispose(); }
}
export async function refuseOldArchive(root, input) {
  const before = await emptyDestinationTrust(root);
  let output = '', cleanupFailed = false;
  const process = spawnOwned(globalThis.process.execPath, ['scripts/rer.mjs', 'import', '--target', 'local', '--input', input, '--yes', '--non-interactive', '--json'], { cwd: root, env: environment() }, { label: 'protected old archive import', onOutput: chunk => { output += chunk; } });
  try {
    try { await process.waitForClose(180000); } catch { /* expected command refusal; inspect exact reason below */ }
  } finally {
    try { await process.stop(); }
    catch { cleanupFailed = true; }
  }
  if (cleanupFailed) throw new Error(`Native old archive cleanup failed: ${JSON.stringify(archiveDiagnostic(output, 'import', process.state, 'cleanup'))}`);
  assert.ok(await emptyDestinationTrust(root) === before, 'refused archive preserves trusted source identity, epochs and journal exactly');
  const diagnostic = archiveDiagnostic(output, 'import', process.state);
  const safe = JSON.stringify(diagnostic);
  assert.equal(process.state.code, 4, `native CLI refuses unsafe archive: ${safe}`);
  assert.ok(diagnostic.closed === 1 && diagnostic.exited === 1 && diagnostic.signal === null, `native refusal exits and closes normally: ${safe}`);
  assert.ok(['transfer_failed', 'restore_refused'].includes(diagnostic.code), `native archive refusal is classified: ${safe}`);
  assert.ok(['erasure_epoch', 'erased_row'].includes(diagnostic.reason), `refusal is the privacy fence: ${safe}`);
  assert.equal(diagnostic.destinationNonempty, 0, 'refusal is not destination nonemptiness');
}
export async function scanArchive(path, markers) {
  const bytes = await readFile(path);
  const binaries = new Map();
  for await (const record of readArchive(new Blob([bytes]).stream())) {
    assert.equal(containsPersonal(record, markers), false, 'export retained a personal value');
    if (record.kind === 'part') for (const item of record.items) if (item.kind === 'object' || item.kind === 'payload') {
      const key = JSON.stringify([item.kind,item.bucket,item.key,item.name]);
      if (!binaries.has(key)) binaries.set(key, []);
      binaries.get(key).push(item);
    }
  }
  for (const chunks of binaries.values()) {
    const data = Buffer.concat(chunks.sort((a,b) => a.offset - b.offset).map(item => Buffer.from(item.data,'base64')));
    assert.equal(containsPersonal(data.toString('utf8'), markers), false, 'exported object or payload retained personal bytes across chunk boundaries');
  }
}
