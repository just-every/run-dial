import { r2ObjectPages, r2ObjectPath } from './r2-objects.mjs';
import { rm } from 'node:fs/promises';
import { assert } from './validation.mjs';
import { resourceKinds, findResource } from './resources.mjs';
import { activeWorker } from './worker.mjs';
import { deleteWorker } from './teardown.mjs';
import { workerConsumerScript } from './queue-consumer.mjs';
import { query } from './migrations.mjs';
import { KINDS, readOwnerState, writeOwnerState, withStateLock, withScopeHints, withSettledLists, workerSettings, sameDeployment, resourceId, checkResourceIdentity, refuse, settlePendingSecret } from './owner.mjs';

const remove = {
  d1: (api, id) => api.request(`/d1/database/${id}`, {method:'DELETE'}),
  kv: (api, id) => api.request(`/storage/kv/namespaces/${id}`, {method:'DELETE'}),
  queues: (api, id) => api.request(`/queues/${id}`, {method:'DELETE'}),
};

/** A resource whose create response was lost (still `pending` in the state file) may be
 * rer's or someone else's. It is removed only under this environment's derived name and
 * once it is confirmed empty: a D1 with no tables or a KV namespace with no keys. R2 always
 * requires a confirmed creation identity. A queue's backlog cannot be read, so an uncertain queue refuses with its own code. */
async function confirmEmpty(api, worker, kind, name, id) {
  if (!name.startsWith(`${worker}-`)) throw refuse('uncertain-resource-create', kind, name);
  if (kind === 'queues') throw refuse('uncertain-resource-unverifiable', kind, name);
  if (kind === 'd1') {
    const [{results}] = await query(api, id, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite~_%' ESCAPE '~' AND name NOT LIKE '~_cf~_%' ESCAPE '~'");
    if (results.length) throw refuse('uncertain-resource-not-empty', kind, name);
  }
  if (kind === 'kv') {
    const keys = await api.request(`/storage/kv/namespaces/${id}/keys?limit=10`);
    assert(Array.isArray(keys), 'invalid-kv-key-list');
    if (keys.length) throw refuse('uncertain-resource-not-empty', kind, name);
  }
}

/** Delete exactly what this environment's state file says rer created: the Worker (its
 * schedules first; its Durable Objects go with it), then each D1, R2, KV and queue,
 * each only while it is still the one rer created. Read back that each is gone, then
 * drop the state file. Nothing else in the account is touched. Ownership is checked for
 * everything before the first delete; a replaced or uncertain resource refuses it all,
 * except an uncertain one confirmed empty (see confirmEmpty). R2 object purges
 * additionally require the saved creation timestamp and recheck it before each delete. */
export async function ownerRemove({api: provider, target, statePath, clock, sleep}) {
  const api = withSettledLists(withScopeHints(provider));
  return withStateLock(statePath, async () => {
    const state = await readOwnerState(statePath, target);
    if (await settlePendingSecret(api, target.worker, state, {preflight:true})) await writeOwnerState(statePath, state);
    const owned = KINDS.flatMap(kind => Object.entries(state.owned[kind]).map(([name, entry]) => ({kind, name, entry})));
    assert(state.owned.worker || owned.length, 'nothing-to-remove');
    // Preflight, read-only.
    let worker = null;
    if (await workerSettings(api, target.worker) !== null) {
      if (!state.owned.worker) throw refuse('resource-name-collision', 'worker', target.worker);
      const expected = state.pendingUpload?.provider ?? state.receipt?.provider;
      if (!expected) throw refuse('uncertain-resource-create', 'worker', target.worker);
      const live = await activeWorker(api, target.worker);
      if (!sameDeployment(live, expected)) throw refuse('owned-resource-replaced', 'worker', target.worker);
      worker = target.worker;
    }
    assert(!state.pendingSecret, 'secret-change-unsettled');
    const listed = {}, doomed = [];
    for (const kind of KINDS) {
      if (!owned.some(item => item.kind === kind)) continue;
      listed[kind] = await resourceKinds[kind].list(api);
      for (const {name, entry} of owned.filter(item => item.kind === kind)) {
        const row = findResource(listed[kind], kind, name);
        if (!row) continue;
        if (kind === 'r2') requireBucketIdentity(name, entry);
        if (entry.status === 'pending') await confirmEmpty(api, target.worker, kind, name, resourceId(kind, row));
        else checkResourceIdentity(kind, name, row, entry);
        if (kind === 'r2' && entry.status === 'created' && entry.id) await checkBucket(api, name, entry);
        doomed.push({kind, name, entry, id:resourceId(kind, row)});
      }
    }
    const removed = [];
    // A Worker that consumes one of these queues is released first.
    for (const queue of doomed.filter(item => item.kind === 'queues')) {
      for (const consumer of await api.list(`/queues/${queue.id}/consumers`, {pagination:'single'})) {
        if (workerConsumerScript(consumer) === target.worker) await api.request(`/queues/${queue.id}/consumers/${consumer.consumer_id}`, {method:'DELETE'});
      }
    }
    if (worker) { await deleteWorker({api, worker, ...(clock ? {clock} : {}), ...(sleep ? {sleep} : {})}); removed.push(`worker:${worker}`); }
    const failed = [];
    for (const item of doomed) {
      try {
        if (item.kind === 'r2') await removeBucket(api, item);
        else await remove[item.kind](api, item.id, item.name);
        removed.push(`${item.kind}:${item.name}`);
      }
      catch (error) { failed.push({resource:`${item.kind}:${item.name}`, code:error.message}); }
    }
    // Read back: nothing this environment created is still listed.
    const remaining = [];
    if (await workerSettings(api, target.worker) !== null) remaining.push(`worker:${target.worker}`);
    const namespaces = await api.list('/workers/durable_objects/namespaces');
    for (const row of namespaces) if (row.script === target.worker) remaining.push(`durable-object:${row.class}`);
    for (const kind of KINDS) {
      if (!listed[kind]) continue;
      const rows = await resourceKinds[kind].list(api);
      for (const {name} of owned.filter(item => item.kind === kind)) if (findResource(rows, kind, name)) remaining.push(`${kind}:${name}`);
    }
    if (remaining.length) {
      // Keep the record of what is left, so a later --remove finishes it.
      for (const kind of KINDS) for (const name of Object.keys(state.owned[kind])) if (!remaining.includes(`${kind}:${name}`)) delete state.owned[kind][name];
      if (!remaining.includes(`worker:${target.worker}`)) {
        state.owned.worker = null; state.receipt = null; delete state.pendingUpload;
        delete state.ownerClaim; delete state.retiredSecrets;
      }
      await writeOwnerState(statePath, state);
      const error = new Error('remove-incomplete'); error.remaining = remaining; error.failed = failed; error.removed = removed.filter(resource => !remaining.includes(resource));
      throw error;
    }
    await rm(statePath, {force:true});
    return {worker:target.worker, removed, remaining:[]};
  });
}

async function checkBucket(api, name, entry) {
  const row = await api.request(`/r2/buckets/${name}`);
  if (row?.name !== name) throw refuse('owned-resource-replaced', 'r2', name);
  checkResourceIdentity('r2', name, row, entry);
}
function requireBucketIdentity(name, entry) {
  if (entry.status !== 'created' || typeof entry.id !== 'string' || !entry.id) throw refuse('uncertain-resource-create', 'r2', name);
}
async function removeBucket(api, {name, entry}) {
  requireBucketIdentity(name, entry);
  await checkBucket(api, name, entry);
  for await (const rows of r2ObjectPages(api, name)) {
    for (const {key} of rows) {
      // Preflight may precede Worker teardown. Re-read before each destructive
      // request too. The provider has no conditional bucket-identity delete;
      // out-of-band delete/recreate operations must be serialized by the owner.
      await checkBucket(api, name, entry);
      await api.request(r2ObjectPath(name, key), {method:'DELETE'});
    }
  }
  await checkBucket(api, name, entry);
  await api.request(`/r2/buckets/${name}`, {method:'DELETE'});
}
