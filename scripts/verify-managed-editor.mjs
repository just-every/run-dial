import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { localMagicLink } from '../tests/auth-client.mjs';
import { admissionRuntime, sessionCookie } from '../tests/managed-admission/runtime.mjs';
import { managementEdge } from '../tests/managed-admission/management-edge.mjs';
import { establishEditorWorkspace } from '../tests/managed-admission/ready-workspace.mjs';
import { publishCompiledEdits, compiledNavigation, focusedEditorContinuity } from '../tests/managed-admission/editor-journey.mjs';
import { evidencePath } from './evidence-path.mjs';

const snapshotFile = new URL('../src/core/features/editor/visual-edits.json', import.meta.url);
const originalSnapshot = await readFile(snapshotFile);
const edge = await managementEdge();
let app, browser;
try {
  app = await admissionRuntime({ managementOrigin: edge.origin });
  edge.state.allowed = app.origin;
  assert.equal((await app.call('/api/editor/config')).status, 403);
  const admitted = await app.call('/auth/owner-claim', { token: app.token(), returnTo: '/app' });
  assert.equal(admitted.status, 303);
  let cookie = sessionCookie(admitted);
  await establishEditorWorkspace(app.origin, cookie);
  const freshCookie = async () => {
    assert.equal((await app.call('/auth/magic-link', { email: 'owner@dial.test', returnTo: '/app' })).status, 202);
    const { developmentLink } = await localMagicLink(app.origin);
    const token = new URL(developmentLink).searchParams.get('token');
    const response = await app.call('/auth/confirm', { token }); assert.equal(response.status, 303);
    return sessionCookie(response);
  };
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const results = [];
  for (const width of [1440, 390]) {
    if (results.length) cookie = await freshCookie();
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const external = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === app.origin || url.origin === edge.origin) return route.continue();
      external.push(url.origin); return route.abort();
    });
    try {
      const page = await context.newPage();
      const framingRefusals = [];
      page.on('console', message => { if (message.type() === 'error' && /frame-ancestors|framing/i.test(message.text())) framingRefusals.push(true); });
      await page.goto(app.origin + '/app');
      await page.waitForURL('**/signin?**');
      assert.equal(await page.locator('[data-rer-editor]').count(), 0);
      const [name, value] = cookie.split('='); await context.addCookies([{ name, value, url: app.origin, httpOnly: true, sameSite: 'Lax' }]);
      const document = await page.goto(app.origin + '/app');
      assert.equal(document.status(), 200);
      assert.equal(document.url(), app.origin + '/app', 'The completed workspace serves the native app document');
      assert.ok(document.headers()['content-security-policy'].includes(`frame-ancestors 'self' ${edge.origin};`));
      if (!results.length) await publishCompiledEdits(page, app.origin, snapshotFile);
      await compiledNavigation(page, app.origin, width);
      const host = page.locator('[data-rer-editor]');
      await host.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-rer-editor]')?.getAttribute('data-connection') === 'connected');
      await host.getByRole('button', { name: 'Open Run Edit Run' }).click();
      const frame = host.locator('iframe'); await frame.waitFor({ state: 'visible' });
      const bounds = await frame.boundingBox(); assert.equal(Math.round(bounds.width), width); assert.ok(bounds.x >= 0 && bounds.y >= 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth), true);
      await focusedEditorContinuity(page, context, frame);
      await page.screenshot({ path: evidencePath(`managed-editor-${width}.png`) });
      edge.state.denied = true;
      await page.reload(); await host.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-rer-editor]')?.getAttribute('data-connection') !== 'connected');
      await page.waitForTimeout(1500);
      assert.ok(framingRefusals.length, 'Chromium enforces the management edge frame-ancestors refusal');
      edge.state.denied = false;
      await page.reload(); await host.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-rer-editor]')?.getAttribute('data-connection') === 'connected');
      // A failed refresh cannot extend a granted lease. Browser time controls only the client.
      const granted = await app.call('/api/editor/config', undefined, { cookie });
      assert.equal(granted.status, 200);
      const lease = await granted.json();
      await page.clock.install();
      await context.route('**/api/editor/config', route => route.abort());
      await page.clock.fastForward(Math.max(0, lease.expiresAt - Date.now()) + 1);
      await page.waitForFunction(() => !document.querySelector('[data-rer-editor]'));
      await context.unroute('**/api/editor/config');
      await page.clock.setSystemTime(new Date());
      await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
      await host.waitFor();
      // Native session revocation, then actual app logout, each remove authority.
      const session = await (await app.call('/auth/session', undefined, { cookie })).json();
      assert.equal((await app.call('/auth/session/revoke', { sessionId: session.id }, { cookie })).status, 204);
      await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => !document.querySelector('[data-rer-editor]'));
      assert.equal((await app.call('/api/editor/config', undefined, { cookie })).status, 403);
      cookie = await freshCookie();
      const [freshName, freshValue] = cookie.split('='); await context.addCookies([{ name: freshName, value: freshValue, url: app.origin, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto(app.origin + '/app/settings'); await host.waitFor();
      if (width < 1024) await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).filter({ visible: true }).click();
      await page.waitForURL('**/signin');
      assert.equal(await host.count(), 0);
      assert.equal((await app.call('/api/editor/config', undefined, { cookie })).status, 403);
      assert.deepEqual(external, [], 'browser journey uses only the product and local management edge');
      results.push({ width, nativeOwner: true, anonymousGate: true, compiledSourceEdits: true, routeRemounts: true, focusDraftContinuity: true, concurrentFocus: true, exactCsp: true, browserCspRefusal: true, leaseExpiry: true, sessionRevocation: true, logout: true });
    } finally { await context.close(); }
  }
  await writeFile(evidencePath('managed-editor-results.json'), JSON.stringify({ results, externalNetwork: false, scope: 'Local native Worker and exact Base editor with local management edge; hosted acceptance remains separate.' }, null, 2));
  console.log('Managed editor browser journey passed at 1440 and 390.');
} finally {
  try { await browser?.close(); await app?.close(); }
  finally { await Promise.all([writeFile(snapshotFile, originalSnapshot), edge.close()]); }
}
