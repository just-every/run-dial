import type { SourceData } from '../source.ts';
import type { SourceLoss } from '../external-source.ts';
import { ApiRecord, canonical, sourceUrl } from './api-record.ts';

export function savvyUser(value: unknown, data: SourceData, losses: SourceLoss[]) {
 const row = new ApiRecord(value), uri = canonical('savvycal', 'users', row.id('id'));
 // SavvyCal does not expose a user slug; the canonical account id stays stable.
 data.user.push({ uri, name: row.text('display_name'), slug: `savvy-${String(row.raw.id).toLowerCase().replace(/_/gu, '-').slice(0, 73).replace(/-+$/u, '')}`, timezone: row.text('time_zone'), source_account: uri });
 losses.push({ resource: 'user', sourceId: uri, field: 'slug', reason: 'SavvyCal does not expose a user handle; Dial derives a stable handle from the account identifier.' });
 row.losses('user', uri, losses);
}
export function savvyEvent(value: unknown, data: SourceData, losses: SourceLoss[]) {
 const row = new ApiRecord(value), uri = canonical('savvycal', 'links', row.id('id'));
 const kinds: Record<string, string> = { short_text: 'string', long_text: 'text', select: 'single_select', radios: 'single_select', checkboxes: 'multi_select', url: 'string' };
 const questions = row.rows('fields').flatMap((field, position) => {
  const type = String(field.raw.type), kind = kinds[type];
  if (!kind) return [];
  field.text('type');
  return [{ name: field.text('label'), type: kind, position, enabled: true, required: field.bool('is_required'),
   answer_choices: field.rows('options').map(option => option.text('label')), include_other: false, source_key: field.id('id') }];
 });
 // The API supplies HTML. Preserve literal plain text only; rich descriptions need owner review.
 const description = row.raw.description;
 const plain = typeof description === 'string' && !/[<>&]/u.test(description) ? row.text('description') : '';
 const explicit = sourceUrl(row, 'url');
 data.event_types.push({ uri, name: row.text('name'), slug: row.text('slug'), duration: row.number('default_duration'), color: '#2563eb',
  active: row.text('state') === 'active', secret: false, kind: 'solo', type: 'StandardEventType', pooling_type: null,
  description_plain: plain, custom_questions: questions, locations: [], duration_options: row.numbers('durations'),
  source_account: data.user[0].uri, ...(explicit ? { source_url: explicit } : {}) });
 for (const field of ['availability', 'locations', 'hostTopology']) losses.push({ resource: 'event_types', sourceId: uri, field,
  reason: 'The documented SavvyCal link response does not expose this configuration. Review and configure this draft in Dial.' });
 losses.push({ resource: 'event_types', sourceId: uri, field: 'color', reason: 'SavvyCal does not expose link colour; Dial uses its default.' });
 row.losses('event_types', uri, losses);
}
// No documented SavvyCal v1 schedule or link-availability configuration resource exists.
// Captures may retain future provider records, but do not infer recurring rules from available slots.
export function savvySchedule(value: unknown, data: SourceData, losses: SourceLoss[]) {
 const row = new ApiRecord(value);
 const uri = row.raw.id === undefined ? data.user[0].uri : canonical('savvycal', 'links', row.raw.id);
 row.losses('schedules', uri, losses, 'SavvyCal v1 does not document a transferable availability configuration.');
}
