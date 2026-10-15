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
