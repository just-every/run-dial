import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** One owner journey through real hydrated pages and the emitted Worker. */
export async function senderHealthJourney(page, origin, screenshot, selectClient) {
  const differences = [];
  for (const width of [1440, 390]) {
    selectClient(width);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    let probes = 0;
    const observe = request => { if (new URL(request.url()).pathname === '/api/app/platform-health') probes++; };
    page.on('request', observe);
    // A slow independent check must not erase a result already shown to the
    // owner. Delay a repeated request; its real Worker response is unchanged.
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const holdRepeatedProbe = async route => { if (probes > 1) await delayed; await route.fallback(); };
    await page.route('**/api/app/platform-health', holdRepeatedProbe);
    await page.goto(origin + '/app');
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Integrations and delivery', exact: true }) });
    for (const name of ['database', 'storage', 'queue']) {
      await expect(panel.getByRole('heading', { name, exact: true }).locator('..')).toContainText('Healthy');
    }
    const independent = () => Promise.all(['Dial availability', 'database', 'storage', 'queue'].map(name => panel.getByRole('heading', { name, exact: true }).locator('..').innerText()));
    const before = await independent();
    await screenshot(`sender-health-${width}-before-check.png`);
    if (width === 390) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Check sender', exact: true }).click();
    await expect(page.getByText('Mail sender verified.', { exact: true })).toBeVisible();
    await screenshot(`sender-settings-${width}-checked.png`);
    if (width === 390) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('link', { name: 'Overview', exact: true }).filter({ visible: true }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Transactional mail', exact: true }).locator('../..')).toContainText('healthy');
    const after = await independent();
    await screenshot(`sender-health-${width}-after-check.png`);
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    differences.push({ width, before, after, probes });
    const resumed = probes > 1 ? page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/platform-health') : undefined;
    release();
    if (resumed) await (await resumed).finished();
    await page.unroute('**/api/app/platform-health', holdRepeatedProbe);
    page.off('request', observe);
  }
  for (const { width, before, after, probes } of differences) {
    assert.deepEqual(after, before, `${width}px: sender check preserves independent health labels and timestamps`);
    assert.equal(probes, 1, `${width}px: sender check does not restart platform checks`);
  }
}
