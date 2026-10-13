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
export const origin = 'http://127.0.0.1:15766';

export async function fixture(t) {
  const state = await mkdtemp(join(tmpdir(), 'dial-event-status-trigger-'));
  const runtime = { ENVIRONMENT: 'development', APP_URL: origin, OWNER_EMAIL: 'owner@dial.test',
    SESSION_SECRET: 'event-status-native-test-session-secret-at-least-32',
    SETUP_TOKEN: 'event-status-native-test-setup-token-at-least-32',
    MAIL_PROVIDER: 'development', MAIL_FROM: 'noreply@dial.test' };
  let worker;
  t.after(async () => { try { await worker?.dispose(); } finally { await rm(state, { recursive: true, force: true }); } });
  const compiled = await build({ entryPoints: [new URL('./worker.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:workers'], write: false });
  worker = new Miniflare({ cf: false, resourcePersistencePath: state, workers: [{ config: {
    type: 'worker', name: 'event-status-trigger', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
    env: { DB: { type: 'd1', id: 'event-status-trigger' }, ...Object.fromEntries(Object.entries(runtime).map(([name, value]) => [name, { type: 'text', value }])) },
    manifest: { mainModule: 'worker.mjs', modulesRoot: state, modules: { 'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } },
  }, dev: { outboundService: { type: 'fetcher', handler: async () => { throw new Error('Unexpected outbound provider request'); } } } }] });
  const db = await worker.getD1Database('DB');
  for (const directory of ['core', 'ext']) {
    const folder = new URL(`../../migrations/${directory}/`, import.meta.url);
    const files = await readdir(folder).catch(error => { if (directory === 'ext' && error.code === 'ENOENT') return []; throw error; });
    for (const name of files.filter(name => name.endsWith('.sql')).sort()) await db.batch(splitSqlQuery(await readFile(new URL(name, folder), 'utf8')).map(sql => db.prepare(sql)));
  }
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name='host_link_copy_event_changed'").first()).n, 1);
  let cookie;
  const send = (path, { body, method = body === undefined ? 'GET' : 'POST', anonymous = false } = {}) => worker.dispatchFetch('http://localhost/test-envelope', {
    method: 'POST', redirect: 'manual', body: JSON.stringify({ url: origin + path, method,
      headers: { host: new URL(origin).host, origin, 'cf-connecting-ip': '198.18.0.2', 'content-type': 'application/json', 'x-dial-copy-report': '1', ...(!anonymous && cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  });
  const json = async (path, options, status = 200) => {
    const response = await send(path, options);
    assert.equal(response.status, status, `${path}: ${await response.clone().text()}`);
    return response.json();
  };
  const bootstrap = await send('/auth/bootstrap', { body: { token: runtime.SETUP_TOKEN, displayName: 'Status Owner' } });
  assert.equal(bootstrap.status, 303);
  cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'native first-owner bootstrap creates the session');
  await json('/api/app/profile', { method: 'PATCH', body: { name: 'Status Host', handle: 'status-host', title: 'Host', biography: 'Native status regression host.', timezone: 'UTC', focusAreas: [], socialProof: [] } });
  const defaults = await json('/api/app/__fixture/defaults');
  const create = slug => json('/api/app/event-types', { body: { ...defaults, slug, title: slug, description: 'Native event status regression', locationType: 'phone', locationLabel: 'Phone', locationValue: '+1 202 555 0100' } }, 201);
  const copy = event => json(`/api/app/event-types/${event.id}/copy-report`, { body: { url: `${origin}/book/status-host/${event.slug}` } });
  const reports = async () => (await db.prepare('SELECT * FROM host_link_copy_reports ORDER BY id').all()).results;
  const snapshot = async () => {
    const result = {};
    for (const table of ['event_types', 'event_questions', 'recurring_availability_windows', 'host_link_copy_reports', 'host_profiles', 'bookings', 'availability_requests']) result[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
    return result;
  };
  return { db, send, json, create, copy, reports, snapshot };
}
