import { assert, uuid } from './validation.mjs';

// Several secrets change as ONE Worker version, so a half-changed group never runs.
// Cloudflare's per-secret calls each deploy a version of their own, and its settings
// call adds secrets but never removes one (both measured on 17 October 2026). A copy
// of the live version does both: its own modules, assets and compatibility settings,
// every binding inherited except the named secrets, which it sets or leaves out. The
// copy carries a marker rer saved before uploading it, so a copy whose answer was lost,
// or that was uploaded but not yet deployed, is recognised as this change and no other.
export const copyMessage = marker => `rer-secrets:${marker}`;

/** Upload the copy (not yet deployed) and return its version id. */
export async function uploadSecretCopy(api, worker, live, {changes, marker}) {
  const {parts, entry} = await api.workerContent(worker, live.versionId);
  const runtime = live.version?.resources?.script_runtime, bindings = live.version?.resources?.bindings;
  assert(typeof runtime?.compatibility_date === 'string' && Array.isArray(bindings), 'invalid-active-version');
  const named = new Set(changes.map(change => change.binding));
  const metadata = {main_module:entry, compatibility_date:runtime.compatibility_date, compatibility_flags:runtime.compatibility_flags ?? [],
    bindings:[...bindings.filter(row => !named.has(row.name)).map(row => ({type:'inherit',name:row.name})),
      ...changes.filter(change => change.value !== undefined).map(change => ({type:'secret_text',name:change.binding,text:change.value}))],
    keep_assets:true, annotations:{'workers/message':copyMessage(marker)}};
  const data = new FormData();
  data.set('metadata', new Blob([JSON.stringify(metadata)], {type:'application/json'}));
  for (const [name, file] of parts) data.set(name, file, name);
  const version = await api.request(`/workers/scripts/${worker}/versions?bindings_inherit=strict`, {method:'POST', body:data});
  assert(uuid(version?.id), 'invalid-secret-copy');
  return version.id;
}

/** Send all traffic to the copy. */
export const deploySecretCopy = (api, worker, versionId) => api.request(`/workers/scripts/${worker}/deployments`, {method:'POST', body:{strategy:'percentage', versions:[{version_id:versionId, percentage:100}]}});

/** The newest version is this change's copy, uploaded right after the receipt's version and not deployed. */
export async function undeployedCopy(api, worker, {pendingSecret, receipt}, versions) {
  if (!pendingSecret.copy || versions[1]?.id !== receipt.provider.versionId || !uuid(versions[0]?.id)) return null;
  const copy = await api.request(`/workers/scripts/${worker}/versions/${versions[0].id}`);
  return copy?.id === versions[0].id && copy.annotations?.['workers/message'] === copyMessage(pendingSecret.copy) ? copy.id : null;
}
