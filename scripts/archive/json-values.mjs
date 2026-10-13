// SQL cells are typed values. JSON text stored in those cells is a separate
// domain: its valid number tokens need not fit an IEEE-754 double.
export const validSqlValue = value => value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
export function finiteNumber(_key, value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('archive-invalid-number');
  return value;
}
export function parseJsonText(source) {
  return JSON.parse(source, (_key, value, context) => typeof value === 'number' ? JSON.rawJSON(context.source) : value);
}
