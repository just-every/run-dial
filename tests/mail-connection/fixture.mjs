import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
const require = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(require.resolve('miniflare')));
export const origin = 'https://mail-connection.example.test';
export const configuration = { ENVIRONMENT: 'production', APP_URL: origin, SESSION_SECRET: 'synthetic-mail-session-secret-at-least-32', SETUP_TOKEN: 'synthetic-mail-bootstrap-secret-at-least-32', OWNER_EMAIL: 'owner@example.test', MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-mail-api-key', MAIL_FROM: 'noreply@example.test' };

export async function fixture(t, overrides = {}, outbound) {
  const state = await mkdtemp(join(tmpdir(), 'dial-mail-connection-'));
  const runtime = { ...configuration, ...overrides };
  let worker, verified = true, calls = 0;
  let closed = false;
  const close = async () => { if (closed) return; closed = true; try { await worker?.dispose(); } finally { await rm(state, { recursive: true, force: true }); } };
  t.after(close);
  try {
    const compiled = await build({ entryPoints: [new URL('./worker.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:workers'], write: false });
    worker = new Miniflare({ cf: false, resourcePersistencePath: state, workers: [{ config: {
      type: 'worker', name: 'mail-connection', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      exports: { BookingCoordinator: { type: 'durable-object', storage: 'sqlite' } },
      env: { DB: { type: 'd1', id: 'mail-connection' }, BOOKING_COORDINATOR: { type: 'durable-object', worker: 'mail-connection', exportName: 'BookingCoordinator' }, ...Object.fromEntries(Object.entries(runtime).filter(([, value]) => value !== undefined).map(([name, value]) => [name, { type: 'text', value }])) },
      manifest: { mainModule: 'worker.mjs', modulesRoot: state, modules: { 'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } },
    }, dev: { outboundService: { type: 'fetcher', handler: async (request) => {
      calls++;
      if (outbound) return outbound(request);
      assert.equal(request.url, 'https://api.sendgrid.com/v3/verified_senders');
      assert.equal(request.method, 'GET');
      return verified ? Response.json({ results: [{ from_email: configuration.MAIL_FROM, verified: true }] }) : new Response(null, { status: 403 });
    } } } }] });
    const db = await worker.getD1Database('DB');
    const folder = new URL('../../migrations/core/', import.meta.url);
    for (const name of (await readdir(folder)).filter(name => name.endsWith('.sql')).sort()) await db.batch(splitSqlQuery(await readFile(new URL(name, folder), 'utf8')).map(sql => db.prepare(sql)));
    let cookie;
    const request = (path, body, headers = {}) => worker.dispatchFetch('http://localhost/test-envelope', { method: 'POST', redirect: 'manual', body: JSON.stringify({ url: origin + path, method: body === undefined ? 'GET' : 'POST', headers: { host: new URL(origin).host, origin, 'cf-connecting-ip': '198.18.0.2', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }) });
    const bootstrap = await request('/auth/bootstrap', { token: runtime.SETUP_TOKEN, displayName: 'Mail operator', returnTo: '/app' });
    assert.equal(bootstrap.status, 303);
    cookie = bootstrap.headers.get('set-cookie').split(';')[0];
    const snapshot = async () => {
      const result = {};
      for (const table of ['provider_connection_health', 'provider_webhook_events', 'delivery_outbox', 'delivery_attempts', 'base_mail_dispatch']) result[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
      return result;
    };
    return { db, request, snapshot, close, get calls() { return calls; }, set verified(value) { verified = value; } };
  } catch (error) { await close(); throw error; }
}

/** The emitted deployment, with real Worker exports, bindings and assets.
 * Only external provider HTTP is substituted; no application handler is wrapped. */
export async function emittedFixture(t, overrides, outbound) {
  if (process.env.DIAL_MANAGED_MAIL_BUILT !== '1') {
    await promisify(execFile)('pnpm', ['exec', 'rer', 'build'], { cwd: resolve('.'), maxBuffer: 4 * 1024 * 1024 });
  }
  const directory = resolve('dist/server'), config = JSON.parse(await readFile(join(directory, 'wrangler.json'), 'utf8'));
  const types = { '.js': 'ESModule', '.mjs': 'ESModule', '.wasm': 'CompiledWasm', '.bin': 'Data', '.txt': 'Text', '.sql': 'Text' };
  async function modulesIn(folder) {
    const result = [];
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) result.push(...await modulesIn(path));
      else if (types[extname(path)]) result.push({ type: types[extname(path)], path });
    }
    return result;
  }
  const modules = await modulesIn(directory);
  modules.sort((a, b) => Number(b.path === join(directory, config.main)) - Number(a.path === join(directory, config.main)));
  const worker = new Miniflare(convertV4MiniflareOptions({ cf: false, workers: [{
    name: 'ingress', modules: true, serviceBindings: { APP: 'managed-mail' },
    // Miniflare's loopback listener needs the hosted request URL restored.
    script: `export default {fetch(request,env){const url=new URL(request.headers.get('x-dial-original-url')),headers=new Headers(request.headers);headers.delete('x-dial-original-url');headers.set('host',url.host);return env.APP.fetch(new Request(url,{method:request.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:request.body}:{})}))}}`,
  }, {
    name: 'managed-mail', modules, modulesRoot: directory,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: { ...config.vars, ...configuration, ...overrides },
    d1Databases: ['DB'], r2Buckets: ['FILES'],
    queueProducers: { JOBS: 'managed-mail-jobs', JOBS_DEAD: 'managed-mail-dead' },
    durableObjects: { BOOKING_COORDINATOR: { className: 'BookingCoordinator', useSQLite: true } },
    assets: { directory: resolve('dist/client'), binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
    outboundService: async request => {
      try { return await outbound(request); }
      catch (error) { t.diagnostic(String(error)); throw error; }
    },
  }] }));
  t.after(() => worker.dispose());
  const db = await worker.getD1Database('DB', 'managed-mail');
  const folder = new URL('../../migrations/core/', import.meta.url);
  for (const name of (await readdir(folder)).filter(name => name.endsWith('.sql')).sort()) await db.batch(splitSqlQuery(await readFile(new URL(name, folder), 'utf8')).map(sql => db.prepare(sql)));
  const app = await worker.getWorker('managed-mail');
  let cookie;
  const fetch = (path, init = {}) => worker.dispatchFetch('http://localhost/', { ...init, redirect: 'manual', headers: { origin, 'cf-connecting-ip': '198.18.0.2', ...(cookie ? { cookie } : {}), ...init.headers, 'x-dial-original-url': origin + path } });
  const request = (path, body) => fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const bootstrap = await request('/auth/bootstrap', { token: configuration.SETUP_TOKEN, displayName: 'Robin Miller', returnTo: '/app' });
  assert.equal(bootstrap.status, 303, bootstrap.status === 303 ? undefined : await bootstrap.text());
  cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const queue = async outboxId => {
    const result = await app.queue('managed-mail-jobs', [{ id: crypto.randomUUID(), timestamp: new Date(), attempts: 1, body: { outboxId } }]);
    assert.equal(result.outcome, 'ok');
  };
  return { db, fetch, request, queue };
}
