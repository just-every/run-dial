import { readinessAPI } from './readiness-window.mjs';
import { activeWorker, deployedFingerprint } from './worker.mjs';
import { assert, uuid } from './validation.mjs';

/** Normalize the version identity returned by the script upload endpoint. */
export function uploadVersionId(upload) {
 const rawVersion = typeof upload?.deployment_id === 'string' ? upload.deployment_id.toLowerCase() : upload?.deployment_id;
 // The legacy upload API also returns the UUID without separators (Wrangler
 // normalizes this field before treating it as its uploaded version ID).
 const versionId = typeof rawVersion === 'string' && /^[a-f0-9]{32}$/i.test(rawVersion) ? rawVersion.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5').toLowerCase() : rawVersion;
 if (versionId !== undefined) assert(uuid(versionId), 'invalid-upload-version');
 return versionId;
}

// Cloudflare can serve the uploaded version before its own version read finds it
// (404, code 100146). Only that read of that version waits; other errors fail.
const versionNotYetReadable = (error, worker, versionId) => error.status === 404
 && error.providerCall?.operation === `GET /workers/scripts/${worker}/versions/${versionId}`
 && error.providerRefusal?.errors?.some(item => item.code === 100146);

// Poll only the missing fresh Worker or the exact pre-upload version. A new
// unrelated version is drift, even during propagation; provider errors fail.
export async function uploadedWorker({ api, worker, upload, previous, fingerprint, window }) {
 const versionId = uploadVersionId(upload);
 const bounded = readinessAPI(api, window, 'uploaded-worker-timeout');
 while (window.remaining() > 0) {
  let current;
  try { current = await activeWorker(bounded, worker); }
  catch (error) {
   if (!versionId || !versionNotYetReadable(error, worker, versionId)) throw error;
   await window.pause(); continue;
  }
  if (current && (!versionId || current.versionId === versionId) && deployedFingerprint(current.settings) === fingerprint) return current;
  const prior = previous && current?.versionId === previous.versionId && current.deploymentId === previous.deploymentId && current.etag === previous.etag;
  assert(!current || prior || current.versionId === versionId, 'uploaded-worker-drift');
  await window.pause();
 }
 throw new Error('uploaded-worker-timeout');
}
