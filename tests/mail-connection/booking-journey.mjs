import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Real booking and cancellation commands; only the relay HTTP edge is faked. */
export async function bookingRelayJourney(f, event, calls) {
  const path = '/api/public/book/robin/project-conversation';
  const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const availability = await (await f.request(`${path}/availability?week=${week}`)).json();
  const startAt = availability.slots[0].startAt;
  const selection = await (await f.request(`${path}/selection`, { startAt, inviteeTimezone: 'Australia/Brisbane' })).json();
  const confirmation = await f.request(`${path}/confirm`, { nonce: selection.nonce, startAt, inviteeTimezone: 'Australia/Brisbane', name: 'Jordan Lee', email: 'invitee@example.test', answers: {} });
  assert.equal(confirmation.status, 201);
  const booking = (await (await f.request('/api/app/bookings')).json()).find(row => row.inviteeName === 'Jordan Lee');
  assert.ok(booking);
  const deliveries = async () => (await (await f.request(`/api/app/bookings/${booking.id}/deliveries`)).json()).filter(row => row.kind === 'mail_send');
  const initial = await deliveries();
  assert.equal(initial.length, 2);
  for (const row of initial) await f.queue(row.id);
  const completed = await deliveries();
  const accepted = completed.find(row => row.state === 'succeeded');
  assert.ok(accepted, 'the relay-accepted operator booking notice is sent');
  assert.equal(accepted.lastErrorCode, null);
  const receipt = await f.db.prepare('SELECT state,provider_message_id FROM base_mail_dispatch WHERE delivery_id=(SELECT idempotency_key FROM delivery_outbox WHERE id=?)').bind(accepted.id).first();
  assert.deepEqual({ ...receipt }, { state: 'accepted', provider_message_id: null });
  const before = calls.length;
  await f.queue(accepted.id);
  assert.equal(calls.length, before, 'redelivery never sends accepted booking mail twice');
  const rejected = completed.find(row => row.state === 'failed');
  assert.ok(rejected, 'the relay cannot carry the invitee calendar attachment');
  assert.equal(rejected.lastErrorCode, 'permanent_delivery_failure', 'a known pre-send rejection is not an unknown outcome');
  const rejectedDispatch = await f.db.prepare('SELECT state FROM base_mail_dispatch WHERE delivery_id=(SELECT idempotency_key FROM delivery_outbox WHERE id=?)').bind(rejected.id).first();
  assert.equal(rejectedDispatch.state, 'rejected');
  assert.equal((await f.request(`/api/app/bookings/${booking.id}/cancel`, { reason: 'The launch review has been completed.' })).status, 200);
  const cancellations = (await deliveries()).filter(row => !initial.some(old => old.id === row.id));
  assert.equal(cancellations.length, 2);
  for (const row of cancellations) await f.queue(row.id);
  for (const row of (await deliveries()).filter(row => cancellations.some(command => command.id === row.id))) {
    assert.equal(row.state, 'succeeded', 'both relay-accepted cancellation notices are sent');
    assert.equal(row.lastErrorCode, null);
  }
  assert.ok(calls.some(body => body.to === 'owner@example.test' && body.subject === `New booking: ${event.title}`));
}

export async function bookingStatusScreens(page, origin, screenshot, selectClient) {
  for (const width of [1440, 390]) {
    selectClient(width);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(origin + '/app/bookings?state=cancelled');
    await expect(page.getByRole('heading', { name: 'Jordan Lee', exact: true })).toBeVisible();
    await expect(page.getByText(/mail send · permanent delivery failure/)).toBeVisible();
    assert.ok(!(await page.locator('main').innerText()).includes('outcome unknown'));
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    await screenshot(`booking-delivery-${width}.png`);
  }
}
