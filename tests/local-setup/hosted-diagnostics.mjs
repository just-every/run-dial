import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { portability } from '../../scripts/local/portability.mjs';

// Only the HTTP network edge is synthetic. The real command adapter launches
// the real published client, receives its refusal and renders the top-level error.
export async function hostedDiagnostics() {
 const directory = await mkdtemp(join(tmpdir(), 'dial-export-diagnostics-'));
 const privateValue = 'private-cookie-and-path-canary';
 let cause = 'archive-migration-history-mismatch', requests = 0, aborts = 0, output = '';
 const server = createServer((request, response) => {
  requests++;
  if (cause === 'download') {
   if (request.url.endsWith('/download')) { response.end(privateValue); return; }
   if (request.url.endsWith('/abort')) aborts++;
   response.writeHead(request.url === '/api/portability/exports' ? 201 : 200, { 'content-type': 'application/json' });
   response.end(JSON.stringify({ id: 'diagnostic-job', phase: 'complete' })); return;
  }
  assert.equal(request.url, '/api/portability/exports');
  assert.equal(request.method, 'POST');
  response.writeHead(409, { 'content-type': 'application/json', 'X-Dial-Archive-Error': cause });
  response.end(JSON.stringify({ error: privateValue }));
 });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 const origin = `http://127.0.0.1:${server.address().port}`;
 const sessionFile = join(directory, privateValue);
 await writeFile(sessionFile, 'owner=' + privateValue, { mode: 0o600 });
 const store = { spawn(_label, ...args) { const child = spawn(...args); child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; }); return child; } };
 const invoke = () => portability.export({ root: new URL('../../', import.meta.url).pathname, path: join(directory, 'export.rer'), target: 'remote', origin, sessionFile, store });
 try {
  await assert.rejects(invoke(), error => error.exitCode === 4 && /HTTP 409; archive-migration-history-mismatch/.test(error.message));
  assert.equal(requests, 1, 'diagnostics do not repeat the source operation');
  cause = privateValue;
  await assert.rejects(invoke(), error => /HTTP 409/.test(error.message) && !error.message.includes(privateValue));
  cause = 'download';
  await assert.rejects(invoke(), error => /hosted-archive-invalid; archive_json/.test(error.message));
  assert.equal(aborts, 1, 'invalid downloads still clean the completed source snapshot');
  assert.ok(!output.includes(privateValue), 'raw response, cookie and session path never enter refusal output');
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(invoke(), error => /hosted-transport-failed; ECONNREFUSED/.test(error.message));
 } finally { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
