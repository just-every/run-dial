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

export async function fixture() {
  const state = await mkdtemp(join(tmpdir(), 'dial-json-boundary-'));
  const runtime = { ENVIRONMENT: 'production', APP_URL: origin, OWNER_EMAIL: 'owner@example.test',
    SESSION_SECRET: 'test-only-boundary-session-secret-at-least-32-characters', SETUP_TOKEN: 'test-only-boundary-setup-token-at-least-32-characters',
    MAIL_PROVIDER: 'sendgrid', MAIL_FROM: 'noreply@example.test', MAIL_API_KEY: 'test-only-mail-key' };
  let worker;
  const close = async () => { try { await worker?.dispose(); } finally { await rm(state, { recursive: true, force: true }); } };
  try {
    const compiled = await build({ entryPoints: [new URL('./worker.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:workers'], write: false });
    worker = new Miniflare({ cf: false, resourcePersistencePath: state, workers: [{ config: {
      type: 'worker', name: 'request-json-boundary', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      env: { DB: { type: 'd1', id: 'request-json-boundary' }, ...Object.fromEntries(Object.entries(runtime).map(([name, value]) => [name, { type: 'text', value }])) },
      manifest: { mainModule: 'worker.mjs', modulesRoot: state, modules: { 'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } },
    }, dev: { outboundService: { type: 'fetcher', handler: async () => { throw new Error('Unexpected outbound request'); } } } }] });
    const db = await worker.getD1Database('DB');
    for (const directory of ['core', 'ext']) {
      const folder = new URL(`../../migrations/${directory}/`, import.meta.url);
      const files = await readdir(folder).catch(error => { if (directory === 'ext' && error.code === 'ENOENT') return []; throw error; });
      for (const name of files.filter(name => name.endsWith('.sql')).sort()) await db.batch(splitSqlQuery(await readFile(new URL(name, folder), 'utf8')).map(sql => db.prepare(sql)));
    }
    let cookie;
    const send = (path, { body, rawBody, method = body === undefined && rawBody === undefined ? 'GET' : 'POST', headers = {}, anonymous = false } = {}) => {
      const inputHeaders = { host: new URL(origin).host, origin, 'cf-connecting-ip': '198.18.0.2', 'content-type': 'application/json', 'x-dial-copy-report': '1', ...(!anonymous && cookie ? { cookie } : {}), ...headers };
      return worker.dispatchFetch('http://localhost/test-envelope', { method: 'POST', redirect: 'manual', body: JSON.stringify({ url: origin + path, method, headers: inputHeaders, ...(body === undefined && rawBody === undefined ? {} : { body: rawBody ?? JSON.stringify(body) }) }) });
    };
    const bootstrap = await send('/auth/bootstrap', { body: { token: runtime.SETUP_TOKEN, displayName: 'Boundary Owner' } });
    assert.equal(bootstrap.status, 303);
    cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'native bootstrap supplies the authenticated session');
    assert.equal((await send('/api/app/event-types')).status, 200);
    const seeded = await send('/__fixture/seed');
    assert.equal(seeded.status, 200);
    const { id } = await seeded.json();
    const endpoint = `/api/app/event-types/${id}/copy-report`;
    const url = origin + '/book/boundary-host/boundary-event';
    assert.equal((await send(endpoint, { body: { url } })).status, 200);
    const snapshot = async () => {
      const result = {};
      for (const table of ['host_profiles', 'event_types', 'host_link_copy_reports', 'delivery_outbox', 'bookings', 'availability_requests']) result[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
      result.effects = await (await send('/__fixture/effects')).json();
      return result;
    };
    return { db, send, endpoint, url, snapshot, close };
  } catch (error) { await close(); throw error; }
}
