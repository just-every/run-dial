import type { SourceData } from '../source.ts';
import type { SourceLoss } from '../external-source.ts';
import { ApiRecord, canonical, instant, object } from './api-record.ts';

export function calBooking(value: unknown, data: SourceData, losses: SourceLoss[], rawEvents: unknown[]) {
 const row = new ApiRecord(value), uri = canonical('calcom', 'bookings', row.id('uid'));
 const event = canonical('calcom', 'event-types', row.id('eventTypeId'));
 const hosts = row.rows('hosts');
 const own = hosts.length === 1 && canonical('calcom', 'users', hosts[0].raw.id) === data.user[0].uri;
 if (own) hosts[0].id('id');
 const status = row.text('status'), active = !['cancelled', 'rejected'].includes(status);
 const start = instant(row, 'start'), end = instant(row, 'end'), created = instant(row, 'createdAt');
 const attendees = row.rows('attendees'), guests = row.list('guests', true);
 let location: Record<string, unknown> = {};
 if (typeof row.raw.meetingUrl === 'string' && row.raw.meetingUrl) location = { type: 'custom', join_url: row.text('meetingUrl') };
 else if (typeof row.raw.location === 'string' && row.raw.location) location = { type: 'custom', location: row.text('location') };
 const rawEvent = rawEvents.map(object).find(e => canonical('calcom', 'event-types', e.id) === event);
 const before = rawEvent?.beforeEventBuffer, after = rawEvent?.afterEventBuffer;
 const occupied: Record<string, unknown> = {};
 for (const [boundary, minutes, origin, direction] of [
  ['buffered_start_time', before, start, -1], ['buffered_end_time', after, end, 1],
 ] as const) {
  if (minutes === undefined) continue;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error('Invalid Cal.com event buffer.');
  occupied[boundary] = new Date(Date.parse(origin) + direction * minutes * 60000).toISOString();
 }
 const pending = !['accepted', 'cancelled', 'rejected'].includes(status);
 const unsupported = !own || pending || typeof row.raw.recurringBookingUid === 'string';
 data.scheduled_events.push({ uri, event_type: event, name: row.text('title'), status: active ? 'active' : 'canceled', start_time: start, end_time: end, created_at: created,
  location, invitees_counter: { active: attendees.length, total: attendees.length, limit: attendees.length },
  event_memberships: own ? [{ user: data.user[0].uri, ...occupied }] : [], event_guests: unsupported ? [true] : guests.map(() => true), source_account: data.user[0].uri });
 const responses = row.raw.bookingFieldsResponses === undefined ? undefined : row.child('bookingFieldsResponses');
 for (const [index, attendee] of attendees.entries()) {
  const answers: SourceData['invitees'][number]['questions_and_answers'] = [];
  if (attendees.length === 1 && responses) {
   const fields = data.event_types.find(e => e.uri === event)?.custom_questions ?? [];
   // Match the documented field slug; unresolved response keys remain losses.
   for (const [key, value] of Object.entries(responses.raw)) {
    const field = fields.find(f => f.source_key === key);
    if (!field || field.type === 'phone_number') continue;
    let answer: string | undefined;
    if (typeof value === 'string') { responses.mark(key); answer = value; }
    else if (typeof value === 'number' || typeof value === 'boolean') {
     responses.mark(key); answer = String(value);
     losses.push({ resource: 'scheduled_events', sourceId: uri, field: responses.key(key), reason: 'Scalar booking answer is retained as text.' });
    } else if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
     if (!value.length) responses.mark(key);
     value.forEach((_, index) => responses.used.add(`${responses.key(key)}[${index}]`)); answer = value.join('\n');
     losses.push({ resource: 'scheduled_events', sourceId: uri, field: responses.key(key), reason: 'Multiple selected booking answers are retained as newline-separated text.' });
    }
    if (answer !== undefined) answers.push({ question: field.name, answer, position: field.position });
   }
  }
  data.invitees.push({ uri: `${uri}/attendees/${index}`, event: uri, name: attendee.text('name'), email: attendee.text('email'),
   timezone: attendee.text('timeZone'), status: 'active', created_at: created, questions_and_answers: answers });
 }
 if (unsupported) losses.push({ resource: 'scheduled_events', sourceId: uri, field: '$booking', reason: 'Booking is not a confirmed standard event with this single host; it is skipped.' });
 row.losses('scheduled_events', uri, losses);
}
