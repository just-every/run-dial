import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createD1DevelopmentOutbox } from '../../modules/mail/src/development/index.mjs';
const require = createRequire(import.meta.resolve('wrangler'));
const { Miniflare } = await import(pathToFileURL(require.resolve('miniflare')));
const compiledWorkers = new Map();

export async function openInstall(root, entry = new URL('operator-worker.ts', import.meta.url).pathname) {
  const compiled = compiledWorkers.get(entry) ?? await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'esm', external: ['node:*', 'cloudflare:workers'] });
  compiledWorkers.set(entry, compiled);
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`, state = join(root, '.wrangler/state/v3');
  // Read only this test's private synthetic install settings.
  const settingsPath = join(root, '.dev.vars'), settings = await readFile(settingsPath, 'utf8');
  const savedOrigins = (settings.match(/^APP_URL=/gm) ?? []).length;
  assert.ok(savedOrigins <= 1, 'fixture has no ambiguous saved application origins');
  const vars = Object.fromEntries(settings.trim().split('\n').map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
  const mf = new Miniflare({ host: '127.0.0.1', port, cf: false, resourcePersistencePath: state, workers: [{
    config: { type: 'worker', name: 'archive-operator', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      env: { DB: { type: 'd1', id: '00000000-0000-0000-0000-000000000000' }, FILES: { type: 'r2', name: 'dial-local-files' }, JOBS: { type: 'queue', name: 'dial-local-jobs' },
        ...Object.fromEntries(Object.entries({ ...vars, APP_URL: origin }).map(([name, value]) => [name, { type: 'text', value }])) },
      manifest: { mainModule: 'operator.mjs', modulesRoot: state, modules: { 'operator.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } } },
    dev: { outboundService: { type: 'fetcher', handler: () => { throw new Error('Archive authentication must use the native development outbox'); } } },
  }] });
  try {
    const ready = await mf.ready;
    assert.ok(ready.origin === origin, 'native runtime serves its configured loopback origin');
    // Reset must inspect the origin this fixture really served, after disposal.
    // Preserve every other private setting and the existing newline style.
    const savedSettings = savedOrigins
      ? settings.replace(/^APP_URL=[^\r\n]*/m, `APP_URL=${ready.origin}`)
      : settings + (settings.endsWith('\n') || !settings ? '' : '\n') + `APP_URL=${ready.origin}\n`;
    await chmod(settingsPath, 0o600);
    await writeFile(settingsPath, savedSettings, { mode: 0o600 });
    assert.ok(await readFile(settingsPath, 'utf8') === savedSettings, 'fixture settings persist without changing other values');
    assert.equal((await stat(settingsPath)).mode & 0o777, 0o600, 'fixture settings stay private');
    const db = await mf.getD1Database('DB');
    const request = (path, { body, cookie } = {}) => fetch(origin + path, {
      redirect: 'manual', method: body ? 'POST' : 'GET', headers: { origin, host: new URL(origin).host, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { env: { DB: db }, request, dispose: () => mf.dispose(),
      async signIn() {
        assert.equal((await request('/auth/magic-link', { body: { email: vars.OWNER_EMAIL, returnTo: '/app' } })).status, 202);
        const outbox = await createD1DevelopmentOutbox({ db }).list();
        assert.ok(outbox.length > 0, 'native development mail captures a fresh sign-in');
        const token = new URL(outbox[0].message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
        const response = await request('/auth/confirm', { body: { token } });
        assert.equal(response.status, 303);
        const cookie = response.headers.get('set-cookie').split(';')[0];
        assert.equal((await request('/api/app/bookings', { cookie })).status, 200);
        return { cookie, token };
      },
    };
  } catch (error) { await mf.dispose(); throw error; }
}
