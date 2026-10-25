import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { auditor, trackPage } from './audit.mjs';
import { evidencePath } from '../../scripts/evidence-path.mjs';

export async function invitationSettings(page, form, width) {
  const toggle = form.getByRole('checkbox', { name: /^Include invitation manage link/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await form.getByRole('button', { name: 'Save templates', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('saved'); await page.reload();
  await expect(toggle).not.toBeChecked(); await expect(toggle).toBeEnabled();
  await toggle.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ caret: "initial", path: evidencePath(`NOTIFY-009-settings-off-${width}.png`) });
  await toggle.check(); await form.getByRole('button', { name: 'Save templates', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('saved'); await page.reload();
  await expect(toggle).toBeChecked(); await expect(toggle).toBeEnabled();
  await toggle.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ caret: "initial", path: evidencePath(`NOTIFY-009-settings-on-${width}.png`) });
}

/** Sessionless calendar invitation to inbox replacement to actual manage page. */
export async function invitationBrowserJourney(browser, owner, origin, booking, width, scans, errors) {
  let state = await (await owner.request.get(origin + '/__fixtures/status')).json();
  const calendar = state.fixture_events.find(row => row.booking_id === booking.id); assert.ok(calendar);
  const invitationUrl = /https?:\/\/[^\s]+\/manage\/invite\/[^\s]+/u.exec(JSON.parse(calendar.event_json).description)?.[0]; assert.ok(invitationUrl);
  const initialUrl = JSON.parse(state.delivery_outbox.find(row => row.booking_id === booking.id && JSON.parse(row.payload_json).recipientRole === 'invitee').payload_json).manageUrl;
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1024 : 844 } });
  try {
    const page = await context.newPage(), expectedResponses = new Map(); trackPage(page, errors, expectedResponses);
    const response = await page.goto(invitationUrl); assert.equal(response.status(), 200);
    const html = await response.text();
    for (const privateText of [booking.inviteeName, booking.inviteeEmail, booking.eventTitle, initialUrl]) assert.ok(!html.includes(privateText), 'NOTIFY-009: SSR discloses no booking details');
    await expect(page.getByRole('heading', { name: 'Get your manage link', exact: true })).toBeVisible();
    const button = page.getByRole('button', { name: 'Email me my link', exact: true }); await expect(button).toBeEnabled();
    await auditor(page, width, scans)('NOTIFY-009-invitation');
    await page.screenshot({ caret: "initial", path: evidencePath(`NOTIFY-009-invitation-${width}.png`), fullPage: true });
    await button.click(); await expect(page.getByRole('status')).toContainText('earlier manage link no longer works');
    await auditor(page, width, scans)('NOTIFY-009-requested');
    await page.screenshot({ caret: "initial", path: evidencePath(`NOTIFY-009-requested-${width}.png`), fullPage: true });
    await owner.request.post(origin + '/__fixtures/deliver', { data: {} });
    state = await (await owner.request.get(origin + '/__fixtures/status')).json();
    const mail = state.fixture_mail.map(row => JSON.parse(row.message_json)).find(mail => mail.to === booking.inviteeEmail && mail.subject === 'Your replacement booking manage link'); assert.ok(mail);
    assert.ok(mail.text.includes('earlier manage link no longer works'));
    const replacementUrl = /https?:\/\/[^\s]+\/manage\/(?!invite\/)[^\s]+/u.exec(mail.text)?.[0]; assert.ok(replacementUrl);
    await page.goto(replacementUrl);
    await expect(page.getByRole('heading', { name: booking.eventTitle, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel booking', exact: true })).toBeEnabled();
    await page.screenshot({ caret: "initial", path: evidencePath(`NOTIFY-009-replacement-${width}.png`), fullPage: true });
    expectedResponses.set(initialUrl, 410);
    assert.equal((await page.goto(initialUrl)).status(), 410);
    await page.screenshot({ caret: "initial", path: evidencePath(`NOTIFY-009-old-link-${width}.png`), fullPage: true });
    await page.goto(replacementUrl);
    const cancel = page.getByRole('button', { name: 'Cancel booking', exact: true }); await expect(cancel).toBeEnabled();
    await cancel.click(); await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('cancelled');
    expectedResponses.set(invitationUrl, 410);
    assert.equal((await page.goto(invitationUrl)).status(), 410);
    await page.screenshot({ caret: "initial", path: evidencePath(`NOTIFY-009-cancelled-${width}.png`), fullPage: true });
    expectedResponses.set(origin + '/manage/invite/unknown', 404);
    assert.equal((await page.goto(origin + '/manage/invite/unknown')).status(), 404);
    await page.screenshot({ caret: "initial", path: evidencePath(`NOTIFY-009-unknown-${width}.png`), fullPage: true });
  } finally { await context.close(); }
}
