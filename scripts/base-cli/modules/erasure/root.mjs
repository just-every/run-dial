import { insist, statement, quote, randomHex, canonicalJson } from './sql.mjs';

/** Only the opaque primary key survives; every other root column is explicitly replaced. */
export async function rootValues(d, keys, subject, anonymousId) {
  if (!d.root.redact) return null;
  const set = typeof d.root.redact.set === 'function' ? await d.root.redact.set({ subject, anonymousId }) : d.root.redact.set;
  const identity = d.root.redact.identityColumns ?? [];
  insist(identity.every(c => keys.columns.includes(c) && !keys.pk.includes(c)) && new Set(identity).size === identity.length, 'root_identity_columns', 409);
  const columns = keys.columns.filter(c => !keys.pk.includes(c) && !identity.includes(c));
  insist(set && columns.length === Object.keys(set).length && columns.every(c => Object.hasOwn(set, c)), 'root_redact_columns', 409);
  insist(Object.values(set).every(v => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))), 'root_redact_values', 409);
  return set;
}
export async function rootStatements(ctx, d, plan, id) {
  if (!d.root.redact || !plan.root) return [];
  const keys = plan.keys.get(d.root.table);
  // Independent of the audit label, so a retained root cannot identify that label.
  const anonymousId = plan.anonymousId ??= randomHex(16);
  const set = plan.rootSet ??= await rootValues(d, keys, plan.subject, anonymousId);
  return [statement(ctx.db, "INSERT OR IGNORE INTO rer_erasure_scope VALUES(?,'redaction',?,?,?)", id, d.root.table, canonicalJson(plan.subject), canonicalJson({ anonymousId })), statement(ctx.db, `UPDATE ${quote(d.root.table)} SET ${Object.keys(set).map(c => `${quote(c)}=?`).join(',')} WHERE ${keys.pk.map(c => `${quote(c)}=?`).join(' AND ')}`, ...Object.values(set), ...keys.pk.map(c => plan.subject[c])), ...await ctx.fence.redaction()];
}
