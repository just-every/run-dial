import { assert, identifier } from './validation.mjs';
import { activeWorker } from './worker.mjs';
import { secretNames } from './owner-secret-names.mjs';
import { waitHealth } from './health-request.mjs';
import { definiteProviderRefusal } from './provider.mjs';
import { readOwnerState, writeOwnerState, withStateLock, withScopeHints, sameDeployment, refuse, recordSecretChange, settlePendingSecret } from './owner.mjs';

/** Set (`value` given) or remove one Worker secret of the owner's last deployment, then
 * record the Worker version the change made in the state file, so the next deploy
 * recognises its own Worker. A Worker someone else replaced is refused untouched.
 * The change is recorded as pending first: if the provider applies it but rer never
 * sees it settle, a later run can recognise its immediate successor (see settlePendingSecret).
 * Both success and ambiguous failure read back for up to `windowMs`. An explicit refusal
 * clears the pending record. An accepted write keeps its intent until confirmed.
 * An ambiguous failure clears it only when readback corroborates that the receipt's
 * deployment is still live. An ambiguous rotation
 * re-PUTs the value before accepting its successor as proof of the rotation.
 * A removed declared secret is retired: later plans omit it until it is set again. */
export async function ownerSecret({api: provider, target, statePath, binding, value, fetch = globalThis.fetch, healthOptions = {}, windowMs = 30000, clock = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const api = withScopeHints(provider);
  assert(identifier(binding), 'invalid-secret-name');
  assert(value === undefined || typeof value === 'string' && value.trim(), `missing-secret-${binding}`);
  return withStateLock(statePath, async () => {
    const state = await readOwnerState(statePath, target);
    assert(state.receipt && !state.pendingUpload, 'missing-owner-receipt');
    if (await settlePendingSecret(api, target.worker, state, {preflight:true})) await writeOwnerState(statePath, state);
    const live = await activeWorker(api, target.worker);
    if (!live) throw refuse('owned-resource-missing', 'worker', target.worker);
    if (!sameDeployment(live, state.receipt.provider)) throw refuse('owned-resource-replaced', 'worker', target.worker);
    assert(!state.pendingSecret, 'secret-change-unsettled');
    const path = `/workers/scripts/${target.worker}/secrets`, present = value !== undefined;
    const names = secretNames(await api.request(path));
    assert(names, 'invalid-secret-list');
    const existed = names.includes(binding), changed = present || existed;
    state.pendingSecret = {binding, present, versionId:state.receipt.provider.versionId, names:names.filter(name => name !== binding).sort()}; await writeOwnerState(statePath, state);
    let failure, unchanged = false, confirming = false;
    const put = () => api.request(path, {method:'PUT', body:{name:binding, text:value, type:'secret_text'}});
    try {
      if (present) await put();
      else if (changed) await api.request(`${path}/${binding}`, {method:'DELETE'});
    } catch (error) {
      if (definiteProviderRefusal(error)) { delete state.pendingSecret; await writeOwnerState(statePath, state); throw error; }
      failure = error;
    }
    try {
      if (!changed) recordSecretChange(state, live, state.pendingSecret);
      else for (const start = clock(); ; await sleep(2000)) {
        try {
          if (await settlePendingSecret(api, target.worker, state, {
            observe: current => { unchanged = sameDeployment(current, state.receipt.provider); },
            ...(failure && present && existed ? {confirm: async current => {
              confirming = true;
              state.pendingSecret.repeatVersionId = current.versionId;
              await writeOwnerState(statePath, state);
              await put();
              confirming = false;
            }} : {})
          })) break;
        }
        catch (error) {
          unchanged = false;
          // Another ambiguous PUT cannot prove a rotation by presence either.
          // Keep both starting versions for recovery; do not report it done.
          if (confirming) throw error;
          if (error.message !== 'provider-transport-failed' && !(error.status >= 500 && error.status < 600)) throw error;
        }
        if (clock() - start + 2000 > windowMs) throw failure ?? new Error('secret-change-unsettled');
      }
    } catch (error) {
      if (unchanged && failure) delete state.pendingSecret;
      await writeOwnerState(statePath, state);
      throw failure ?? error;
    }
    const result = {worker:target.worker, binding, present, versionId:state.receipt.provider.versionId};
    // Settlement is durable before readiness: a failed hosted check must never
    // erase the applied mutation or cause the next command to reject our version.
    state.receipt.health = {ok:false,versionId:result.versionId};
    await writeOwnerState(statePath, state);
    try {
      if (state.receipt.origin) await waitHealth({
        origin:state.receipt.origin, receipt:state.receipt, versionId:result.versionId, request:fetch,
        timeoutMs:healthOptions.timeoutMs,
        clock:healthOptions.now, sleep:healthOptions.sleep, ...healthOptions.readiness,
      });
      const after = await activeWorker(api, target.worker);
      assert(after && sameDeployment(after, state.receipt.provider), 'deployment-changed-during-health');
      // Response prefixes belong only in the caller's redacted diagnostic, never
      // in the ownership record: an unhealthy app may accidentally echo a secret.
      state.receipt.health = {ok:true,versionId:result.versionId};
      await writeOwnerState(statePath, state);
      return result;
    } catch (error) {
      error.secretChange = result;
      throw error;
    }
  });
}
