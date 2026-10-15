import { readinessAPI } from './readiness-window.mjs';
import { activeWorker, deployedFingerprint } from './worker.mjs';
import { assert, uuid } from './validation.mjs';

// Poll only the missing fresh Worker or the exact pre-upload version. A new
// unrelated version is drift, even during propagation; provider errors fail.
export async function uploadedWorker({ api, worker, upload, previous, fingerprint, window }) {
 const rawVersion = typeof upload?.deployment_id === 'string' ? upload.deployment_id.toLowerCase() : upload?.deployment_id;
 // The legacy upload API also returns the UUID without separators (Wrangler
 // normalizes this field before treating it as its uploaded version ID).
 const versionId = typeof rawVersion === 'string' && /^[a-f0-9]{32}$/i.test(rawVersion) ? rawVersion.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5').toLowerCase() : rawVersion;
 if (versionId !== undefined) assert(uuid(versionId), 'invalid-upload-version');
 const bounded = readinessAPI(api, window, 'uploaded-worker-timeout');
 while (window.remaining() > 0) {
  const current = await activeWorker(bounded, worker);
  if (current && (!versionId || current.versionId === versionId) && deployedFingerprint(current.settings) === fingerprint) return current;
  const prior = previous && current?.versionId === previous.versionId && current.deploymentId === previous.deploymentId && current.etag === previous.etag;
  assert(!current || prior || current.versionId === versionId, 'uploaded-worker-drift');
  await window.pause();
 }
 throw new Error('uploaded-worker-timeout');
}
