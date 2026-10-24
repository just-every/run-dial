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

/** Dial's own routes in workerd, signed in as the owner of a host profile, with every outbound request answered by
 * `internet`: the network edge, the only fake. */
export async function fixture(internet) {
  const state = await mkdtemp(join(tmpdir(), 'dial-site-look-'));
  const runtime = { ENVIRONMENT: 'production', APP_URL: origin, OWNER_EMAIL: 'owner@example.test',
    SESSION_SECRET: 'test-only-site-look-session-secret-at-least-32-characters', SETUP_TOKEN: 'test-only-site-look-setup-token-at-least-32-characters',
    MAIL_PROVIDER: 'sendgrid', MAIL_FROM: 'noreply@example.test', MAIL_API_KEY: 'test-only-mail-key' };
  let worker;
  const close = async () => { try { await worker?.dispose(); } finally { await rm(state, { recursive: true, force: true }); } };
  try {
    const compiled = await build({ entryPoints: [new URL('./worker.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:workers'], write: false });
    worker = new Miniflare({ cf: false, resourcePersistencePath: state, workers: [{ config: {
      type: 'worker', name: 'site-look', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      env: { DB: { type: 'd1', id: 'site-look' }, FILES: { type: 'r2', name: 'site-look-files' }, ...Object.fromEntries(Object.entries(runtime).map(([name, value]) => [name, { type: 'text', value }])) },
      manifest: { mainModule: 'worker.mjs', modulesRoot: state, modules: { 'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } },
    }, dev: { outboundService: { type: 'fetcher', handler: internet } } }] });
    const db = await worker.getD1Database('DB');
    for (const directory of ['core', 'ext']) {
      const folder = new URL(`../../migrations/${directory}/`, import.meta.url);
      const files = await readdir(folder).catch(error => { if (directory === 'ext' && error.code === 'ENOENT') return []; throw error; });
      for (const name of files.filter(name => name.endsWith('.sql')).sort()) await db.batch(splitSqlQuery(await readFile(new URL(name, folder), 'utf8')).map(sql => db.prepare(sql)));
    }
    let cookie;
    const send = (path, { body, method = body === undefined ? 'GET' : 'POST', anonymous = false } = {}) => worker.dispatchFetch('http://localhost/test-envelope', { method: 'POST', redirect: 'manual', body: JSON.stringify({
      url: origin + path, method,
      headers: { host: new URL(origin).host, origin, 'cf-connecting-ip': '198.18.0.2', 'content-type': 'application/json', ...(!anonymous && cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) });
    const bootstrap = await send('/auth/bootstrap', { body: { token: runtime.SETUP_TOKEN, displayName: 'Site Owner' } });
    assert.equal(bootstrap.status, 303);
    cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    assert.equal((await send('/api/app/profile', { method: 'PATCH', body: { name: 'Site Host', handle: 'site-host', title: 'Host', biography: 'Host biography', timezone: 'UTC', focusAreas: [], socialProof: [] } })).status, 200);
    return { send, close };
  } catch (error) { await close(); throw error; }
}
