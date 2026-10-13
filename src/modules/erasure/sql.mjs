export class ErasureError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function insist(condition, code, status = 400) { if (!condition) throw new ErasureError(code, status); }
export const quote = name => '"' + name.replaceAll('"', '""') + '"';
export const statement = (db, sql, ...values) => values.length ? db.prepare(sql).bind(...values) : db.prepare(sql);
export const all = async (db, sql, ...values) => (await statement(db, sql, ...values).all()).results;
// A failed guard aborts the whole D1 batch through the CHECK constraint.
export const guard = (db, condition, ...values) =>
  statement(db, `INSERT INTO rer_erasure_guard(value) SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END`, ...values);
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
