import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Saved edits recheck publication without replacing the event or waiting for provider health. */
export async function editorReadinessJourney({ page, origin, f, event, calls, screenshot, selectClient }) {
  for (const width of [1440, 390]) {
    selectClient(width);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const name = page.getByLabel('Name', { exact: true });
    const description = page.getByRole('textbox', { name: 'Description', exact: true });
    const recorded = async () => (await f.db.prepare('SELECT status,last_checked_at AS checkedAt FROM provider_connection_health').all()).results;
    const nextReadiness = () => page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/event-types/${event.id}/readiness`);
    async function open(reload = false) {
      if (reload) await page.reload(); else await page.goto(origin + `/app/event-types/${event.id}`);
      await page.locator('[data-operator-ready="true"]').waitFor();
      await expect(name).toHaveValue(event.title);
      // Hydration consumes the document's workspace read; this read checks the same public API contract.
      const response = await f.request(`/api/app/event-types/${event.id}/readiness`); assert.equal(response.status, 200);
      return response.json();
    }

    // Only a sender that was never checked waits for one check, which is then recorded.
    await f.db.prepare('DELETE FROM provider_connection_health').run();
    const unrecorded = calls.length;
    assert.equal((await open()).ready, true);
    assert.equal(calls.length, unrecorded + 1, `${width}px: an unchecked sender is checked once`);
    assert.equal((await recorded())[0]?.status, 'healthy');

    // A current record is read as it stands; viewing makes no provider request.
    const viewed = calls.length;
    assert.equal((await open(true)).ready, true);
    await expect(page.getByRole('button', { name: 'Event actions', exact: true })).toBeEnabled();
    assert.equal(calls.length, viewed, `${width}px: a current recorded check needs no provider request`);
    await screenshot(`editor-readiness-${width}-current.png`);

    // A save starts a separate readiness read: the page stays editable and in place.
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/api/app/event-types/*/readiness', async route => { await held; await route.fallback(); });
    const original = await description.inputValue(), edited = `${original} Reviewed at ${width}px.`;
    const position = await name.boundingBox(), descriptionPosition = await description.boundingBox();
    try {
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/event-types/${event.id}/details` && response.request().method() === 'PATCH');
      await description.fill(edited); await description.blur();
      assert.equal((await saved).status(), 200);
      const savedMark = page.getByRole('status').filter({ hasText: /^Saved$/ });
      await expect(savedMark).toBeVisible();
      const savedAppearance = await savedMark.evaluate(element => ({ display: globalThis.getComputedStyle(element).display, fontSize: globalThis.getComputedStyle(element).fontSize, iconHeight: element.querySelector('svg')?.getBoundingClientRect().height }));
      console.log(`${width}px saved appearance: ${JSON.stringify(savedAppearance)}`);
      await expect(description).toBeEditable();
      await expect(name).toBeEditable();
      await expect(page.getByRole('button', { name: 'Event actions', exact: true })).toBeEnabled();
      assert.deepEqual(await name.boundingBox(), position, `${width}px: a pending check does not move the form`);
      assert.deepEqual(await description.boundingBox(), descriptionPosition, `${width}px: saving keeps the edited field in place`);
      await screenshot(`editor-readiness-${width}-checking.png`);
    } finally {
      const answered = nextReadiness();
      release();
      assert.equal((await (await answered).json()).ready, true);
      await page.unrouteAll({ behavior: 'wait' });
    }
    assert.deepEqual(await name.boundingBox(), position, `${width}px: arriving readiness does not move the form`);
    assert.deepEqual(await description.boundingBox(), descriptionPosition, `${width}px: arriving readiness keeps the edited field in place`);
    assert.equal((await (await f.request(`/api/app/event-types/${event.id}`)).json()).description, edited);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/event-types/${event.id}/details` && response.request().method() === 'PATCH');
    const checked = nextReadiness();
    await description.fill(original); await description.blur();
    assert.equal((await saved).status(), 200); assert.equal((await (await checked).json()).ready, true);
    assert.equal((await (await f.request(`/api/app/event-types/${event.id}`)).json()).description, original);
    await page.reload(); await expect(description).toHaveValue(original);

    // A stale provider record is returned with its time, then refreshed independently.
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await f.db.prepare('UPDATE provider_connection_health SET last_checked_at=?').bind(old).run();
    const stale = calls.length, snapshot = await (await f.request(`/api/app/event-types/${event.id}/readiness`)).json();
    assert.equal(snapshot.ready, true);
    assert.equal(snapshot.recorded, 'stale'); assert.equal(snapshot.checkedAt, old);
    assert.equal((await open(true)).ready, true);
    await screenshot(`editor-readiness-${width}-stale.png`);
    await expect.poll(async () => (await recorded())[0].checkedAt).not.toBe(old);
    assert.ok(calls.length > stale, `${width}px: the refresh checks the provider after the response`);

    // A recorded failure stays visible under the live event's header, with its repair link.
    await f.db.prepare("UPDATE provider_connection_health SET status='unhealthy',unhealthy_code='unauthorized',last_checked_at=?").bind(new Date().toISOString()).run();
    const unhealthy = calls.length, refused = await open(true);
    assert.equal(refused.ready, false); assert.ok(refused.missing.includes('transactional_mail'));
    await expect(page.getByRole('link', { name: 'Verify the transactional mail sender.', exact: true })).toBeVisible();
    assert.equal(calls.length, unhealthy, `${width}px: a recorded failure needs no provider request`);
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    await screenshot(`editor-readiness-${width}-unhealthy.png`);
    assert.equal((await f.request('/api/app/mail/check', {})).status, 200);
    const advanced = page.getByRole('link', { name: /^Advanced settings/ });
    const originalRow = await advanced.elementHandle();
    await advanced.focus(); await page.keyboard.press('Enter');
    await page.waitForURL(origin + `/app/event-types/${event.id}/advanced`);
    const sheet = page.getByRole('dialog', { name: 'Advanced settings', exact: true });
    await expect(sheet).toBeVisible();
    const bounds = await sheet.boundingBox(), viewport = page.viewportSize();
    assert.equal(bounds.x + bounds.width, viewport.width); assert.equal(bounds.y, 0); assert.equal(bounds.height, viewport.height);
    if (width === 390) assert.equal(bounds.width, viewport.width); else assert.ok(bounds.width < viewport.width);
    console.log(`${width}px production Advanced sheet: ${JSON.stringify(bounds)}`);
    const close = page.getByRole('button', { name: 'Close settings', exact: true }), closeBounds = await close.boundingBox();
    assert.ok(closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= viewport.height);
    await screenshot(`editor-advanced-${width}.png`);
    await close.focus(); await page.keyboard.press('Enter');
    await page.waitForURL(origin + `/app/event-types/${event.id}`); await expect(advanced).toBeFocused();
    assert.equal(await advanced.evaluate((element, previous) => element === previous, originalRow), true);
    await page.keyboard.press('Enter'); await expect(sheet).toBeVisible(); await page.keyboard.press('Escape');
    await page.waitForURL(origin + `/app/event-types/${event.id}`); await expect(advanced).toBeFocused();
  }
}
