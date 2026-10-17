import { servedAsset } from './asset-health.mjs';
import { readinessAPI } from './readiness-window.mjs';
import { verifyServiceGrants } from './service-grants.mjs';
import { assert, stable } from './validation.mjs';
import { boundedJSON } from './provider.mjs';
import { activeWorker, workerOrigin, durableNamespaces, verifyScheduledHandler } from './worker.mjs';
import { reconcileResources, reconcileTriggers } from './resources.mjs';
import { migrate } from './migrations.mjs';
import { bindingsFor, verifyBindings } from './render.mjs';
import { waitHealth } from './health-request.mjs';

function healthError(message, code, lastResult) {
  const error = new Error(message); error.code = code; error.lastResult = lastResult; return error;
}

/** Cloudflare may publish the route/bindings shortly after an upload succeeds.
 * Only 404, 503 and network failures are retried, inside one bounded window;
 * every other status, including redirects, is terminal and never healthy. */
export async function waitForDeploymentHealth(url, {
  timeoutMs = 30_000,
  intervalMs = 2_000,
  attemptTimeoutMs = 5_000,
  headers,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const deadline = now() + timeoutMs;
  let lastResult = 'no response';
  while (now() < deadline) {
    let response;
    try {
      response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.min(attemptTimeoutMs, deadline - now()))), ...(headers ? { headers } : {}) });
    } catch {
      lastResult = 'network error';
    }
    if (response) {
      if (response.ok) return response;
      lastResult = `HTTP ${response.status}`;
      await response.body?.cancel().catch(() => {});
      if (response.status !== 404 && response.status !== 503) {
        throw healthError(`Deployment health check failed at ${url}: ${lastResult}.`, 'health-http-failed', lastResult);
      }
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining));
  }
  throw healthError(`Deployment did not become healthy at ${url} within ${timeoutMs}ms; last result: ${lastResult}.`, lastResult === 'network error' ? 'health-transport-failed' : 'health-http-failed', lastResult);
}

/** Authenticated provider readback, then the unauthenticated account-derived /health.
 * Without `readiness`, /health gets the single bounded window of waitForDeploymentHealth.
 * With `readiness` (deploy after an upload) it gets the recorded 90-second wait of health-request.mjs.
 * `asset`, a built file's path, must answer 200 after at most one transient replay. */
export async function verifyHealth({api,plan,receipt,fetch:request=globalThis.fetch,timeoutMs=30000,intervalMs=2000,now,sleep,readiness,asset}) {
  if (readiness?.window) api = readinessAPI(api, readiness.window);
  assert(receipt?.version === 1 && receipt.accountId === api.accountId && receipt.worker === plan.worker,'receipt-target-mismatch');
  await verifyServiceGrants(api, plan);
  const current = await activeWorker(api,plan.worker);
  assert(current && current.versionId === receipt.provider.versionId && current.deploymentId === receipt.provider.deploymentId && current.etag === receipt.provider.etag,'active-deployment-mismatch');
  verifyScheduledHandler(current,plan);
  const origin = await workerOrigin(api,plan.worker,{workersDev:plan.workersDev !== false});
  assert(origin === receipt.origin,'health-origin-mismatch');
  const resources = await reconcileResources(api,plan,{create:false});
  assert(stable(resources) === stable(receipt.resources),'resource-identity-drift');
  verifyBindings(current.settings.bindings,bindingsFor(receipt.config,resources,plan));
  await reconcileTriggers(api,plan,resources,{mutate:false});
  const namespaces = await durableNamespaces(api,plan,{requireAll:true});
  assert(stable(namespaces) === stable(receipt.durableObjects),'durable-object-identity-drift');
  for (const item of plan.d1) await migrate(api,resources.d1.find(x => x.binding === item.binding).id,item.migrations,{apply:false});
  for (;;) {
    assert(!readiness?.window || readiness.window.remaining() > 0, 'missing-deployed-secret');
    const secrets = await api.request(`/workers/scripts/${plan.worker}/secrets`);
    assert(Array.isArray(secrets) && secrets.every(row => typeof row?.name === 'string' && row.type === 'secret_text'), 'invalid-secret-list');
    if (plan.secrets.every(x => x.optional || secrets.some(y => y.name === x.binding && y.type === 'secret_text'))) break;
    assert(readiness?.freshUpload && readiness.window?.remaining() > 0, 'missing-deployed-secret');
    await readiness.window.pause();
  }
  let health;
  // A Worker without a public route (reached only through service bindings) has no /health to request.
  if (plan.workersDev === false) health = {ok:true,versionId:current.versionId,route:'none'};
  else if (readiness) health = await waitHealth({origin,receipt,versionId:current.versionId,request,timeoutMs,...readiness});
  else {
    // A secret change makes a new version of the same build; until it reaches
    // every edge, a healthy answer can still name the previous version. Ask again
    // within the window; any other wrong identity fails at once.
    const clock = now ?? Date.now, wait = sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), start = clock();
    let body;
    for (;;) {
      let response;
      try {
        response = await waitForDeploymentHealth(`${origin}/health`,{timeoutMs,intervalMs,attemptTimeoutMs:timeoutMs,headers:{'Cache-Control':'no-cache','Accept':'application/json'},fetchImpl:request,...(now ? {now} : {}),...(sleep ? {sleep} : {})});
      } catch (error) { throw new Error(error.code ?? 'health-transport-failed'); }
      assert(response.ok && response.status === 200 && !response.redirected,'health-http-failed');
      body = await boundedJSON(response,65536);
      const other = body?.ok === true && typeof body.deployment?.versionId === 'string' && body.deployment.versionId !== current.versionId;
      if (!other || clock() - start + intervalMs > timeoutMs) break;
      await wait(intervalMs);
    }
    assert(body?.ok === true && body.deployment?.sourceSha === receipt.source.sha && body.deployment?.fingerprint === receipt.fingerprint && body.deployment?.versionId === current.versionId,'health-identity-mismatch');
    health = {ok:true,versionId:current.versionId};
  }
  if (asset && origin) health.asset = await servedAsset(origin,asset,request,timeoutMs,readiness ? {window:readiness.window,windowMs:60000,...(readiness.clock ? {clock:readiness.clock} : {}),...(readiness.sleep ? {sleep:readiness.sleep} : {})} : {});
  const after = await activeWorker(api,plan.worker);
  assert(after.versionId === current.versionId && after.deploymentId === current.deploymentId && after.etag === current.etag,'deployment-changed-during-health');
  await verifyServiceGrants(api, plan);
  return health;
}
