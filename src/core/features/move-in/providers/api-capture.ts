import type { ExternalSource } from '../external-source.ts';
import { sourceSchemas, importLimits } from '../source.ts';
import { object, emptyData } from './api-record.ts';
import { calUser, calEvent, calSchedule } from './api-calcom.ts';
import { calBooking } from './api-calcom-bookings.ts';
import { savvyUser, savvyEvent, savvySchedule } from './api-savvycal.ts';
import { savvyBooking } from './api-savvycal-bookings.ts';

export function readApiCapture(value: unknown): ExternalSource {
 const root = object(value);
 const keys = ['dialCapture', 'provider', 'capturedAt', 'user', 'eventTypes', 'schedules', 'bookings'];
 if (Object.keys(root).some(key => !keys.includes(key)) || keys.some(key => !(key in root)) || root.dialCapture !== 1 || !['calcom', 'savvycal'].includes(String(root.provider))) throw new Error('Invalid scheduler capture envelope.');
 if (typeof root.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/u.test(root.capturedAt) || !Number.isFinite(Date.parse(root.capturedAt))) throw new Error('Capture requires an ISO timestamp.');
 const eventTypes = root.eventTypes, schedules = root.schedules, bookings = root.bookings;
 if (!Array.isArray(eventTypes) || !Array.isArray(schedules) || !Array.isArray(bookings)) throw new Error('Capture requires API record arrays.');
 if (eventTypes.length > importLimits.events || bookings.length > importLimits.bookings || schedules.length > importLimits.maxRecords) throw new Error('Capture exceeds the import record limit.');
 const source: ExternalSource = { data: emptyData(), losses: [], capturedAt: root.capturedAt };
 const { data, losses } = source;
 if (root.provider === 'calcom') {
  calUser(root.user, data, losses);
  for (const row of schedules) calSchedule(row, data, losses);
  for (const row of eventTypes) calEvent(row, data, losses);
  for (const row of bookings) calBooking(row, data, losses, eventTypes);
 } else {
  const user = object(root.user);
  if (typeof user.email !== 'string') throw new Error('SavvyCal capture requires the account identity.');
  savvyUser(user, data, losses);
  for (const row of schedules) savvySchedule(row, data, losses);
  for (const row of eventTypes) savvyEvent(row, data, losses);
  for (const row of bookings) savvyBooking(row, data, losses, user.email);
 }
 let total = 0;
 for (const resource of Object.keys(sourceSchemas) as (keyof typeof sourceSchemas)[]) {
  const ids = new Set<string>();
  for (const row of data[resource]) {
   sourceSchemas[resource].parse(row);
   const id = String('uri' in row ? row.uri : row.event_type);
   if (ids.has(id)) throw new Error('Duplicate provider source identifier.');
   ids.add(id); total++;
  }
 }
 if (total > importLimits.maxRecords) throw new Error('Capture exceeds the import record limit.');
 return source;
}
