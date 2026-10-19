import assert from 'node:assert/strict';
import { bookingMail, recipient, textBody, htmlBody } from './mail-contracts.mjs';

/** NOTIFY-009/AUTH-007: only the real public command may reach the provider edge. */
export async function invitationManageJourney({ data, call, state, deliver, calendar, receipt, booking, checks }) {
  const invitationUrl = /https?:\/\/[^\s]+\/manage\/invite\/[^\s]+/u.exec(calendar.description)?.[0];
  assert.ok(invitationUrl, 'NOTIFY-009: shared description carries the invitation capability');
  assert.ok(!calendar.description.includes(receipt.manageUrl), 'shared invitation never carries the booking-read capability');
  const token = new URL(invitationUrl).pathname.split('/').at(-1);
  const base = `/api/public/manage/invite/${token}`;
  assert.deepEqual(await data(base), { available: true }, 'invitation projection contains no booking or invitee fields');
  await call("/__fixtures/invitation-start", { id: booking.id, startAt: "2000-01-01T00:00:00.000Z" }, 204);
  await call(base, undefined, 410); await call(`${base}/email`, {}, 410);
  await call("/__fixtures/invitation-start", { id: booking.id, startAt: receipt.occurrence.startAt }, 204);
  const before = await state();
  await call(`${base}/email`, { email: 'attacker@dial.test' }, 400);
  await call('/api/public/manage/invite/unknown/email', {}, 404);
  await call(`/api/public/manage/invite/${token.slice(0,-1)}${token.endsWith('A') ? 'B' : 'A'}/email`, {}, 404);
  assert.equal((await state()).delivery_outbox.length, before.delivery_outbox.length, 'forged and recipient-changing requests do nothing');
  await call(`${base}/email`, {}, 202);
  const rotated = await state();
  const emails = rotated.delivery_outbox.filter(row => row.booking_id === booking.id && JSON.parse(row.payload_json).messageKind === 'invitation_manage');
  assert.equal(emails.length, 1);
  await call(`${base}/email`, {}, 202);
  assert.equal((await state()).delivery_outbox.length, rotated.delivery_outbox.length, 'repeat click does not flood mail or rotate again');
  await call(new URL(receipt.manageUrl).pathname.replace('/manage/', '/api/public/manage/'), undefined, 410);
  const audit = await data(`/api/app/bookings/${booking.id}`);
  const rotation = audit.history.filter(row => row.action === 'manage_link_rotated');
  assert.equal(rotation.length, 1); assert.ok(rotation[0].createdAt); assert.ok(rotation[0].reason.includes('calendar invitation'));
  await deliver();
  const snap = await state();
  const replacements = bookingMail(snap, booking.id).filter(mail => mail.subject === 'Your replacement booking manage link');
  assert.equal(replacements.length, 1);
  assert.deepEqual(recipient(replacements[0]), [booking.invitee_email], 'server chooses only this booking’s invitee');
  const body = textBody(replacements[0]), html = htmlBody(replacements[0]);
  assert.ok(body.includes('earlier manage link no longer works')); assert.ok(html.includes('earlier manage link no longer works'));
  const replacementUrl = /https?:\/\/[^\s]+\/manage\/(?!invite\/)[^\s]+/u.exec(body)?.[0];
  assert.ok(replacementUrl); assert.ok(replacementUrl !== receipt.manageUrl);
  assert.ok(!body.includes(receipt.manageUrl)); assert.ok(!html.includes(receipt.manageUrl));
  const managed = await data(new URL(replacementUrl).pathname.replace('/manage/', '/api/public/manage/'));
  assert.equal(managed.event.eventTitle, receipt.event.eventTitle);
  await data('/__fixtures/deliver', { id: emails[0].id });
  assert.equal(bookingMail(await state(), booking.id).filter(mail => mail.subject === 'Your replacement booking manage link').length, 1, 'queue replay sends once');
  checks.push('NOTIFY-009/AUTH-007 invitation GET discloses no booking fields; explicit POST rotates and audits, invalid/forged/address-changing requests do nothing, only stored invitee gets replacement through Base SendGrid, old manage URL refuses, repeated click and queue replay send once');
  return { replacementUrl, invitationUrl, base };
}
