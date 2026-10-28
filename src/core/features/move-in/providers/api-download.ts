import { object, identifier } from './api-record.ts';

const maxBytes = 8 * 1024 * 1024;
const maxPages = 30;
const origins = { calcom: 'https://api.cal.com', savvycal: 'https://api.savvycal.com' } as const;
type Provider = keyof typeof origins;
type JsonObject = Record<string, unknown>;

export async function captureScheduler(provider: Provider, token: string, request: typeof fetch = fetch): Promise<unknown> {
 if (provider !== 'calcom' && provider !== 'savvycal') throw new Error('Choose a supported scheduler provider.');
 if (typeof token !== 'string' || !token.trim() || token.length > 4096 || /[\r\n]/u.test(token)) throw new Error('A valid scheduler token is required.');
 const origin = origins[provider]; let bytes = 0, pages = 0;
 async function get(path: string, version?: string): Promise<JsonObject> {
  if (++pages > maxPages) throw new Error('Capture exceeded the bounded request limit.');
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith(provider === 'calcom' ? '/v2/' : '/v1/')) throw new Error('Invalid scheduler API destination.');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (version) headers['cal-api-version'] = version;
  let response: Response;
  try { response = await request(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error('Scheduler API request failed. Check connectivity and token permissions.'); }
  if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== origin)) {
   await response.body?.cancel();
   throw new Error(`Scheduler API refused capture (HTTP ${response.status}).`);
  }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Scheduler API returned an empty response.');
  const chunks: Uint8Array[] = [];
  try {
   while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw new Error('Capture exceeds the 8 MiB limit.'); }
    chunks.push(chunk.value);
   }
  } catch { await reader.cancel().catch(() => {}); throw new Error('Scheduler response could not be read within the capture limit.'); }
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))); }
  catch { throw new Error('Scheduler API returned invalid JSON.'); }
 }
 const records = (value: unknown, limit: number): JsonObject[] => {
  if (!Array.isArray(value) || value.length > limit) throw new Error('Scheduler response exceeds its documented shape or import limit.');
  return value.map(object);
 };
 const unique = (rows: JsonObject[], key: string) => {
  const seen = new Set<string>();
  for (const row of rows) { const id = identifier(row[key]); if (seen.has(id)) throw new Error('Duplicate records in scheduler pagination.'); seen.add(id); }
  return rows;
 };
 const cursor = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.length || value.length > 2048 || /[\r\n]/u.test(value)) throw new Error('Invalid scheduler pagination cursor.');
  return value;
 };
 async function calList(path: string, version: string, limit: number) {
  const result = await get(path, version);
  if (result.status !== 'success' || result.pagination != null) throw new Error('Unexpected Cal.com response envelope.');
  return unique(records(result.data, limit), 'id');
 }
 async function calBookings() {
  const rows: JsonObject[] = [], seen = new Set<string>(); let after: string | null = null;
  do {
   const query = new URLSearchParams({ limit: '100' }); if (after) query.set('cursor', after);
   const result = await get(`/v2/bookings?${query}`, '2026-05-01');
   if (result.status !== 'success') throw new Error('Unexpected Cal.com booking envelope.');
   rows.push(...records(result.data, 100));
   if (rows.length > 500) throw new Error('Capture exceeds 500 bookings.');
   const pagination = object(result.pagination);
   if (typeof pagination.hasMore !== 'boolean') throw new Error('Missing Cal.com pagination state.');
   after = cursor(pagination.nextCursor);
   if (pagination.hasMore !== (after !== null) || (after && seen.has(after))) throw new Error('Invalid or repeated Cal.com pagination cursor.');
   if (after) seen.add(after);
  } while (after);
  return unique(rows, 'uid');
 }
 async function savvyList(path: string, limit: number) {
  const rows: JsonObject[] = [], seen = new Set<string>(); let after: string | null = null;
  do {
   const url = new URL(path, origin); url.searchParams.set('limit', '100'); if (after) url.searchParams.set('after', after);
   const result = await get(url.pathname + url.search);
   rows.push(...records(result.entries, 100));
   if (rows.length > limit) throw new Error('Capture exceeds the provider record limit.');
   const metadata = object(result.metadata);
   cursor(metadata.before);
   if (!Number.isInteger(metadata.limit) || Number(metadata.limit) < 1 || Number(metadata.limit) > 100) throw new Error('Invalid SavvyCal pagination metadata.');
   after = cursor(metadata.after);
   if (after && seen.has(after)) throw new Error('Repeated SavvyCal pagination cursor.');
   if (after) seen.add(after);
  } while (after);
  return unique(rows, 'id');
 }
 const capturedAt = new Date().toISOString();
 if (provider === 'calcom') {
  const [profile, eventTypes, schedules, bookings] = await Promise.all([
   get('/v2/me'), calList('/v2/event-types', '2024-06-14', 100), calList('/v2/schedules', '2024-06-11', 500), calBookings(),
  ]);
  if (profile.status !== 'success') throw new Error('Unexpected Cal.com profile envelope.');
  return { dialCapture: 1, provider, capturedAt, user: object(profile.data), eventTypes, schedules, bookings };
 }
 const [user, links, archived, bookings] = await Promise.all([
  get('/v1/me'), savvyList('/v1/links', 100), savvyList('/v1/links?state=archived', 100), savvyList('/v1/events?state=all&period=all&attendance=attending', 500),
 ]);
 const eventTypes = unique([...links, ...archived], 'id');
 if (eventTypes.length > 100) throw new Error('Capture exceeds 100 event types.');
 return { dialCapture: 1, provider, capturedAt, user, eventTypes, schedules: [], bookings };
}
