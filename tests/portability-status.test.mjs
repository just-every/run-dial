import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { statusFixture } from './archive/status-fixture.mjs';
import { portability } from '../scripts/local/portability.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

contract('DATA-001', 'owner status observes writers and active exports without writing, cleaning expiry, or acquiring admission', async () => {
 const f = await statusFixture();
 try {
  for (const scenario of ['empty', 'writer', 'expired', 'active']) {
   if (scenario === 'writer') f.writer();
   if (scenario === 'expired') f.exportLease(1);
   if (scenario === 'active') f.db.prepare("UPDATE dial_portability_admission SET expires_at=? WHERE kind='export'").run(Date.now() + 60_000);
   const before = f.db.prepare('SELECT * FROM dial_portability_admission ORDER BY id').all();
   // Enforce read-only at SQLite itself, including every real auth query. Any
   // INSERT/UPDATE/DELETE (even one changing zero rows) fails this public flow.
   f.db.exec('PRAGMA query_only=ON');
   const response = await f.handle(f.request());
   assert.equal(response.status, 200);
   assert.equal(response.headers.get('cache-control'), 'no-store');
   assert.deepEqual(await response.json(), { writerAdmissions: scenario === 'empty' ? 0 : 1, activeExport: scenario === 'active', writerLiveness: 'unknown' });
   assert.deepEqual(f.db.prepare('SELECT * FROM dial_portability_admission ORDER BY id').all(), before);
   f.db.exec('PRAGMA query_only=OFF');
  }
 } finally { f.db.close(); }
});

contract('AUTH-001', 'status requires a current native owner and the deployment origin without any authentication writes', async () => {
 const f = await statusFixture();
 try {
  f.writer();
  f.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,?,'Other owner','owner','active',?)").run(crypto.randomUUID(), 'other@example.test', Date.now());
  assert.throws(() => f.db.exec("UPDATE oa_operators SET role='member' WHERE email='owner@example.test'"), /dial_equal_operators/, 'Dial rejects non-owner operator authority at its database boundary');
  const cases = [
   ['signed out', null, { headers: { cookie: '' } }, 401],
   ['invalid cookie', null, { headers: { cookie: 'operator_session_local=not-a-valid-session' } }, 401],
   ['duplicate cookie', null, { headers: { cookie: `${f.cookie}; ${f.cookie}` } }, 401],
   ['cross site', null, { headers: { 'sec-fetch-site': 'cross-site' } }, 403],
   ['foreign Origin', null, { headers: { origin: 'https://elsewhere.example' } }, 403],
   ['foreign Host', null, { headers: { host: 'elsewhere.example' } }, 404],
   ['mutation', null, { method: 'POST', headers: { origin: f.origin } }, 405],
   ['expired', 'UPDATE oa_sessions SET expires_at=1', {}, 401],
   ['revoked', 'UPDATE oa_sessions SET revoked_at=1', {}, 401],
   ['inactive operator', "UPDATE oa_operators SET status='inactive' WHERE email='owner@example.test'", {}, 401],
   ['changed authority', "UPDATE oa_operators SET version=version+1 WHERE email='owner@example.test'", {}, 401],
   ['review', "UPDATE oa_sessions SET kind='review'", {}, 401],
   ['development', "UPDATE oa_sessions SET kind='dev'", {}, 401],
   ['external identity', "UPDATE oa_sessions SET kind='oidc'", {}, 401],
  ];
  for (const [label, mutation, init, expected] of cases) {
   f.db.exec('SAVEPOINT scenario'); if (mutation) f.db.exec(mutation);
   f.db.exec('PRAGMA query_only=ON');
   const response = await f.handle(f.request(undefined, init));
   assert.equal(response.status, expected, label);
   assert.equal(response.headers.get('cache-control'), 'no-store', label);
   assert.ok(!(await response.text()).includes('writerAdmissions'), label);
   f.db.exec('PRAGMA query_only=OFF'); f.db.exec('ROLLBACK TO scenario; RELEASE scenario');
  }
  f.db.exec('PRAGMA query_only=ON');
  assert.equal((await f.handle(new Request('https://elsewhere.example/api/portability/status', { headers: { cookie: f.cookie } }))).status, 404);
  assert.equal((await f.handle(f.request())).status, 200, 'refusals preserve the original owner session');
 } finally { f.db.close(); }
});

contract('DATA-001', 'held writers and active export refusals reach the native transfer client as distinct safe causes', async () => {
 let f, output = '';
 const children = new Set();
 const directory = await mkdtemp(join(tmpdir(), 'dial-status-'));
 const server = createServer(async (incoming, outgoing) => {
  try {
   const response = await f.handle(new Request(f.origin + incoming.url, { method: incoming.method, headers: incoming.headers }));
   outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());
  } catch { outgoing.writeHead(500); outgoing.end(); }
 });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 try {
  f = await statusFixture(`http://127.0.0.1:${server.address().port}`);
  const sessionFile = join(directory, 'native-owner.cookie');
  await writeFile(sessionFile, f.cookie, { mode: 0o600 });
  const store = { spawn(_label, ...args) { const child = spawn(...args); children.add(child); child.once('close', () => children.delete(child)); child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; }); return child; } };
  for (const [kind, cause] of [['writer', 'archive_writer_admissions_present'], ['export', 'archive_maintenance']]) {
   const id = kind === 'writer' ? f.writer() : f.exportLease();
   const response = await f.handle(f.request('/api/portability/exports', { method: 'POST', headers: { origin: f.origin } }));
   assert.equal(response.status, 503); assert.equal(response.headers.get('X-Dial-Archive-Error'), cause);
   assert.equal(response.headers.get('cache-control'), 'no-store'); assert.ok(Number(response.headers.get('retry-after')) > 0);
   await assert.rejects(portability.export({ root: new URL('../', import.meta.url).pathname, path: join(directory, kind + '.rer'), target: 'remote', origin: f.origin, sessionFile, store, signal: AbortSignal.timeout(20_000) }), error => {
    assert.equal(error.exitCode, 4);
    assert.ok(error.message.includes(`HTTP 503; ${cause}`));
    assert.ok(!error.message.includes(f.cookie) && !error.message.includes(sessionFile)); return true;
   });
   assert.ok(!output.includes(f.cookie) && !output.includes(sessionFile));
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM rer_portability_jobs').get().n, 0);
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM dial_portability_admission').get().n, 1);
   f.db.prepare('DELETE FROM dial_portability_admission WHERE id=?').run(id);
  }
 } finally {
  for (const child of children) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); f?.db.close();
  await rm(directory, { recursive: true, force: true });
 }
});
