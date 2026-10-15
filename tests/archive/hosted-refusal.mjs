import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { hostedRoute } from './hosted-route.mjs';
import { spawn } from 'node:child_process';
import { schemaModel } from '../../scripts/archive/schema.mjs';
import { sqliteBinding } from './fixture.mjs';
import { createOperatorAuth, createAuthHandler } from '../../modules/operator-auth/index.mjs';
import { portability } from '../../scripts/local/portability.mjs';

export async function hostedObjectRefusal() {
 const model = await schemaModel(), directory = await mkdtemp(join(tmpdir(), 'dial-hosted-refusal-'));
 const db = sqliteBinding(model.db), children = new Set(), responses = [];
 const privateValue = 'synthetic-object-credential-at-least-32-characters';
 const objectKey = 'private-owner-assets/original.bin';
 let mode = 'credential', captured = '', handle, origin;
 // The sole fake is the R2 binding/network edge. Whole-object bodies retain
 // chunk boundaries so a credential split across chunks reaches the real scan.
 const bucket = {
  async list() { return { objects: [{ key: objectKey, size: privateValue.length, etag: 'original', customMetadata: mode === 'metadata' ? { note: privateValue } : {} }], truncated: false }; },
  async get(_key, options) {
   if (mode === 'unknown') throw Error('private-provider-failure-' + objectKey);
   const bytes = Buffer.from(mode === 'credential' ? privateValue : 'ordinary-object-bytes');
   const selected = options?.range ? bytes.subarray(options.range.offset, options.range.offset + options.range.length) : bytes;
   return { etag: mode === 'changed' && !options?.range ? 'changed' : 'original',
    body: new ReadableStream({ start(controller) { controller.enqueue(selected.subarray(0, 13)); controller.enqueue(selected.subarray(13)); controller.close(); } }),
    async arrayBuffer() { return selected; } };
  },
 };
 const server = createServer(async (incoming, outgoing) => {
  try {
   const request = new Request(origin + incoming.url, { method: incoming.method, headers: incoming.headers,
    ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
   const response = await handle(request);
   if (!response.ok) responses.push({ status: response.status, cause: response.headers.get('X-Dial-Archive-Error'), body: await response.clone().text() });
   outgoing.writeHead(response.status, Object.fromEntries(response.headers));
   outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end(); }
 });
 try {
  const hostedExport = await hostedRoute(model);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  const env = { DB: db, FILES: bucket, APP_URL: origin, SESSION_SECRET: privateValue, SETUP_TOKEN: 'synthetic-native-bootstrap-token-at-least-32', OWNER_EMAIL: 'owner@example.test' };
  const auth = createOperatorAuth({ db, config: { ...env, origin, local: true }, clientIp: () => '127.0.0.1' });
  const authenticated = await createAuthHandler(auth)(new Request(origin + '/auth/bootstrap', { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'application/json' }, body: JSON.stringify({ token: env.SETUP_TOKEN, displayName: 'Owner' }) }));
  assert.equal(authenticated.status, 303);
  const cookie = authenticated.headers.get('set-cookie').split(';')[0], sessionFile = join(directory, 'private-native-session');
  await writeFile(sessionFile, cookie, { mode: 0o600 });
  handle = request => hostedExport(request, env, { auth });
  const store = { spawn(_label, ...args) {
   const child = spawn(...args); children.add(child);
   child.once('close', () => children.delete(child));
   child.stdout.on('data', chunk => { captured += chunk; }); child.stderr.on('data', chunk => { captured += chunk; });
   return child;
  } };
  for (const [scenario, cause] of [['credential', 'archive-object-contains-credential'], ['metadata', 'archive-object-contains-credential'], ['changed', 'archive-object-changed'], ['unknown', null]]) {
   mode = scenario; responses.length = 0;
   const path = join(directory, scenario + '.rer');
   await assert.rejects(portability.export({ root: new URL('../../', import.meta.url).pathname, path, target: 'remote', origin, sessionFile, store, signal: AbortSignal.timeout(20_000) }), error => {
    assert.equal(error.exitCode, 4, 'real command adapter retains the refusal exit');
    assert.equal(responses.at(-1)?.status, cause ? 409 : 500, 'known object refusals cross the real handler as conflicts');
    assert.ok(error.message.includes(`HTTP ${cause ? 409 : 500}`), 'command reports the actual HTTP refusal');
    if (cause) assert.ok(error.message.includes(cause), 'allowlisted object refusal reaches the command');
    for (const value of [privateValue, env.SETUP_TOKEN, cookie, sessionFile, objectKey]) assert.ok(!error.message.includes(value), 'command does not expose private values');
    return true;
   });
   assert.equal(responses.length, 1, 'failure diagnostics do not replay the operation');
   assert.equal(responses[0].cause, cause);
   assert.equal(responses[0].status, cause ? 409 : 500);
   assert.deepEqual(JSON.parse(responses[0].body), { error: cause ?? 'operation_failed' });
   for (const value of [privateValue, env.SETUP_TOKEN, cookie, sessionFile, objectKey]) assert.ok(!captured.includes(value) && !responses[0].body.includes(value), 'neither wire refusal nor child output leaks private values');
   for (const suffix of ['', '.partial', '.transfer.json']) await assert.rejects(access(path + suffix), { code: 'ENOENT' });
   assert.equal(model.db.prepare('SELECT count(*) AS n FROM dial_portability_admission').get().n, 0, 'cleanup releases source maintenance');
   assert.equal(model.db.prepare("SELECT count(*) AS n FROM rer_portability_jobs WHERE phase<>'aborted'").get().n, 0, 'failed source jobs are aborted');
   assert.equal(model.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'rer_portability_snap_%'").get().n, 0, 'cleanup removes source snapshots');
  }
 } finally {
  for (const child of children) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; }
  server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve));
  model.db.close(); await rm(directory, { recursive: true, force: true });
 }
}
