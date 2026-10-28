import type { SourceData } from '../source.ts';
import type { SourceLoss } from '../external-source.ts';
import { ApiRecord, canonical, sourceUrl } from './api-record.ts';

export function calUser(value: unknown, data: SourceData, losses: SourceLoss[]) {
 const row = new ApiRecord(value), uri = canonical('calcom', 'users', row.id('id'));
 data.user.push({ uri, name: row.text('name'), slug: row.text('username'), timezone: row.text('timeZone'), source_account: uri });
 row.losses('user', uri, losses);
}
export function calSchedule(value: unknown, data: SourceData, losses: SourceLoss[]) {
 const row = new ApiRecord(value), uri = canonical('calcom', 'schedules', row.id('id'));
 const owner = canonical('calcom', 'users', row.id('ownerId'));
 if (owner !== data.user[0].uri) throw new Error('Schedule belongs to another provider account.');
 const rules: SourceData['schedules'][number]['rules'] = [];
 const append = (type: 'wday' | 'date', key: string, from: string, to: string) => {
  let rule = rules.find(r => r.type === type && (type === 'date' ? r.date === key : r.wday === key));
  if (!rule) { rule = { type, ...(type === 'date' ? { date: key } : { wday: key }), intervals: [] }; rules.push(rule); }
  // The documented zero-length override is a closed day.
  if (from !== to) rule.intervals.push({ from, to });
 };
 for (const window of row.rows('availability')) {
  const from = window.text('startTime'), to = window.text('endTime');
  const days = window.strings('days');
  if (!days.length) throw new Error('Availability window requires at least one weekday.');
  for (const day of days) {
   if (!['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day)) throw new Error('Invalid API weekday.');
   append('wday', day.toLowerCase(), from, to);
  }
 }
 for (const override of row.rows('overrides')) append('date', override.text('date'), override.text('startTime'), override.text('endTime'));
 data.schedules.push({ uri, user: owner, timezone: row.text('timeZone'), name: row.text('name'), default: row.bool('isDefault'), rules });
 row.losses('schedules', uri, losses);
}
function location(row: ApiRecord): NonNullable<SourceData['event_types'][number]['locations']>[number] {
 const type = row.text('type');
 if (type === 'address') return { kind: 'physical', location: row.text('address') };
 if (type === 'link') return { kind: 'custom', location: row.text('link') };
 if (type === 'phone') return { kind: 'inbound_call', phone_number: row.text('phone') };
 if (type === 'integration') {
  const integration = row.text('integration');
  if (integration === 'google-meet') return { kind: 'google_conference' };
  if (typeof row.raw.link === 'string' && /^https:\/\//u.test(row.raw.link)) return { kind: 'custom', location: row.text('link') };
  return { kind: integration };
 }
 return { kind: type };
}
export function calEvent(value: unknown, data: SourceData, losses: SourceLoss[]) {
 const row = new ApiRecord(value), uri = canonical('calcom', 'event-types', row.id('id'));
 const users = row.rows('users', true);
 const userIds = users.map(user => canonical('calcom', 'users', user.id('id')));
 const owner = row.raw.ownerId == null ? undefined : canonical('calcom', 'users', row.id('ownerId'));
 const unsupported = owner !== data.user[0].uri || userIds.length > 1 || userIds.some(id => id !== data.user[0].uri) ||
  row.raw.teamId != null || row.raw.schedulingType != null || row.raw.recurrence != null || row.raw.isInstantEvent === true ||
  (typeof row.raw.seatsPerTimeSlot === 'number' && row.raw.seatsPerTimeSlot > 1) ||
  (row.raw.seats != null && typeof row.raw.seats === 'object' && !('disabled' in row.raw.seats && row.raw.seats.disabled === true));
 const questions = row.rows('bookingFields').flatMap((field, position) => {
  if (field.raw.isDefault === true) return [];
  const kinds: Record<string, string> = { text: 'string', textarea: 'text', select: 'single_select', radio: 'single_select', multiselect: 'multi_select', checkbox: 'multi_select', phone: 'phone_number' };
  const type = String(field.raw.type), kind = kinds[type];
  if (!kind) return [];
  field.text('type');
  return [{ name: field.text('label'), type: kind, position, enabled: !field.bool('hidden', false), required: field.bool('required'), answer_choices: field.strings('options', true), include_other: false, source_key: field.text('slug') }];
 });
 const color = row.raw.color == null ? '#2563eb' : row.child('color').text('lightThemeHex');
 if (row.raw.color == null) losses.push({ resource: 'event_types', sourceId: uri, field: 'color', reason: 'Source did not supply an event colour; Dial uses its default.' });
 const bookingUrl = sourceUrl(row, 'bookingUrl');
 data.event_types.push({ uri, name: row.text('title'), slug: row.text('slug'), duration: row.number('lengthInMinutes'), color,
  active: true, secret: row.bool('hidden', false), kind: unsupported ? 'group' : 'solo', type: 'StandardEventType', pooling_type: null,
  description_plain: row.text('description'), custom_questions: questions, locations: row.rows('locations').map(location),
  duration_options: row.raw.lengthInMinutesOptions === undefined ? null : row.numbers('lengthInMinutesOptions'),
  source_account: data.user[0].uri, ...(bookingUrl ? { scheduling_url: bookingUrl } : {}) });
 const scheduleId = row.raw.scheduleId;
 const schedule = scheduleId == null ? data.schedules.find(s => s.default) : data.schedules.find(s => s.uri === canonical('calcom', 'schedules', scheduleId));
 if (schedule) { if (scheduleId != null) row.id('scheduleId'); data.event_availability.push({ event_type: uri, availability_rule: { uri: schedule.uri, timezone: schedule.timezone } }); }
 if (unsupported) losses.push({ resource: 'event_types', sourceId: uri, field: '$event', reason: 'Team, multi-host, recurring, instant or capacity event is skipped.' });
 row.losses('event_types', uri, losses);
}
