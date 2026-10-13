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
  const state = await mkdtemp(join(tmpdir(), 'dial-first-run-'));
  const runtime = { ENVIRONMENT: 'development', APP_URL: origin, OWNER_EMAIL: 'owner@dial.test',
    SESSION_SECRET: 'first-run-native-test-session-secret-at-least-32',
    SETUP_TOKEN: 'first-run-native-test-setup-token-at-least-32',
    MAIL_PROVIDER: 'development', MAIL_FROM: 'noreply@dial.test' };
  let worker;
  t.after(async () => { try { await worker?.dispose(); } finally { await rm(state, { recursive: true, force: true }); } });
  const compiled = await build({ entryPoints: [new URL('./worker.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:workers'], write: false });
  worker = new Miniflare({ cf: false, resourcePersistencePath: state, workers: [{ config: {
    type: 'worker', name: 'first-run', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
    env: { DB: { type: 'd1', id: 'first-run' }, ...Object.fromEntries(Object.entries(runtime).map(([name, value]) => [name, { type: 'text', value }])) },
    manifest: { mainModule: 'worker.mjs', modulesRoot: state, modules: { 'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } },
  }, dev: { outboundService: { type: 'fetcher', handler: async () => { throw new Error('Unexpected outbound provider request'); } } } }] });
  const db = await worker.getD1Database('DB');
  for (const directory of ['core', 'ext']) {
    const folder = new URL(`../../migrations/${directory}/`, import.meta.url);
    const files = await readdir(folder).catch(error => { if (directory === 'ext' && error.code === 'ENOENT') return []; throw error; });
    for (const name of files.filter(name => name.endsWith('.sql')).sort()) await db.batch(splitSqlQuery(await readFile(new URL(name, folder), 'utf8')).map(sql => db.prepare(sql)));
  }
  let cookie;
  const send = (path, { body, method = body === undefined ? 'GET' : 'POST', anonymous = false, headers = {} } = {}) => worker.dispatchFetch('http://localhost/test-envelope', {
    method: 'POST', redirect: 'manual', body: JSON.stringify({ url: origin + path, method,
      headers: { host: new URL(origin).host, origin, 'cf-connecting-ip': '198.18.0.2', 'content-type': 'application/json', 'x-dial-copy-report': '1', ...(!anonymous && cookie ? { cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  });
  return { db, send, runtime, setCookie: value => { cookie = value; } };
}
