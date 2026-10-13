import assert from 'node:assert/strict';
import { readFile, stat, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { contract } from './contract.mjs';
import { freshCopy, runRer, start, variables, removeCopy, assertPrivateBuild } from './local-setup/runtime.mjs';
import { completeFirstRun } from './local-setup/first-run.mjs';
import { browserJourney } from './local-setup/browser.mjs';
import { devIdentityJourney } from './local-setup/dev-identity.mjs';
import { openGateFromLink } from './dev-key.mjs';
import { nativeSignIn } from './local-setup/native-signin.mjs';

contract('OPER-001', 'README public CLI preserves its owner at 1440/390, signs in before hydration, resets and round-trips complete local data', async () => {
 for (const width of [1440, 390]) {
  const directory = await freshCopy(); let server, browser;
  try {
   await runRer(directory, ['install'], { timeout: 300_000 });
   await runRer(directory, ['check', '--profile', 'first-party']);
   const args = ['setup', '--owner-email', 'local-owner@example.test', '--port', '15750', '--non-interactive'];
   await runRer(directory, args, { timeout: 300_000 });
   const values = await variables(directory), privateBytes = await readFile(join(directory, '.dev.vars'));
   const privateMode = (await stat(join(directory, '.dev.vars'))).mode;
   await assert.rejects(fetch(values.APP_URL + '/health'), 'setup leaves no running app');
   await runRer(directory, args, { timeout: 300_000 });
   assert.ok((await readFile(join(directory, '.dev.vars'))).equals(privateBytes));
   assert.equal((await stat(join(directory, '.dev.vars'))).mode, privateMode);
   await runRer(directory, ['setup', '--owner-email', 'other@example.test', '--non-interactive'], { expected: 4 });
   await assertPrivateBuild(directory, values);
   // --login keeps the outbox sign-in (the kept end-to-end email-link journey); the key gate still protects the outbox.
   server = await start(directory, 'dev', values.APP_URL, ['--login']);
   await runRer(directory, ['reset', '--yes'], { expected: 4 });
   await runRer(directory, ['outbox']);
   browser = await chromium.launch({ headless: true });
   const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
   await openGateFromLink(context, server.openUrl);
   const page = await context.newPage();
   await nativeSignIn(page, { origin: values.APP_URL, email: values.OWNER_EMAIL, width, privateValues: [values.SESSION_SECRET, values.SETUP_TOKEN, values.RER_DEV_KEY] });
   await browser.close(); browser = undefined;
   let savedProfile;
   await browserJourney(values.APP_URL, { email: values.OWNER_EMAIL, width, openUrl: server.openUrl, onSignedIn: async (page, onPhase) => {
    savedProfile = await completeFirstRun(page, values.APP_URL, onPhase);

   } });
   await runRer(directory, ['dev', '--stop']); await server.owned.stop(); server = undefined;
   await runRer(directory, ['export', '--output', 'exports/first.rer']);
   await runRer(directory, ['import', '--input', 'exports/first.rer', '--yes'], { expected: 4 });
   await runRer(directory, ['reset', '--non-interactive'], { expected: 4 });
   await mkdir(join(directory, '.rer/deploy'), { recursive: true });
   await writeFile(join(directory, '.rer/deploy/preserved.json'), '{"ownerReceipt":true}');
   await runRer(directory, ['reset', '--yes']);
   await access(join(directory, 'exports/first.rer')); await access(join(directory, '.rer/deploy/preserved.json'));
   // Salt transfer is a separate private owner operation, never archive data.
   await writeFile(join(directory, '.dev.vars'), privateBytes, { mode: 0o600 });
   await runRer(directory, ['import', '--input', 'exports/first.rer', '--yes']);
   await runRer(directory, ['export', '--output', 'exports/second.rer']);
   const closing = async name => JSON.parse((await readFile(join(directory, 'exports', name), 'utf8')).trim().split('\n').at(-1));
   assert.equal((await closing('first.rer')).contentHash, (await closing('second.rer')).contentHash);
   // README restores private settings and data before rerunning setup.
   await runRer(directory, args, { timeout: 300_000 });
   server = await start(directory, 'dev', values.APP_URL, ['--login']);
   await browserJourney(values.APP_URL, { email: values.OWNER_EMAIL, width, completed: true, openUrl: server.openUrl, issuedSignInUrl: server.signInUrl });
   await runRer(directory, ['dev', '--stop']); await server.owned.stop(); server = undefined;
   server = await start(directory, 'preview', values.APP_URL);
   await browserJourney(values.APP_URL, { email: values.OWNER_EMAIL, width, completed: true, openUrl: server.openUrl, issuedSignInUrl: server.signInUrl, onSignedIn: async page => {
    assert.deepEqual(await (await page.request.get(values.APP_URL + '/api/app/profile')).json(), savedProfile);
    assert.ok((await (await page.request.get(values.APP_URL + '/api/app/host-setup')).json()).completedAt);
    await page.goto(values.APP_URL + '/setup'); await page.waitForURL(values.APP_URL + '/app');
    await page.goto(values.APP_URL + '/app/settings');
    assert.equal((await page.request.get(values.APP_URL + '/api/app/profile')).status(), 200);
   } });
   await runRer(directory, ['preview', '--stop']); await server.owned.stop(); server = undefined;
   await runRer(directory, ['reset', '--yes']);
   await runRer(directory, args, { timeout: 300_000 });
   server = await start(directory, 'dev', values.APP_URL);
   await devIdentityJourney(server, values.APP_URL, { width, email: values.OWNER_EMAIL, onSignedIn: async page => {
    assert.equal(await (await page.request.get(values.APP_URL + '/api/app/profile')).json(), null);
    assert.deepEqual(await (await page.request.get(values.APP_URL + '/api/app/event-types')).json(), []);
    assert.equal((await (await page.request.get(values.APP_URL + '/api/app/host-setup')).json()).completedAt, null);
    await page.goto(values.APP_URL + '/app/settings'); await page.waitForURL(values.APP_URL + '/setup');
   } });
   await runRer(directory, ['dev', '--stop']); await server.owned.stop(); server = undefined;
  } finally { await browser?.close(); await server?.owned.stop(); await removeCopy(directory); }
 }
});
