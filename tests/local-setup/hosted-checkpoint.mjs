import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnOwned } from '../native-process/lifecycle.mjs';
import { environment } from './runtime.mjs';

// This fixture edits only the disposable source checkout's local D1 store.
// The extra table makes snapshot preflight fail while cleanup must still work.
export async function checkpointState(directory, id, operation = 'inspect') {
 assert.match(id, /^[a-zA-Z0-9-]+$/);
 const mutation = operation === 'expire' ? `UPDATE dial_portability_admission SET expires_at=0 WHERE id='${id}' AND kind='export'; CREATE TABLE dial_expired_checkpoint_probe(value TEXT);`
  : operation === 'restore' ? 'DROP TABLE IF EXISTS dial_expired_checkpoint_probe;' : '';
 const sql = `${mutation} SELECT phase,
  (SELECT COUNT(*) FROM dial_portability_admission WHERE id='${id}') AS leases,
  (SELECT COUNT(*) FROM dial_portability_admission WHERE id='${id}' AND expires_at=0) AS expired,
  (SELECT COUNT(*) FROM rer_portability_parts WHERE job='${id}') AS parts,
  (SELECT COUNT(*) FROM rer_portability_segments WHERE job='${id}') AS segments,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'rer_portability_snap_${id.replaceAll('-', '')}_%') AS copies
  FROM rer_portability_jobs WHERE id='${id}';`;
 let output = '';
 const command = spawnOwned(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'dial-local', '--local', '--persist-to', '.wrangler/state', '--config', 'wrangler.toml', '--command', sql, '--json'], { cwd: directory, env: environment() }, { label: 'expired checkpoint fixture' });
 command.child.stdout.on('data', chunk => { output += chunk; });
 try {
  await command.waitForClose(60_000);
  const state = JSON.parse(output).at(-1).results[0];
  assert.ok(state, 'the source checkpoint exists');
  return state;
 } catch { throw Error('Local checkpoint fixture failed; private diagnostics omitted.'); }
 finally { await command.stop(); }
}

export async function expiredCheckpoint({ origin, cookie, otherCookie, id, directory, sessionFile, checkpointState }) {
 const endpoint = origin + '/api/portability/exports/' + id;
 const request = (suffix = '', method = 'GET', session = cookie, requestOrigin = origin) => fetch(endpoint + suffix, { method, headers: { Cookie: session, Origin: requestOrigin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ maxParts: 16 }) } : {}) });
 let response = await request(), status = await response.json();
 while (status.phase === 'building') {
  response = await request('/advance', 'POST'); assert.equal(response.status, 200); status = await response.json();
 }
 assert.equal(status.phase, 'complete');
 const archive = await request('/download'); assert.equal(archive.status, 200); await archive.arrayBuffer();
 const before = await checkpointState(id);
 assert.ok(before.copies > 0 && before.parts > 0 && before.segments > 0, 'a complete checkpoint retains snapshot data');
 try {
  const expired = await checkpointState(id, 'expire'); assert.equal(expired.expired, 1);
  assert.equal((await fetch(origin + '/api/app/profile', { headers: { Cookie: cookie } })).status, 200, 'expiry reopens application admission');
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await request('', 'GET', otherCookie)).status, 404);
  assert.equal((await request('/abort', 'POST', otherCookie)).status, 404);
  assert.equal((await request('/abort', 'POST', cookie, 'https://other.invalid')).status, 403);
  assert.equal((await request()).status, 200, 'expired status is available despite failed snapshot preflight');
  assert.equal((await checkpointState(id)).expired, 1, 'status does not renew the expired lease');
  assert.equal((await request('/advance', 'POST')).status, 503);
  assert.equal((await request('/download')).status, 503, 'even a previously complete archive cannot download after expiry');
  const client = process.env.DIAL_PUBLISHED_RER_ENTRY
   ? fileURLToPath(new URL('../modules/portability/cli.mjs', pathToFileURL(process.env.DIAL_PUBLISHED_RER_ENTRY)))
   : join(directory, 'scripts/base-cli/modules/portability/cli.mjs');
  const outputPath = join(directory, 'exports/expired.rer');
  const runClient = async (verb, expected) => {
   const child = spawnOwned(process.execPath, [client, verb, '--origin', origin, '--session-file', sessionFile, '--resume', id, ...(verb === 'export' ? ['--out', outputPath] : [])], { cwd: directory, env: environment() }, { label: `published transfer ${verb}`, onOutput: () => {} });
   try {
    try { await child.waitForClose(60_000); } catch { if (expected === 0) throw Error('Published transfer cleanup failed; private diagnostics omitted.'); }
    assert.equal(child.state.code, expected, `published transfer ${verb} exit status`);
   } finally { await child.stop(); }
  };
  await runClient('export', 1);
  await assert.rejects(access(outputPath), { code: 'ENOENT' });
  await runClient('abort', 0);
  assert.deepEqual(await checkpointState(id), { phase: 'aborted', leases: 0, expired: 0, parts: 0, segments: 0, copies: 0 });
  assert.equal((await request('/advance', 'POST')).status, 503);
  assert.equal((await request('/download')).status, 503);
  return { expiredStatusWithoutRenewal: true, expiredAdvanceDownloadResumeRefused: true, expiredBaseClientAbort: true, expiredExternalPublishedClientExecuted: Boolean(process.env.DIAL_PUBLISHED_RER_ENTRY), expiredSnapshotCleanup: true, cleanupSurvivesSchemaMismatch: true };
 } finally { await checkpointState(id, 'restore'); }
}
