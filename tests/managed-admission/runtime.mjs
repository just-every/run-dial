import { fixtureVite } from "../native-process/vite.mjs";
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_DEV_KEY, devKeyHeaders } from '../dev-key.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const origin = 'http://127.0.0.1:15766';
export const setupToken = 'test-only-native-setup-token-at-least-32-bytes';
export async function admissionRuntime({ managed = true, managementOrigin = 'http://127.0.0.1:15767' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dial-managed-'));
  const config = join(directory, 'wrangler.toml'), persist = join(directory, 'state');
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const variables = {
    ENVIRONMENT: 'development', APP_URL: origin, OWNER_EMAIL: 'owner@dial.test',
    SESSION_SECRET: 'test-only-native-session-secret-at-least-32-bytes', SETUP_TOKEN: setupToken,
    MAIL_PROVIDER: 'development', MAIL_FROM: 'no-reply@dial.test', RER_DEV_KEY: TEST_DEV_KEY,
    RER_MANAGEMENT_ORIGIN: managementOrigin, RER_INSTALLATION_ID: 'dial-local-admission',
    ...(managed ? { RER_OWNER_CLAIM_ISSUER: managementOrigin, RER_OWNER_CLAIM_INSTALLATION_ID: 'dial-local-admission', RER_OWNER_CLAIM_APP_ORIGIN: origin,
      RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify({ current: keys.publicKey.export({ format: 'jwk' }) }) } : {}),
  };
  const template = await readFile(join(root, 'deploy/wrangler.template.toml'), 'utf8');
  let source = template.replace('[vars]\nENVIRONMENT = "production"\n\n', '').replace(/^main = .+$/m, `main = ${JSON.stringify(join(root, 'tests/managed-admission/worker.ts'))}`)
    .replace(/^migrations_dir = .+$/m, `migrations_dir = ${JSON.stringify(join(root, 'migrations/core'))}`)
    .replace('[triggers]\ncrons = ["* * * * *"]', '');
  // Producers stay; the real queue consumer starts only with DIAL_TEST_QUEUE_CONSUMERS=1.
  if (process.env.DIAL_TEST_QUEUE_CONSUMERS !== '1') source = source.replace(/\[\[queues.consumers\]\][\s\S]*?(?=\[\[durable_objects)/, '');
  await writeFile(config, source + '\n[vars]\n' + Object.entries(variables).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  const env = Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','CI'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { CI: '1', DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: persist, DIAL_DISABLE_INSPECTOR: '1', WRANGLER_SEND_METRICS: 'false' });
  let server;
  function execute(args) {
    return new Promise((done, reject) => {
      const child = spawn('pnpm', args, { cwd: root, env, stdio: 'ignore' });
      child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(`Local admission command failed (${code})`)));
    });
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const exit = new Promise(done => server.once('exit', done));
    process.kill(-server.pid, 'SIGTERM'); await exit; server = undefined;
  }
  const call = (path, body, headers = {}) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { ...devKeyHeaders, ...(body === undefined ? {} : { origin, 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function start() {
    server = spawn('pnpm', [...fixtureVite, '--host', '127.0.0.1', '--port', '15766', '--strictPort'], { cwd: root, env, stdio: 'ignore', detached: true });
    for (let i = 0; i < 480; i++) {
      if (server.exitCode !== null) throw new Error('Admission Worker exited during startup');
      try { if ((await call('/health')).ok) return; } catch { /* bounded local startup */ }
      await new Promise(done => setTimeout(done, 125));
    }
    throw new Error('Admission Worker startup timed out');
  }
  try { await execute(['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist, '--config', config]); await start(); }
  catch (error) { await stop(); await rm(directory, { recursive: true, force: true }); throw error; }
  return {
    origin, call,
    token(overrides = {}, headerOverrides = {}) {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'rer-owner-claim+jwt', kid: 'current', ...headerOverrides })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ v: 1, iss: managementOrigin, aud: origin, installationId: 'dial-local-admission', email: 'owner@dial.test', jti: randomUUID(), iat: now, exp: now + 120, ...overrides })).toString('base64url');
      const input = `${header}.${payload}`;
      return `${input}.${sign('sha256', Buffer.from(input), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    },
    state: async () => (await call('/__test/admission')).json(),
    control: async action => { const response = await call('/__test/admission', { action }); if (!response.ok) throw new Error('Admission test control failed'); return response.json(); },
    restart: async () => { await stop(); await start(); },
    close: async () => { await stop(); await rm(directory, { recursive: true, force: true }); },
  };
}
export function sessionCookie(response) {
  const value = response.headers.get('set-cookie');
  if (!value) throw new Error('Native admission returned no session cookie');
  return value.split(';')[0];
}
