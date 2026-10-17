import { workerSettings } from './owner.mjs';
import { readinessAPI } from './readiness-window.mjs';
import { assert } from './validation.mjs';

const ANNOTATION = /^rer-site:[0-9a-f]{64}$/;
function refuse(code, worker) { return Object.assign(new Error(code), { resource: `worker:${worker}` }); }

/** A provider snapshot; only a fresh upload may have incomplete visibility. */
export async function servedVersion(api, worker, { pending = false } = {}) {
  if (!await workerSettings(api, worker)) return null;
  const { deployments } = await api.request(`/workers/scripts/${worker}/deployments`);
  assert(Array.isArray(deployments) && (pending || deployments.length > 0), 'invalid-deployments');
  const [latest] = deployments;
  const single = latest?.versions?.length === 1 && latest.versions[0].percentage === 100 ? latest.versions[0].version_id : null;
  const newest = (await api.request(`/workers/scripts/${worker}/versions`))?.items?.[0]?.id;
  let version;
  try { version = single ? await api.request(`/workers/scripts/${worker}/versions/${single}`) : null; }
  catch (error) { if (!pending || error.status !== 404) throw error; }
  assert(!version || version.id === single, 'invalid-active-version');
  const annotation = version?.annotations?.['workers/message'];
  return { kit: typeof annotation === 'string' && ANNOTATION.test(annotation), annotation,
    current: Boolean(single) && single === newest, versionId: single, newest, deploymentId: latest?.id, deployed: Boolean(latest), visible: Boolean(version) };
}

/** Preflight remains strict: no propagation allowance from an earlier invocation. */
export async function ownedSiteVersion(api, worker) {
  const served = await servedVersion(api, worker);
  if (!served) return null;
  if (!served.kit) throw refuse('resource-name-collision', worker);
  if (!served.current) throw refuse('owned-resource-replaced', worker);
  return served;
}

/** Only the upload response and the exact preflight version may appear while
 * Cloudflare's deployment and version reads converge. Never replay the upload. */
export async function waitForSiteUpload({ api, worker, versionId, fingerprint, previous, window }) {
  const bounded = readinessAPI(api, window, 'site-upload-timeout');
  const annotation = `rer-site:${fingerprint}`;
  let lastSeen = null, delay = 2000;
  const timeout = cause => Object.assign(refuse('site-upload-timeout', worker), { lastSeen, cause });
  while (window.remaining() > 0) {
    try { lastSeen = await servedVersion(bounded, worker, { pending: true }); }
    catch (error) { if (window.remaining() <= 0 || error.name === 'TimeoutError') throw timeout(error); throw error; }
    if (lastSeen) {
      const allowed = id => !id || id === versionId || id === previous?.versionId;
      const expected = lastSeen.versionId === versionId ? annotation : previous?.annotation;
      if (!allowed(lastSeen.versionId) || !allowed(lastSeen.newest) || lastSeen.deployed && !lastSeen.versionId
        || lastSeen.visible && lastSeen.annotation !== expected
        || lastSeen.versionId === previous?.versionId && lastSeen.deploymentId !== previous.deploymentId)
        throw refuse('owned-resource-replaced', worker);
      if (lastSeen.current && lastSeen.versionId === versionId && lastSeen.annotation === annotation) return lastSeen;
    }
    await window.sleep(Math.min(delay, window.remaining()));
    delay = Math.min(delay * 2, 10000);
  }
  throw timeout();
}

/** A new zone's Custom Domain list lags the attach. Poll it inside the deploy's
 * readiness window until every hostname is listed on the kit's Worker. A hostname
 * on another Worker is refused at once; one still unlisted at the deadline fails
 * naming it. */
export async function waitForSiteDomains({ api, zoneId, worker, hostnames, window }) {
  const bounded = readinessAPI(api, window, 'domain-readback-mismatch');
  const mismatch = hostname => Object.assign(new Error('domain-readback-mismatch'), { resource: `domain:${hostname}` });
  let delay = 2000, missing = hostnames[0];
  while (window.remaining() > 0) {
    let domains;
    try { domains = await bounded.request(`/workers/domains?zone_id=${zoneId}`); }
    catch (error) { if (window.remaining() <= 0 || error.name === 'TimeoutError') throw mismatch(missing); throw error; }
    assert(Array.isArray(domains), 'invalid-domain-list');
    const foreign = hostnames.find(hostname => domains.some(row => row?.hostname === hostname && row.service !== worker));
    if (foreign) throw mismatch(foreign);
    missing = hostnames.find(hostname => !domains.some(row => row?.hostname === hostname));
    if (!missing) return domains;
    await window.sleep(Math.min(delay, window.remaining()));
    delay = Math.min(delay * 2, 10000);
  }
  throw mismatch(missing);
}

/** Only provider UUIDs and kit fingerprints are safe to include in CLI output. */
export function siteReadbackSummary(error) {
  if (error.message !== 'site-upload-timeout') return '';
  const seen = error.lastSeen;
  if (!seen) return ' Last readback: Worker not visible.';
  const id = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value) ? value : 'not visible';
  const fingerprint = typeof seen.annotation === 'string' && ANNOTATION.test(seen.annotation) ? seen.annotation.slice('rer-site:'.length) : 'not visible';
  return ` Last readback: serving ${id(seen.versionId)}, newest ${id(seen.newest)}, fingerprint ${fingerprint}.`;
}
