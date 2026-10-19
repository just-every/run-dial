import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { auditor, trackPage } from './audit.mjs';
import { evidencePath } from '../../scripts/evidence-path.mjs';

/** NOTIFY-001: saved owner choice and the resulting delivery record at both widths. */
export async function confirmationSettingsJourney(browser, owner, origin, eventId, scans, errors) {
  const storageState = await owner.storageState();
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 1440 ? 1024 : 844 } });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      await page.goto(origin + `/app/event-types/${eventId}`);
      const form = page.getByRole('form', { name: 'Invitation and email templates', exact: true });
      const checkbox = form.getByRole('checkbox', { name: /^Send Dial confirmation to invitees/ });
      await expect(checkbox).toBeEnabled();
      await checkbox.uncheck();
      await form.getByRole('button', { name: 'Save templates', exact: true }).click();
      await expect(form.getByRole('status')).toContainText('saved');
      await page.reload();
      await expect(checkbox).not.toBeChecked();
      await expect(checkbox).toBeEnabled();
      await checkbox.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await page.screenshot({ caret: 'initial', path: evidencePath(`NOTIFY-001-settings-off-${width}.png`) });
      await auditor(page, width, scans)('NOTIFY-001-settings-off');

      const eventResponse = await owner.request.get(origin + `/api/app/event-types/${eventId}`);
      const event = await eventResponse.json();
      const date = new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10);
      const offers = await (await owner.request.get(origin + `/api/public/book/dial-host/intro/availability?week=${date}`)).json();
      const name = `Avery Chen ${width}`;
      const response = await owner.request.post(origin + '/api/app/bookings', {
        headers: { Origin: origin }, data: { idempotencyKey: crypto.randomUUID(), eventTypeId: eventId, startAt: offers.slots[0].startAt,
          inviteeTimezone: 'America/Los_Angeles', name, email: `avery-${width}@dial.test`,
          answers: Object.fromEntries(event.questions.map(question => [question.key, 'Plan a design consultation.'])), overrideNoticeAndHorizon: false },
      });
      assert.equal(response.status(), 201);
      const booking = await response.json();
      const deliveriesResponse = await owner.request.get(origin + `/api/app/bookings/${booking.id}/deliveries`);
      const deliveries = await deliveriesResponse.json();
      const invitee = deliveries.find(row => row.kind === 'mail_send' && row.recipient === `avery-${width}@dial.test`); assert.ok(invitee);
      // The native booking coordinator receives the mail before its calendar job.
      const delivered = await owner.request.post(origin + '/__fixtures/deliver', { data: { id: invitee.id } });
      assert.equal(delivered.status(), 200);
      await page.goto(origin + `/app/bookings?query=${encodeURIComponent(name)}`);
      const row = page.locator(`[data-delivery-id="${invitee.id}"]`);
      await expect(row.getByText('Not sent · calendar invitation', { exact: true })).toBeVisible();
      await expect(row.getByText('Sent', { exact: true })).toHaveCount(0);
      await expect(row.getByRole('button', { name: 'Retry delivery', exact: true })).toHaveCount(0);
      await auditor(page, width, scans)('NOTIFY-001-suppressed');
      await page.getByRole('region', { name: 'Deliveries', exact: true }).screenshot({ caret: 'initial', path: evidencePath(`NOTIFY-001-deliveries-${width}.png`) });

      await page.goto(origin + `/app/event-types/${eventId}`);
      await expect(checkbox).toBeEnabled(); await checkbox.check();
      await form.getByRole('button', { name: 'Save templates', exact: true }).click();
      await expect(form.getByRole('status')).toContainText('saved');
      await page.reload(); await expect(checkbox).toBeEnabled(); await expect(checkbox).toBeChecked();
      await checkbox.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await page.screenshot({ caret: 'initial', path: evidencePath(`NOTIFY-001-settings-on-${width}.png`) });
    } finally { await context.close(); }
  }
}
