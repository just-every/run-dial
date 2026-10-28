import type { Resource, SourceData } from '../source.ts';
import type { SourceLoss } from '../external-source.ts';

export type Raw = Record<string, unknown>;
export function object(value: unknown): Raw {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a documented API object.');
 return value as Raw;
}
export function identifier(value: unknown): string {
 if ((typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1)) || (typeof value !== 'string' && typeof value !== 'number') || !/^[a-zA-Z0-9_-]{1,160}$/u.test(String(value))) throw new Error('Invalid provider identifier.');
 return String(value);
}
export function canonical(provider: 'calcom' | 'savvycal', collection: string, id: unknown) {
 return `https://api.${provider === 'calcom' ? 'cal.com/v2' : 'savvycal.com/v1'}/${collection}/${identifier(id)}`;
}
// Consumption is tracked per leaf. Reading a container never hides unknown descendants.
export class ApiRecord {
 raw: Raw;
 path: string;
 used: Set<string>;
 constructor(value: unknown, path = '', used = new Set<string>()) { this.raw = object(value); this.path = path; this.used = used; }
 key(key: string) { return /^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(key) ? `${this.path}${this.path ? '.' : ''}${key}` : `${this.path}[${JSON.stringify(key)}]`; }
 mark(key: string) { this.used.add(this.key(key)); }
 text(key: string, optional?: string): string {
  const value = this.raw[key];
  if (value === undefined && optional !== undefined) return optional;
  if (typeof value !== 'string') throw new Error('Invalid API text field.');
  this.mark(key); return value;
 }
 number(key: string, optional?: number): number {
  const value = this.raw[key];
  if (value === undefined && optional !== undefined) return optional;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid API numeric field.');
  this.mark(key); return value;
 }
 bool(key: string, optional?: boolean): boolean {
  const value = this.raw[key];
  if (value === undefined && optional !== undefined) return optional;
  if (typeof value !== 'boolean') throw new Error('Invalid API boolean field.');
  this.mark(key); return value;
 }
 id(key: string) { const id = identifier(this.raw[key]); this.mark(key); return id; }
 child(key: string) { return new ApiRecord(this.raw[key], this.key(key), this.used); }
 list(key: string, optional = false): unknown[] {
  const value = this.raw[key];
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new Error('Invalid API array field.');
  if (!value.length) this.mark(key);
  return value;
 }
 rows(key: string, optional = false) { return this.list(key, optional).map((row, i) => new ApiRecord(row, `${this.key(key)}[${i}]`, this.used)); }
 strings(key: string, optional = false) { return this.list(key, optional).map((v, i) => { if (typeof v !== 'string') throw new Error('Invalid API string array.'); this.used.add(`${this.key(key)}[${i}]`); return v; }); }
 numbers(key: string, optional = false) { return this.list(key, optional).map((v, i) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Invalid API numeric array.'); this.used.add(`${this.key(key)}[${i}]`); return v; }); }
 losses(resource: Resource, sourceId: string, losses: SourceLoss[], reason = 'Source field is not represented in Dial.') {
  const visit = (value: unknown, path: string, depth: number) => {
   if (depth > 40) throw new Error('API object nesting exceeds 40 levels.');
   if (value && typeof value === 'object' && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) visit(child, Array.isArray(value) ? `${path}[${key}]` : (/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(key) ? `${path}${path ? '.' : ''}${key}` : `${path}[${JSON.stringify(key)}]`), depth + 1);
   } else if (!this.used.has(path)) losses.push({ resource, sourceId, field: path || '$', reason });
  };
  visit(this.raw, this.path, 0);
 }
}
export function emptyData(): SourceData { return { user: [], event_types: [], schedules: [], event_availability: [], scheduled_events: [], invitees: [] }; }
export function sourceUrl(row: ApiRecord, key: string): string | undefined {
 if (row.raw[key] === undefined || row.raw[key] === null) return undefined;
 const value = row.text(key); let url: URL;
 try { url = new URL(value); } catch { throw new Error('Invalid source URL.'); }
 if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Source URL must use HTTPS without credentials.');
 return value;
}
export function instant(row: ApiRecord, key: string) {
 const value = row.text(key);
 if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid API timestamp.');
 return value;
}
