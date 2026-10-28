import type { SourceData } from '../source.ts';
import type { SourceLoss } from '../external-source.ts';
import { ApiRecord, canonical, instant, sourceUrl } from './api-record.ts';

export function savvyBooking(value: unknown, data: SourceData, losses: SourceLoss[], accountEmail: string) {
 const row = new ApiRecord(value), uri = canonical('savvycal', 'events', row.id('id'));
 const link = row.raw.link == null ? undefined : row.child('link');
 const event = link ? canonical('savvycal', 'links', link.id('id')) : `${uri}/unsupported-link`;
 const start = instant(row, 'start_at'), end = instant(row, 'end_at'), created = instant(row, 'created_at');
 const state = row.text('state');
 const attendees = row.rows('attendees'), invitees = attendees.filter(a => a.raw.is_organizer === false);
 const organizers = attendees.filter(a => a.raw.is_organizer === true);
 const organizer = row.child('organizer');
 // The attendee and user identifiers belong to separate namespaces. Compare the supplied
 // organizer address in memory, never retain an extra copy in normalized data.
 const own = organizers.length === 1 && typeof organizer.raw.email === 'string' && organizer.raw.email === accountEmail && organizers[0].raw.email === accountEmail;
 if (own) { organizer.text('email'); organizers[0].text('email'); organizers[0].bool('is_organizer'); }
 const group = row.raw.is_group_session === true || (typeof row.raw.maximum_group_size === 'number' && row.raw.maximum_group_size > 1);
 const unsupported = !link || !own || group || row.raw.poll != null || !['confirmed', 'canceled', 'declined'].includes(state);
 const location: Record<string, unknown> = {};
 if (row.raw.conferencing != null) {
  const conference = row.child('conferencing');
  if (typeof conference.raw.join_url === 'string' && conference.raw.join_url) { location.type = 'custom'; location.join_url = conference.text('join_url'); }
 }
 if (!location.join_url && typeof row.raw.location === 'string') { location.type = 'custom'; location.location = row.text('location'); }
 const before = row.number('buffer_before'), after = row.number('buffer_after');
 if (![before, after].every(n => Number.isInteger(n) && n >= 0 && n <= 1440)) throw new Error('Invalid SavvyCal booking buffer.');
 const publicUrl = sourceUrl(row, 'url');
 data.scheduled_events.push({ uri, event_type: event, name: row.text('summary'), status: state === 'confirmed' ? 'active' : 'canceled',
  start_time: start, end_time: end, created_at: created, location,
  invitees_counter: { active: invitees.length, total: invitees.length, limit: invitees.length },
  event_memberships: own ? [{ user: data.user[0].uri, buffered_start_time: new Date(Date.parse(start) - before * 60000).toISOString(), buffered_end_time: new Date(Date.parse(end) + after * 60000).toISOString() }] : [],
  event_guests: unsupported ? [true] : [], source_account: data.user[0].uri, ...(publicUrl ? { source_url: publicUrl } : {}) });
 for (const attendee of invitees) {
  const answers = attendee.rows('fields').flatMap((field, position) => {
   if (typeof field.raw.value !== 'string') return [];
   return [{ question: field.text('label'), answer: field.text('value'), position }];
  });
  data.invitees.push({ uri: `${uri}/attendees/${attendee.id('id')}`, event: uri, name: attendee.text('display_name'), email: attendee.text('email'),
   timezone: attendee.text('time_zone'), status: 'active', created_at: created, questions_and_answers: answers });
  attendee.bool('is_organizer');
 }
 if (unsupported) losses.push({ resource: 'scheduled_events', sourceId: uri, field: '$booking', reason: 'Booking is not a confirmed standard event with this single host; it is skipped.' });
 row.losses('scheduled_events', uri, losses);
}
