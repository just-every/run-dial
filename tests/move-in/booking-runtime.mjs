import { savedUploader } from './upload.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';

const require = createRequire(import.meta.resolve('wrangler'));
const { Miniflare } = await import(pathToFileURL(require.resolve('miniflare')));

export async function bookingRuntime({ developmentMail = false, stateDirectory, workerEntry, migrationsRoot, initialize = true, sessionCookie } = {}) {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const state = stateDirectory ?? await mkdtemp(join(tmpdir(), 'dial-import-booking-'));
  const compiled = await build({ entryPoints: [workerEntry ?? fileURLToPath(new URL('booking-worker.ts', import.meta.url))], nodePaths: [fileURLToPath(new URL('../../node_modules', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:workers'], write: false });
  const variables = { OWNER_EMAIL: 'operator@dial.test', MAIL_FROM: 'no-reply@dial.test', SETUP_TOKEN: 'dial-test-only-setup-token-at-least-32', ENVIRONMENT: 'development', APP_URL: origin, GOOGLE_OAUTH_CLIENT_ID: 'synthetic-client', GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret', CALENDAR_WEBHOOK_SECRET: 'synthetic-calendar-webhook-secret-for-test-only', SESSION_SECRET: 'synthetic-dial-booking-wire-synthetic-local-session-secret', MAIL_PROVIDER: developmentMail ? 'development' : 'sendgrid', MAIL_API_KEY: 'wire-mail-key', MAIL_WEBHOOK_KEY: 'test-only-wire-webhook-key' };
  const mf = new Miniflare({ host: '127.0.0.1', port, cf: false, resourcePersistencePath: state, workers: [{ config: {
    type: 'worker', name: 'booking-actions', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
    env: { DB: { type: 'd1', id: 'booking-actions' }, PROVIDER_DB: { type: 'd1', id: 'booking-edge' }, FILES: { type: 'r2', name: 'files' }, JOBS: { type: 'queue', name: 'jobs' }, BOOKING_COORDINATOR: { type: 'durable-object', worker: 'booking-actions', exportName: 'BookingCoordinator' }, ...Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, { type: 'text', value }])) },
    exports: { BookingCoordinator: { type: 'durable-object', storage: 'sqlite' } },
    manifest: { mainModule: 'worker.mjs', modulesRoot: state, modules: { 'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } },
  }, dev: { outboundService: { type: 'fetcher', handler: () => { throw new Error('Unexpected live network call'); } } } }] });
  try {
    const db = await mf.getD1Database('DB'), providerDb = await mf.getD1Database('PROVIDER_DB');
    if (initialize) for (const folder of ['core', 'ext']) {
      const directory = migrationsRoot ? pathToFileURL(join(migrationsRoot, folder) + '/') : new URL(`../../migrations/${folder}/`, import.meta.url);
      const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const name of names.filter(name => name.endsWith('.sql')).sort()) await db.batch(splitSqlQuery(await readFile(new URL(name, directory), 'utf8')).map(sql => db.prepare(sql)));
    }
    let cookie = sessionCookie;
    const api = (path, init = {}) => fetch(origin + path, { redirect: 'manual', ...init, headers: { origin, host: new URL(origin).host, ...(cookie ? { cookie } : {}), ...init.headers } });
    const data = async (path, body, expected = 200, method = body === undefined ? 'GET' : 'POST') => {
      const response = await api(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
      // Never include manage capabilities or response bodies in failure output.
      const error = response.status === expected ? undefined : await response.clone().json().catch(() => ({}));
      const message = String(error?.error?.message ?? error?.error?.code ?? '');
      const diagnostic = ['too many SQL variables', 'Expression tree is too large', 'parser stack overflow', 'string or blob too big', 'no such column', 'no such table', 'syntax error', 'ambiguous column', 'IMPORT_D1_REQUEST_LIMIT', 'SQLITE_ERROR'].filter(code => message.includes(code)).join(',');
      assert.equal(response.status, expected, `${method} ${path.split('?')[0].replace(/\/manage\/[^/]+/u, '/manage/[redacted]')} ${diagnostic}`);
      return response.json();
    };
    if (!cookie) {
    const boot = await api('/auth/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: variables.SETUP_TOKEN, displayName: 'Booking owner', returnTo: '/app' }) });
    assert.equal(boot.status, 303, 'native owner bootstrap'); cookie = boot.headers.get('set-cookie').split(';')[0];
    }
    if (initialize) await data('/wire/init', {});
    const submit = savedUploader(api, '2027-01-01T00:00:00.000Z');
    const upload = async (action, files, extra = {}) => {
      const response = await submit(action, files, extra);
      assert.equal(response.status, 200); return response.json();
    };
    return { db, providerDb, api, data, upload, sessionCookie: cookie, bucket: await mf.getR2Bucket('FILES'),
      async hold(id, outboxId, point, responseStatus) {
        await data('/__edge/start', { id, outboxId, point, responseStatus });
        for (let attempt = 0; attempt < 100; attempt++) {
          if ((await data(`/__edge/status?id=${id}`)).held) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.fail('Native delivery did not reach the expected paid edge');
      },
      async release(id) { return (await data('/__edge/release', { id })).result; },
      async close() { try { await data('/__edge/close', {}); } finally { await mf.dispose(); if (!stateDirectory) await rm(state, { recursive: true, force: true }); } },
    };
  } catch (error) { await mf.dispose(); if (!stateDirectory) await rm(state, { recursive: true, force: true }); throw error; }
}
