import { identifier } from './validation.mjs';
import { deployedFingerprint } from './worker.mjs';

// Materialized binding families emitted by bindingsFor and secretBindings. Upload
// directives such as inherit, and unrecognized types, cannot classify history.
const historicalBindingTypes = new Set(['assets','plain_text','version_metadata','d1','r2_bucket','kv_namespace','queue','durable_object_namespace','service','secret_text']);

export const validSecretNames = names => Array.isArray(names) && names.every(identifier) && new Set(names).size === names.length;

/** Provider secret listings contain names and types, never values to persist. */
export function secretNames(rows) {
  if (!Array.isArray(rows) || !rows.every(row => row?.type === 'secret_text')) return null;
  const names = rows.map(row => row.name);
  return validSecretNames(names) ? names : null;
}

/** Older intents lack a name snapshot. Only the exact historical starting version
 * can supply it: neither the plan nor today's successor proves yesterday's names.
 * Version resources.bindings is optional in the provider API. Absent, malformed or
 * mismatched historical evidence cannot authorize adoption. */
export async function pendingSecretNames(api, worker, {pendingSecret, receipt}) {
  if (pendingSecret.names !== undefined) return pendingSecret.names;
  let anchor;
  try { anchor = await api.request(`/workers/scripts/${worker}/versions/${pendingSecret.versionId}`); }
  catch (error) { if (error.status === 404) return null; throw error; }
  const bindings = anchor?.resources?.bindings;
  if (anchor?.id !== pendingSecret.versionId || anchor?.resources?.script?.etag !== receipt.provider.etag
    || !Array.isArray(bindings) || !bindings.every(row => row && typeof row === 'object' && !Array.isArray(row) && historicalBindingTypes.has(row.type))
    || !validSecretNames(bindings.map(row => row.name)) || deployedFingerprint({bindings}) !== receipt.fingerprint) return null;
  return bindings.filter(row => row.type === 'secret_text' && !pendingSecret.bindings.includes(row.name)).map(row => row.name);
}
