import { rerEntry } from '../rer-command.mjs';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../', import.meta.url));
let checkout;
export function operationsCheckout() {
  if (checkout) return checkout;
  checkout = realpathSync(mkdtempSync(join(tmpdir(), 'dial-operations-')));
  // Exercise Dial's actual declared adapter and validator in an isolated checkout.
  // Dependencies are the runner's installed, frozen dependencies; no fake tool or adapter.
  for (const name of execFileSync('git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean)) {
    const target = join(checkout, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, name), target);
  }
  symlinkSync(join(source, 'node_modules'), join(checkout, 'node_modules'), 'dir');
  const settings = {
    OWNER_EMAIL: 'doctor-owner@fixture.test', APP_URL: 'http://127.0.0.1:8787',
    SESSION_SECRET: 'synthetic-doctor-local-settings-secret-'.repeat(2),
  };
  writeFileSync(join(checkout, '.dev.vars'), Object.entries(settings).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  return checkout;
}
after(() => { if (checkout) rmSync(checkout, { recursive: true, force: true }); });

// Non-string bindings and NUL have native runtime coverage; OS environments cannot carry them.
export function cliRepresentable(env) {
  return Object.values(env).every(value => value === undefined || typeof value === 'string' && !value.includes('\0'));
}
export function operationsCommand(env, command = 'doctor', { entry = rerEntry } = {}) {
  assert.ok(cliRepresentable(env), 'CLI inputs must be representable by a real OS environment');
  const result = spawnSync(process.execPath, [entry, command, '--json'], {
    cwd: operationsCheckout(), encoding: 'utf8',
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ...env },
  });
  assert.equal(result.error, undefined, 'public command starts');
  const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const outcome = command === 'describe' ? events.at(-1) : events.findLast(event => event.event === 'result');
  assert.ok(outcome, 'public command returns its result');
  const text = result.stdout + result.stderr;
  for (const [key, value] of Object.entries(env)) {
    if (!['ENVIRONMENT', 'MAIL_PROVIDER', 'PATH', 'TMPDIR'].includes(key) && typeof value === 'string' && value.length >= 8)
      assert.equal(text.includes(value), false, 'supplied configuration stays private');
  }
  assert.equal(/\bat .*\(.*:\d+:\d+\)/.test(result.stderr), false, 'no exception stack disclosed');
  return { ...result, outcome, output: outcome.diagnostics ?? outcome };
}
function doctorResult(env, ready) {
  const result = operationsCommand(env);
  assert.equal(result.status, ready ? 0 : 3, 'doctor exit reflects local readiness');
  assert.equal(result.outcome.ok, ready);
  assert.equal(result.output.ok, ready);
  assert.equal(result.output.scope, 'local-inputs-only');
  assert.equal(result.output.state.safe, true);
  return result;
}

let prerequisitesChecked = false;
export function checkDoctor(env, ready) {
  if (!prerequisitesChecked) {
    // Prove this real checkout can pass doctor before accepting configuration refusals.
    // Doctor itself validates the installed tools, private settings and state.
    doctorResult({
      ENVIRONMENT: 'production', APP_URL: 'https://doctor.fixture.test',
      OWNER_EMAIL: 'doctor-owner@fixture.test',
      SESSION_SECRET: 'doctor-prerequisite-session-'.repeat(2),
      SETUP_TOKEN: 'doctor-prerequisite-setup-'.repeat(2),
      MAIL_PROVIDER: 'sendgrid', MAIL_FROM: 'no-reply@fixture.test',
      MAIL_API_KEY: 'synthetic-doctor-prerequisite-synthetic-key',
    }, true);
    prerequisitesChecked = true;
  }
  return doctorResult(env, ready);
}
