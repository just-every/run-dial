import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { contract } from './contract.mjs';
import { invalidConfigurationNames } from '../scripts/operations-config.mjs';

async function load(path) {
  const compiled = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
}
const base = {
  ENVIRONMENT: 'production', APP_URL: 'https://dial.example.test', SESSION_SECRET: 'test-only-session-secret-with-at-least-32-characters',
  OWNER_EMAIL: 'owner@example.test', SETUP_TOKEN: 'test-only-setup-secret-with-at-least-32-characters', MAIL_FROM: 'no-reply@example.test',
};
const legacy = { RESEND_API_KEY: 'test-only-legacy-key', RESEND_FROM_EMAIL: 'help@example.test', RESEND_WEBHOOK_SECRET: 'test-only-legacy-webhook' };

contract('NOTIFY-006', 'operations follows actual runtime sender selection for deployed providers and explicit loopback development without a credential fallback', async () => {
  const { parseRuntimeEnvironment } = await load('../src/core/shared/runtime-env.ts');
  const { mailConfiguration } = await load('../src/core/platform/mail/base-mail.ts');
  for (const provider of ['sendgrid', 'resend']) {
    const env = { ...base, ...legacy, MAIL_PROVIDER: provider, MAIL_API_KEY: 'test-only-active-key' };
    assert.deepEqual(invalidConfigurationNames(env), []);
    const selected = mailConfiguration(parseRuntimeEnvironment(env));
    assert.equal(selected.provider, provider); assert.equal(selected.from, base.MAIL_FROM);
    const invalid = { ...env, MAIL_FROM: 'help@example.test', RESEND_FROM_EMAIL: 'noreply@example.test' };
    assert.deepEqual(invalidConfigurationNames(invalid), ['MAIL_FROM']);
    const missing = { ...env }; delete missing.MAIL_FROM;
    assert.ok(invalidConfigurationNames(missing).includes('MAIL_FROM'));
    assert.equal(mailConfiguration(parseRuntimeEnvironment(missing)).from, undefined);
  }
  const local = { ...base, ENVIRONMENT: 'development', APP_URL: 'http://127.0.0.1:8787', MAIL_PROVIDER: 'development' };
  assert.deepEqual(invalidConfigurationNames(local), []);
  const selected = mailConfiguration(parseRuntimeEnvironment(local));
  assert.equal(selected.provider, 'development'); assert.equal(selected.apiKey, undefined);
  for (const env of [
    { ...local, APP_URL: 'https://remote.example.test' },
    { ...local, ENVIRONMENT: 'preview' },
    { ...local, ENVIRONMENT: 'production', APP_URL: 'https://localhost' },
    { ...base, MAIL_PROVIDER: 'unknown', MAIL_API_KEY: 'test-only-key' },
  ]) {
    assert.ok(invalidConfigurationNames(env).includes('MAIL_PROVIDER'));
    assert.throws(() => parseRuntimeEnvironment(env), /Invalid runtime configuration/);
  }
});
