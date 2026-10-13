import { DeliveryRepository } from '../../src/core/features/delivery/repository.ts';
import { DeliveryRecovery } from '../../src/core/features/delivery/recovery.ts';
import { ProviderDeliveryService } from '../../src/core/features/delivery/service.ts';
import { bookingConfirmationMail } from '../../src/core/features/delivery/booking-mails.ts';
import { hashToken } from '../../src/core/platform/auth/tokens.ts';

const now = '2098-01-01T00:00:00.000Z';
const sessionSecret = 'synthetic-mail-archive-session-secret';
const bookingId = 'bookings-1';
const occurrenceId = 'booking_occurrences-1';

export default {
  async fetch(request, env) {
    const repository = new DeliveryRepository(env.DB);
    const sent = [];
    let calendarCalls = 0;
    const service = new ProviderDeliveryService(repository, {
      async upsertManagedEvent() { calendarCalls++; throw new Error('Unexpected historical calendar effect'); },
      async cancelManagedEvent() { calendarCalls++; throw new Error('Unexpected historical calendar effect'); },
    }, { async send(message) { sent.push(message); return { providerMessageId: 'synthetic-delivery' }; } }, undefined, sessionSecret);
    if (new URL(request.url).pathname === '/historical') {
      const before = (await env.DB.prepare('SELECT * FROM delivery_outbox ORDER BY id').all()).results;
      const due = await service.processDue(100, new Date(now));
      const direct = [];
      const retries = [];
      for (const row of before) {
        direct.push(await service.process({ outboxId: row.id }, new Date(now)));
        retries.push(await new DeliveryRecovery(env.DB).retry(row.booking_id, row.id));
      }
      const after = (await env.DB.prepare('SELECT * FROM delivery_outbox ORDER BY id').all()).results;
      return Response.json({ due, direct, retries, unchanged: JSON.stringify(before) === JSON.stringify(after), sent: sent.length, calendarCalls });
    }
    if (new URL(request.url).pathname === '/fresh') {
      // A newly issued capability and newly requested work may use an imported
      // booking; its archived commands must remain historical.
      const token = 'new-synthetic-capability';
      const manageUrl = `https://dial.test/manage/${token}`;
      await env.DB.prepare('INSERT INTO booking_manage_tokens (id,booking_id,token_hash,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .bind('fresh-manage', bookingId, await hashToken(token, sessionSecret), '2099-12-31', now, now).run();
      await env.DB.prepare("UPDATE booking_occurrences SET start_at='2099-01-01T00:00:00.000Z',end_at='2099-01-01T01:00:00.000Z' WHERE id=?").bind(occurrenceId).run();
      await env.DB.prepare("UPDATE bookings SET location_type='link',location_label='Join',location_value='https://meeting.test/current' WHERE id=?").bind(bookingId).run();
      const payload = {
        recipientRole: 'invitee', to: 'invitee@example.test', manageUrl, subject: 'Confirmed: Current event',
        ...bookingConfirmationMail({
          hostName: 'Current host', eventTitle: 'Current event', startAt: '2099-01-01T00:00:00.000Z', endAt: '2099-01-01T01:00:00.000Z',
          durationMinutes: 60, inviteeTimezone: 'UTC', hostTimezone: 'UTC', locationType: 'link', locationLabel: 'Join', locationValue: 'https://meeting.test/current',
          calendarState: 'pending', recipientRole: 'invitee', inviteeName: 'Invitee', inviteeEmail: 'invitee@example.test', manageUrl, answers: [],
        }),
      };
      for (const kind of ['mail_send', 'reminder']) {
        await env.DB.prepare('INSERT INTO delivery_outbox (id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,?,?,?)')
          .bind(`fresh-${kind}`, kind, `fresh-${kind}`, bookingId, occurrenceId, JSON.stringify(payload), 'pending', now, now, now).run();
      }
      const results = [];
      for (const kind of ['mail_send', 'reminder']) results.push(await service.process({ outboxId: `fresh-${kind}` }, new Date(now)));
      const wire = (await env.DB.prepare("SELECT payload_json FROM delivery_outbox WHERE id LIKE 'fresh-%' ORDER BY id").all()).results.map(row => JSON.parse(row.payload_json).wireMail);
      return Response.json({ results, sent: sent.length, calendarCalls,
        frozenExact: sent.every((message, index) => JSON.stringify(wire[index]) === JSON.stringify(message)),
        branded: sent.every(message => message.html.includes('<table') && message.text.includes('60 minutes')),
        currentActions: sent.every(message => [message.html, message.text].every(part => part.includes(manageUrl) && part.includes('https://dial.test/api/public/manage/' + token + '/calendar.ics'))),
        creationDuration: (await env.DB.prepare('SELECT duration_minutes AS duration FROM bookings WHERE id=?').bind(bookingId).first()).duration,
      });
    }
    return new Response(null, { status: 404 });
  },
};
