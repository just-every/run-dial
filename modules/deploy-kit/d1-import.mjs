import { createHash } from 'node:crypto';
import { assert, uuid } from './validation.mjs';
import { recordDeployFailure } from './diagnostics.mjs';

export const D1_IMPORT_POLL_LIMIT = 100;

// Wrangler's remote --file protocol. D1 imports execute the whole file atomically,
// including trigger bodies; the query endpoint's semicolon splitting cannot.
// Cloudflare's own reason for an import that failed or did not finish, kept on the
// error as providerRefusal (rer deploy names it) and in the deploy diagnostic: its
// codes and messages without credentials, URLs (signed upload destinations) or
// control characters, each cut to 300 characters.
function importFailure(code, id, response, redact) {
  const clean = text => redact(text).replace(/\bhttps?:\/\/\S+/gi, '[URL omitted]').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim().slice(0, 300);
  const said = [response?.error, ...(Array.isArray(response?.errors) ? response.errors : [])]
    .map(item => typeof item === 'string' ? { message:item } : item)
    .filter(item => Number.isSafeInteger(item?.code) || typeof item?.message === 'string' && item.message.trim()).slice(0, 3)
    .map(item => ({ ...(Number.isSafeInteger(item.code) ? { code:item.code } : {}), ...(typeof item.message === 'string' ? { message:clean(item.message) } : {}) }));
  const status = typeof response?.status === 'string' && /^[a-z_]{1,40}$/.test(response.status) ? response.status : undefined;
  const errors = said.length ? said : status ? [{ message:`import status ${status}` }] : [];
  const error = new Error(code);
  error.providerRefusal = { operation:`POST /d1/database/${id}/import`, errors };
  return recordDeployFailure(error, { providerCodes:errors.filter(item => item.code !== undefined).map(item => item.code), output:errors.map(item => item.message).filter(Boolean).join('\n') });
}

export async function importD1({ envelope, upload, redact = String }, id, sql) {
  assert(uuid(id) && typeof sql === 'string' && Buffer.byteLength(sql) <= 4 * 1024 * 1024, 'invalid-d1-import');
  const bytes = Buffer.from(sql), etag = createHash('md5').update(bytes).digest('hex');
  const post = async body => (await envelope(`/d1/database/${id}/import`, { method:'POST', body })).result;
  let response = await post({ action:'init', etag });
  if (response && Object.hasOwn(response, 'upload_url')) {
    assert(typeof response.filename === 'string' && response.filename.length > 0 && response.filename.length <= 1024 && !/[\x00-\x1f\x7f]/.test(response.filename), 'invalid-d1-import-filename');
    await upload(response.upload_url, bytes, etag);
    response = await post({ action:'ingest', filename:response.filename, etag });
  }
  for (let polls = 0; polls < D1_IMPORT_POLL_LIMIT; polls++) {
    // REST places errors on the envelope; validate nested errors when supplied.
    if (!(response?.success === true && response.type === 'import' && response.status !== 'error' && (!Object.hasOwn(response, 'errors') || Array.isArray(response.errors) && !response.errors.length))) throw importFailure('d1-import-failed', id, response, redact);
    if (response.status === 'complete') {
      if (!(Number.isSafeInteger(response.result?.num_queries) && response.result.num_queries > 0 && typeof response.result.final_bookmark === 'string' && response.result.final_bookmark.length > 0)) throw importFailure('d1-import-invalid-result', id, response, redact);
      return;
    }
    if (!(response.status === 'active' && typeof response.at_bookmark === 'string' && response.at_bookmark.length > 0 && response.at_bookmark.length <= 1024)) throw importFailure('d1-import-uncertain', id, response, redact);
    response = await post({ action:'poll', current_bookmark:response.at_bookmark });
  }
  throw new Error('d1-import-poll-limit');
}

export function importUploadURL(value) {
  assert(typeof value === 'string' && value.length <= 16384 && !/[\x00-\x20\x7f\\]/.test(value), 'invalid-d1-import-upload-url');
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid-d1-import-upload-url'); }
  assert(url.protocol === 'https:' && /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) && !url.port && !url.username && !url.password && !url.hash && url.pathname.length > 1 && url.search.length > 1, 'invalid-d1-import-upload-url');
  return url.href;
}
