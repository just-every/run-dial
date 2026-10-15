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
  const seen = new Set(); let cursor;
  for (;;) {
    const data = await api.envelope(`/r2/buckets/${bucket}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    const rows = data.result, info = data.result_info;
    assert(Array.isArray(rows) && rows.length <= 1000 && rows.every(row => typeof row?.key === 'string' && row.key.length), 'invalid-r2-object-list');
    assert(new Set(rows.map(row => row.key)).size === rows.length, 'invalid-r2-object-list');
    // Cloudflare may omit pagination (or return null) on any terminal page
    // shorter than the requested limit. A full page cannot prove completion.
    if (info == null) {
      assert(rows.length < 1000, 'provider-incomplete-pagination');
      yield rows; return;
    }
    assert(typeof info.is_truncated === 'boolean' && (!info.delimited || Array.isArray(info.delimited) && !info.delimited.length), 'provider-incomplete-pagination');
    if (info.is_truncated) {
      assert(rows.length > 0 && typeof info.cursor === 'string' && info.cursor.length > 0 && info.cursor.length <= 4096 && !seen.has(info.cursor), 'provider-invalid-cursor');
      cursor = info.cursor; seen.add(cursor);
    } else assert(info.cursor == null || info.cursor === '', 'provider-invalid-cursor');
    yield rows;
    if (!info.is_truncated) return;
  }
}
