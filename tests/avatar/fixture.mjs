import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';

const require = createRequire(import.meta.resolve('wrangler'));
const { Miniflare } = await import(pathToFileURL(require.resolve('miniflare')));
export const origin = 'https://dial.example.test';

export async function fixture({ initialize = true } = {}) {
  const state = await mkdtemp(join(tmpdir(), 'dial-json-boundary-'));
  const runtime = { ENVIRONMENT: 'production', APP_URL: origin, OWNER_EMAIL: 'owner@example.test',
    SESSION_SECRET: 'test-only-boundary-session-secret-at-least-32-characters', SETUP_TOKEN: 'test-only-boundary-setup-token-at-least-32-characters',
    MAIL_PROVIDER: 'sendgrid', MAIL_FROM: 'noreply@example.test', MAIL_API_KEY: 'test-only-mail-key' };
  let worker;
  const close = async () => { try { await worker?.dispose(); } finally { await rm(state, { recursive: true, force: true }); } };
  try {
    const compiled = await build({ entryPoints: [new URL('./worker.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:workers'], write: false });
    const options = { cf: false, resourcePersistencePath: state, workers: [{ config: {
      // Test-only R2 barriers deliberately coordinate separate control requests.
      type: 'worker', name: 'avatar', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
      env: { DB: { type: 'd1', id: 'avatar' }, FILES: { type: 'r2', name: 'avatar-files' }, ...Object.fromEntries(Object.entries(runtime).map(([name, value]) => [name, { type: 'text', value }])) },
      manifest: { mainModule: 'worker.mjs', modulesRoot: state, modules: { 'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } },
    }, dev: { outboundService: { type: 'fetcher', handler: async () => { throw new Error('Unexpected outbound request'); } } } }] };
    worker = new Miniflare(options);
    let db = await worker.getD1Database('DB');
    let bucket = await worker.getR2Bucket('FILES');
    for (const directory of ['core', 'ext']) {
      const folder = new URL(`../../migrations/${directory}/`, import.meta.url);
      const files = await readdir(folder).catch(error => { if (directory === 'ext' && error.code === 'ENOENT') return []; throw error; });
      for (const name of files.filter(name => name.endsWith('.sql')).sort()) await db.batch(splitSqlQuery(await readFile(new URL(name, folder), 'utf8')).map(sql => db.prepare(sql)));
    }
    let cookie;
    const send = (path, { body, bytes, rawBody, method = body === undefined && rawBody === undefined && bytes === undefined ? 'GET' : 'POST', headers = {}, anonymous = false } = {}) => {
      const inputHeaders = { host: new URL(origin).host, origin, 'cf-connecting-ip': '198.18.0.2', 'content-type': 'application/json', 'x-dial-copy-report': '1', ...(!anonymous && cookie ? { cookie } : {}), ...headers };
      return worker.dispatchFetch('http://localhost/test-envelope', { method: 'POST', redirect: 'manual', body: JSON.stringify({ url: origin + path, method, headers: inputHeaders, ...(bytes ? { bytes: Buffer.from(bytes).toString("base64") } : body === undefined && rawBody === undefined ? {} : { body: rawBody ?? JSON.stringify(body) }) }) });
    };
    if (initialize) {
      const bootstrap = await send('/auth/bootstrap', { body: { token: runtime.SETUP_TOKEN, displayName: 'Avatar Owner' } });
      assert.equal(bootstrap.status, 303);
      cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      assert.equal((await send('/api/app/profile', { method: 'PATCH', body: { name: 'Avatar Host', handle: 'avatar-host', title: 'Host', biography: 'Host biography', timezone: 'UTC', focusAreas: [], socialProof: [] } })).status, 200);
    }
    const restart = async () => {
      await worker.dispose();
      worker = new Miniflare(options);
      db = await worker.getD1Database('DB');
      bucket = await worker.getR2Bucket('FILES');
    };
    return { get db() { return db; }, get bucket() { return bucket; }, send, runtime, close, restart };
  } catch (error) { await close(); throw error; }
}
