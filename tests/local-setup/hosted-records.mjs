import assert from 'node:assert/strict';
import { browserCheck } from './browser-diagnostics.mjs';
export const answer = 'Original hosted answer: punctuation, 日本語, and a second line\nremain exact.';
/** Populate through native owner/public doors, with no provider connection. */
export async function hostedRecords(page, origin) {
 const call = async (check, path, data, expected = 200, method = 'POST') => browserCheck(check, async () => {
  const response = await page.request.fetch(origin + path, { method, headers: { origin, 'x-dial-copy-report': '1' }, data });
  assert.equal(response.status(), expected, 'native hosted fixture command'); return response.json();
 });
 await call('hosted_profile_write', '/api/app/profile', { name: 'Hosted archive owner', handle: 'hosted-archive', title: 'Durable hosted records', biography: 'Original hosted profile.', timezone: 'UTC', focusAreas: [], socialProof: [] }, 200, 'PATCH');
 await call('hosted_mail_check', '/api/app/mail/check', {});
 const event = await call('hosted_event_create', '/api/app/event-types', { slug: 'portable-meeting', title: 'Portable meeting', description: 'Original event description.', durationMinutes: 30, color: '#dcab3c', locationType: 'phone', locationLabel: 'Phone', locationValue: '+1 202 555 0100', listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 60, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [{ key: 'q_archive_answer', kind: 'textarea', label: 'Original question', required: true, options: [] }], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })) }, 201);
 await call('hosted_event_publish', `/api/app/event-types/${event.id}/publish`, {});
 await call('hosted_link_copy', `/api/app/event-types/${event.id}/copy-report`, { url: origin + '/book/hosted-archive/portable-meeting' });
 await call('hosted_setup_complete', '/api/app/host-setup/complete', {});
 const path = '/api/public/book/hosted-archive/portable-meeting', week = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
 const available = await browserCheck('hosted_public_availability', async () => {
  const available = await (await fetch(origin + `${path}/availability?week=${week}&inviteeTimezone=UTC`)).json();
  assert.ok(available.slots.length, 'saved schedule offers a public slot'); return available;
 });
 const selection = { startAt: available.slots[0].startAt, inviteeTimezone: 'UTC' };
 const publicCall = async (check, suffix, data) => browserCheck(check, async () => {
  const response = await fetch(origin + path + suffix, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal(response.status, 201, 'real signed-out booking command'); return response.json();
 });
 const nonce = await publicCall('hosted_public_selection', '/selection', selection);
 const booked = await publicCall('hosted_public_confirm', '/confirm', { ...selection, nonce: nonce.nonce, name: 'Archive guest', email: 'archive-guest@example.test', answers: { q_archive_answer: answer } });
 const rows = await browserCheck('hosted_booking_count', async () => {
  const rows = await (await page.request.get(origin + '/api/app/bookings')).json();
  assert.equal(rows.length, 1); return rows;
 });
 const booking = await browserCheck('hosted_booking_detail', async () => (await page.request.get(origin + '/api/app/bookings/' + rows[0].id)).json());
 await browserCheck('hosted_calendar_state', () => assert.equal(booking.calendarState, 'not_required'));
 await browserCheck('hosted_answer_preserved', () => assert.equal(booking.answers[0].value, answer));
 await browserCheck('hosted_management_url', () => assert.equal(typeof booked.manageUrl, 'string', 'public confirmation carries private management URL'));
 return { booking, event, privateManageUrl: booked.manageUrl };
}
