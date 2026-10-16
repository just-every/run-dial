import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** The event editor renders and edits its own event while readiness arrives beside it from recorded provider health. */
export async function editorReadinessJourney({ page, origin, f, event, calls, screenshot, selectClient }) {
  for (const width of [1440, 390]) {
    selectClient(width);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const readiness = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Event type readiness', exact: true }) });
    const name = page.getByLabel('Event name', { exact: true });
    const description = page.getByRole('textbox', { name: /^Description\b/ });
    const save = page.getByRole('button', { name: 'Save changes', exact: true });
    const update = page.getByRole('button', { name: 'Update published event', exact: true });
    const checkedLabel = readiness.getByText(/^Connections last checked .+\.$/);
    const recorded = async () => (await f.db.prepare('SELECT status,last_checked_at AS checkedAt FROM provider_connection_health').all()).results;

    // Only a sender that was never checked waits for one check, which is then recorded.
    await f.db.prepare('DELETE FROM provider_connection_health').run();
    const unrecorded = calls.length;
    await page.goto(origin + `/app/event-types/${event.id}`);
    await expect(readiness).toContainText('Required publication checks passed.');
    assert.equal(calls.length, unrecorded + 1, `${width}px: an unchecked sender is checked once`);
    assert.equal((await recorded())[0]?.status, 'healthy');

    // A current record is shown as it stands; viewing makes no provider request.
    const viewed = calls.length;
    await page.reload();
    await expect(name).toHaveValue(event.title);
    await expect(readiness).toContainText('Required publication checks passed.');
    await expect(update).toBeEnabled();
    await expect(checkedLabel).toHaveCount(0);
    assert.equal(calls.length, viewed, `${width}px: a current recorded check needs no provider request`);
    await screenshot(`editor-readiness-${width}-current.png`);

    // After a save, readiness reloads in its own section: the form stays editable and in place.
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/api/app/event-types/*/readiness', async route => { await held; await route.fallback(); });
    const original = await description.inputValue(), edited = `${original} Reviewed at ${width}px.`;
    const position = await name.boundingBox();
    try {
      await description.fill(edited);
      await save.click();
      await expect(readiness).toContainText('Checking configured connections…');
      await expect(save).toBeEnabled();
      await expect(description).toBeEditable();
      await expect(update).toBeDisabled();
      assert.deepEqual(await name.boundingBox(), position, `${width}px: a pending check does not move the form`);
      await screenshot(`editor-readiness-${width}-checking.png`);
    } finally {
      const answered = page.waitForResponse(response => response.url().endsWith(`/api/app/event-types/${event.id}/readiness`));
      release();
      await answered;
      await page.unrouteAll({ behavior: 'wait' });
    }
    await expect(readiness).toContainText('Required publication checks passed.');
    await expect(update).toBeEnabled();
    assert.deepEqual(await name.boundingBox(), position, `${width}px: arriving readiness does not move the form`);
    assert.equal((await (await f.request(`/api/app/event-types/${event.id}`)).json()).description, edited);
    await description.fill(original);
    await save.click();
    await expect(readiness).toContainText('Required publication checks passed.');
    assert.equal((await (await f.request(`/api/app/event-types/${event.id}`)).json()).description, original);

    // An older record is labelled with its check time and refreshed after the response.
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await f.db.prepare('UPDATE provider_connection_health SET last_checked_at=?').bind(old).run();
    const stale = calls.length;
    await page.reload();
    await expect(readiness).toContainText('Required publication checks passed.');
    await expect(checkedLabel).toBeVisible();
    await screenshot(`editor-readiness-${width}-stale.png`);
    await expect.poll(async () => (await recorded())[0].checkedAt).not.toBe(old);
    assert.ok(calls.length > stale, `${width}px: the refresh checks the provider after the response`);

    // A recorded failure names the sender requirement and keeps publication closed.
    await f.db.prepare("UPDATE provider_connection_health SET status='unhealthy',unhealthy_code='unauthorized',last_checked_at=?").bind(new Date().toISOString()).run();
    const unhealthy = calls.length;
    await page.reload();
    await expect(readiness.getByRole('link', { name: 'Verify the transactional mail sender.', exact: true })).toBeVisible();
    await expect(update).toBeDisabled();
    assert.equal(calls.length, unhealthy, `${width}px: a recorded failure needs no provider request`);
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    await screenshot(`editor-readiness-${width}-unhealthy.png`);
    assert.equal((await f.request('/api/app/mail/check', {})).status, 200);
  }
}
