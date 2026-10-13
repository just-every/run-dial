import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { evidencePath } from '../../scripts/evidence-path.mjs';

/** Real document submissions with JavaScript disabled, including one-use native authority. */
export async function nativeSignIn(page, { origin, email, width, privateValues = [] }) {
 let phase = 'sign-in document';
 const evidence = { width, javaScriptEnabled: false };
 try {
  const document = await page.goto(origin + '/signin');
  assert.equal(document.status(), 200);
  const input = page.getByLabel('Email address', { exact: true });
  const button = page.getByRole('button', { name: 'Send magic link', exact: true });
  const form = page.locator('form').filter({ has: input });
  await expect(input).toBeVisible(); await expect(input).toBeEnabled();
  await expect(button).toBeVisible(); await expect(button).toBeEnabled();
  await expect(input).toBeInViewport(); await expect(button).toBeInViewport();
  await expect(form).toHaveAttribute('method', 'post');
  await expect(form).toHaveAttribute('action', '/auth/magic-link');
  // Save the server response before any field is filled. Drop executable payloads
  // and redact the checkout's known private settings before writing evidence.
  let html = (await document.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '<!-- script omitted -->');
  for (const value of privateValues.filter(Boolean)) html = html.split(value).join('[redacted]');
  await writeFile(evidencePath(`native-signin-${width}.html`), html, { mode: 0o600 });
  await page.screenshot({ path: evidencePath(`native-signin-${width}.png`), fullPage: true });
  evidence.form = { method: await form.getAttribute('method'), action: await form.getAttribute('action'), enabled: true, visible: true };

  phase = 'cross-origin link request';
  const denied = await page.request.post(origin + '/auth/magic-link', {
   headers: { origin: 'https://cross-origin.invalid' }, form: { email, returnTo: '/setup' }, maxRedirects: 0,
  });
  assert.equal(denied.status(), 303);
  const deniedLocation = new URL(denied.headers().location, origin);
  assert.equal(deniedLocation.pathname, '/signin');
  assert.equal(deniedLocation.searchParams.get('notice'), 'invalid_origin');
  evidence.crossOriginRequest = 'invalid_origin';

  phase = 'native link request';
  await input.fill(email);
  const requestResponse = page.waitForResponse(response => response.url() === origin + '/auth/magic-link' && response.request().method() === 'POST');
  await button.click();
  const accepted = await requestResponse;
  assert.equal(accepted.status(), 303);
  assert.equal(accepted.request().resourceType(), 'document');
  assert.match(accepted.request().headers()['content-type'], /^application\/x-www-form-urlencoded\b/i);
  evidence.request = { method: 'POST', path: '/auth/magic-link', status: accepted.status(), resourceType: 'document' };
  await page.waitForURL(origin + '/__dev/outbox');

  phase = 'outbox sign-in message';
  const messages = page.locator('article').filter({ has: page.getByRole('heading', { level: 2, name: 'Your sign-in link for Dial', exact: true }) });
  evidence.matchingMessages = await messages.count();
  await messages.first().getByRole('link', { name: 'Read message', exact: true }).click();
  await page.getByRole('link', { name: 'Open this link', exact: true }).click();
  const token = new URL(page.url()).searchParams.get('token');
  assert.ok(token);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  assert.equal((await page.request.get(origin + '/api/app/session')).status(), 401, 'preview does not authenticate');

  phase = 'cross-origin confirmation';
  const crossOrigin = await page.request.post(origin + '/auth/confirm', { headers: { origin: 'https://cross-origin.invalid' }, form: { token }, maxRedirects: 0 });
  assert.equal(crossOrigin.status(), 403);
  evidence.crossOriginConfirmation = crossOrigin.status();

  phase = 'native confirmation';
  const setupResponse = page.waitForResponse(response => response.url() === origin + '/setup' && response.request().resourceType() === 'document');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForURL(origin + '/setup');
  const setupDocument = await setupResponse;
  assert.equal(setupDocument.status(), 200);
  assert.match(setupDocument.headers()['content-type'], /^text\/html\b/i);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const guarded = await page.request.get(origin + '/app/bookings', { maxRedirects: 0 });
  assert.equal(guarded.headers().location, '/setup');
  assert.equal((await page.request.get(origin + '/api/app/profile')).status(), 200);
  assert.equal((await page.request.get(origin + '/api/app/session')).status(), 200);
  evidence.confirmation = { destination: '/setup', status: 200, session: 200 };

  phase = 'one-use confirmation';
  const replay = await page.request.post(origin + '/auth/confirm', { headers: { origin }, form: { token }, maxRedirects: 0 });
  assert.equal(replay.status(), 400);
  evidence.replay = replay.status();
  evidence.passed = true;
  console.info(`Native pre-hydration sign-in: ${JSON.stringify(evidence)}`);
 } catch {
  // Playwright errors can contain credentials in URLs or DOM fragments. Phase
  // and width are enough to locate a failure without publishing those values.
  throw Error(`Native pre-hydration sign-in failed during ${phase} at ${width}px; credential-bearing diagnostics suppressed.`);
 } finally {
  await writeFile(evidencePath(`native-signin-${width}.json`), JSON.stringify({ ...evidence, phase }, null, 2), { mode: 0o600 });
 }
}
