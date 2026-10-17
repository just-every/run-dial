import { providerPages } from './pagination.mjs';
import { assert } from './validation.mjs';

// Cloudflare's object REST API requires literal slashes, with other reserved
// characters encoded. The provider sends this path without URL normalization.
export function r2ObjectPath(bucket, key) {
  assert(typeof key === 'string' && key.length > 0, 'unsafe-r2-object-key');
  const encoded = key.split('/').map(part => (part === '.' || part === '..' ? part.replaceAll('.', '%2E') : encodeURIComponent(part)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
  return `/r2/buckets/${bucket}/objects/${encoded}`;
}
export function isR2ObjectDelete(path, method) {
  if (method !== 'DELETE') return false;
  const match = /^\/r2\/buckets\/([a-z0-9][a-z0-9-]{1,62}[a-z0-9])\/objects\/(.+)$/.exec(path);
  if (!match) return false;
  try { return r2ObjectPath(match[1], decodeURIComponent(match[2])) === path; } catch { return false; }
}

// The API returns result: Object[] and result_info.is_truncated/cursor, not the
// bucket-list shape. Yield bounded pages so removal never collects the bucket.
export async function* r2ObjectPages(api, bucket) {
  try { for await (const {rows} of providerPages(api.envelope, `/r2/buckets/${bucket}/objects`, {pagination:'cursor'})) {
    assert(rows.length <= 1000 && rows.every(row => typeof row?.key === 'string' && row.key.length), 'invalid-r2-object-list');
    assert(new Set(rows.map(row => row.key)).size === rows.length, 'invalid-r2-object-list');
    yield rows;
  } } catch (error) {
    error.providerCall ??= {operation:`GET /r2/buckets/${bucket}/objects`,reason:error.message};
    throw error;
  }
}
