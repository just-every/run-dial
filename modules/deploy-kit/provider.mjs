import { providerPages, providerListShape } from './pagination.mjs';
import { deleteR2Object } from './r2-object-transport.mjs';
import { isR2ObjectDelete } from './r2-objects.mjs';
import { recordDeployFailure } from './diagnostics.mjs';
import { importD1, importUploadURL } from './d1-import.mjs';
import { assert, hexId } from './validation.mjs';
import { providerResponse, transportOutput, transportReason } from './provider-transport.mjs';

// A gateway/server error can arrive after a write. An explicit API refusal cannot.
export const definiteProviderRefusal = error => error.status === 200 || error.status >= 400 && error.status < 500;

async function boundedBytes(response, limit, onReadError) {
  assert(response.body, 'empty-response');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try { while (true) {
    let chunk;
    // Only a failed stream read is transport failure; retain size/shape codes.
    try { chunk = await reader.read(); } catch (cause) { throw onReadError ? onReadError(cause) : cause; }
    const { done, value } = chunk; if (done) break;
    length += value.length; assert(length <= limit, 'response-too-large'); chunks.push(value);
  } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
const boundedText = async (response, limit = 4 * 1024 * 1024, onReadError) => (await boundedBytes(response, limit, onReadError)).toString('utf8');
export async function boundedJSON(response, limit) {
  try { return JSON.parse(await boundedText(response,limit)); } catch (error) { if (error instanceof SyntaxError) throw new Error('malformed-response'); throw error; }
}
const redactValues = (text, values) => values.filter(Boolean).flatMap(value=>[value,encodeURIComponent(value),JSON.stringify(value).slice(1,-1)]).sort((a,b)=>b.length-a.length).reduce((value,secret)=>value.split(secret).join('[REDACTED]'),text);
/** Only this fixed origin and the explicitly selected account ever receive the token. */
export function cloudflare({ accountId, token, fetch: request = globalThis.fetch, objectDelete = deleteR2Object, timeoutMs = 30000, maxRequests = 500, removal = false }) {
  assert(hexId(accountId), 'invalid-cloudflare-account-id');
  assert(typeof token === 'string' && token.trim() && !/[\r\n]/.test(token), 'invalid-cloudflare-api-token');
  let requests = 0;
  // `zone` scope: the zone-level API (/zones/...), for a run site's zone lookup and redirect rule.
  async function rawEnvelope(path, { method = 'GET', body, assetToken, zone = false, signal: callerSignal } = {}) {
    assert(typeof path === 'string' && (isR2ObjectDelete(path, method) || /^\/[a-z0-9/_?=&.,%-]+$/i.test(path) && !path.includes('..') && !path.split('?')[0].includes('%')), 'invalid-provider-path');
    assert(!zone || /^\/zones(?:[/?]|$)/.test(path), 'invalid-provider-path');
    assert(++requests <= maxRequests, 'provider-request-budget');
    assert(!assetToken || path === '/workers/assets/upload?base64=true', 'invalid-asset-auth-target');
    // Asset-session credentials are discovered at runtime, outside the CLI env.
    // Preserve complete text for the CLI's remaining redaction before truncation.
    const redactCredentials = text => redactValues(text,[accountId,token,assetToken]);
    // D1 import text keeps Cloudflare's reason, never its signed upload destinations.
    const redactAuth = text => /\/r2\/buckets\/[^/]+\/objects(?:[/?]|$)/.test(path) ? '[R2 object details omitted]' : /\/d1\/database\/[^/]+\/import$/.test(path) ? redactCredentials(text).replace(/\bhttps?:\/\/\S+/gi,'[URL omitted]') : redactCredentials(text);
    const operation = `${method} ${path.split('?')[0].replace(/(\/r2\/buckets\/[^/]+\/objects)\/.*/, '$1/[object]')}`;
    const endpoint = redactCredentials(`https://api.cloudflare.com/client/v4${zone ? '' : '/accounts/[REDACTED]'}${operation.slice(method.length + 1)}`);
    const transportFailure = (cause, attempts, status = null) => {
      const error = new Error('provider-transport-failed');
      // Portable across vendored kit copies used by custom deploy hooks. Raw
      // network messages stay private until the CLI applies its redactor.
      error.providerTransport = {operation:redactCredentials(operation),endpoint,attempts,status,reason:transportReason(cause)};
      return recordDeployFailure(error,{output:redactAuth(transportOutput(cause))});
    };
    const {response,output = ''} = await providerResponse({method,timeoutMs,callerSignal,removal,
      replayableAsset:method === 'POST' && (/^\/workers\/scripts\/[^/]+\/assets-upload-session$/.test(path) || path === '/workers/assets/upload?base64=true'),
      reserveRetry:() => requests < maxRequests && (++requests, true),failure:transportFailure,
      consume:(response,attempts) => response.body ? boundedText(response,undefined,cause => transportFailure(cause,attempts,response.status)) : '',
      send:signal => isR2ObjectDelete(path, method) ? objectDelete(`/client/v4/accounts/${accountId}${path}`, {headers:{Authorization:`Bearer ${token}`},signal}) : request(zone ? `https://api.cloudflare.com/client/v4${path}` : `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      method, redirect: 'error', signal, headers: { Authorization: `Bearer ${assetToken ?? token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type':'application/json' } : {}) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    })});
    // A successful DELETE may have no response body (including HTTP 200).
    // Nonempty replies and all other methods still require the API envelope.
    if (method === 'DELETE' && response.ok && output === '') return { success: true, result: null };
    let payload;
    try { payload = JSON.parse(output); } catch { if (response.ok) throw new Error('malformed-response'); }
    if (!response.ok || payload?.success === false) {
      const error = new Error(response.ok ? 'provider-unsuccessful-or-malformed' : `provider-http-${response.status}`);
      error.status = response.status;
      // What Cloudflare refused, on the error itself so any caller (a custom hook
      // with its own copy of the kit too) can say it: the call, and Cloudflare's own
      // codes and messages, without credentials and bounded.
      const bounded = text => redactAuth(text).replace(/[\x00-\x1f\x7f-\x9f]+/g,' ').trim().slice(0,300);
      const said = (Array.isArray(payload?.errors) ? payload.errors : []).filter(x => Number.isSafeInteger(x?.code) || typeof x?.message === 'string').slice(0,3)
        .map(x => ({...(Number.isSafeInteger(x.code) ? {code:x.code} : {}),...(typeof x.message === 'string' ? {message:bounded(x.message)} : {})}));
      error.providerRefusal = {operation:redactCredentials(operation),errors:said.length || payload !== undefined || !output.trim() ? said : [{message:bounded(output.trim().split('\n')[0])}]};
      throw recordDeployFailure(error,{providerCodes:(Array.isArray(payload?.errors) ? payload.errors : []).filter(x => Number.isSafeInteger(x?.code)).map(x=>x.code).slice(0,8),
        output:redactAuth(Array.isArray(payload?.errors) ? payload.errors.filter(x=>typeof x?.message==='string').map(x=>x.message).join('\n') : output)});
    }
    assert(payload?.success === true && Object.hasOwn(payload,'result') && (!payload.errors || Array.isArray(payload.errors) && !payload.errors.length), 'provider-unsuccessful-or-malformed');
    if (/^\/d1\/database\/[^/]+\/query$/.test(path) && Array.isArray(payload.result)) {
      const failed = payload.result.filter(row => row?.success === false);
      if (failed.length) {
        // D1 can fail inside a successful HTTP/API envelope. Read only typed
        // error fields; query results and metadata are never diagnostic output.
        const errors = failed.flatMap(row => [typeof row.error === 'string' ? {message:row.error} : row.error, ...(Array.isArray(row.errors) ? row.errors : [])]);
        const error = new Error('d1-query-failed');
        error.providerRefusal = {operation:redactCredentials(operation),errors:errors.filter(item => Number.isSafeInteger(item?.code) || typeof item?.message === 'string').map(item => ({code:item.code,message:typeof item.message === 'string' ? redactAuth(item.message).slice(0,300) : undefined})).slice(0,3)};
        throw recordDeployFailure(error,{providerCodes:errors.filter(error=>Number.isSafeInteger(error?.code)).map(error=>error.code).slice(0,8),
          output:redactAuth(errors.filter(error=>typeof error?.message==='string').map(error=>error.message).join('\n'))});
      }
    }
    return payload;
  }
  async function envelope(path, options = {}) {
    try { return await rawEnvelope(path,options); }
    catch (error) {
      error.providerCall ??= {operation:`${options.method ?? 'GET'} ${path.split('?')[0].replace(/(\/r2\/buckets\/[^/]+\/objects)\/.*/, '$1/[object]')}`,reason:error.message};
      throw error;
    }
  }
  async function collect(path, options) {
    let result, rows = [];
    for await (const page of providerPages(envelope, path, options)) {
      result ??= page.data.result;
      rows.push(...page.rows);
      assert(rows.length <= 10000, 'provider-list-too-large');
    }
    return options?.field ? {...result,[options.field]:rows} : rows;
  }
  async function list(path, options = {}) {
    const shape = {...providerListShape(path),...options};
    const result = await collect(path,shape);
    return shape.field ? result[shape.field] : result;
  }
  async function requestResult(path, options = {}) {
    const shape = (!options.method || options.method === 'GET') && providerListShape(path);
    return shape ? collect(path,{...shape,zone:options.zone,signal:options.signal}) : (await envelope(path,options)).result;
  }
  /** A Worker version's own modules, as Cloudflare keeps them: multipart parts and the entry module's name. */
  async function workerContent(worker, versionId) {
    assert(/^[a-z0-9-]{1,63}$/.test(worker) && /^[0-9a-f-]{36}$/.test(versionId), 'invalid-provider-path');
    assert(++requests <= maxRequests, 'provider-request-budget');
    const operation = 'GET /workers/scripts/[worker]/content/v2';
    const {response,output} = await providerResponse({method:'GET',timeoutMs,reserveRetry:() => requests < maxRequests && (++requests, true),
      send:signal => request(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker}/content/v2?version=${versionId}`, {method:'GET',redirect:'error',signal,headers:{Authorization:`Bearer ${token}`}}),
      consume:response => response.body ? boundedBytes(response, 64 * 1024 * 1024) : Buffer.alloc(0),
      failure:(cause,attempts) => Object.assign(new Error('provider-transport-failed'), {providerTransport:{operation,endpoint:`https://api.cloudflare.com/client/v4/accounts/[REDACTED]/workers/scripts/${worker}/content/v2`,attempts,status:null,reason:transportReason(cause)}})});
    if (!response.ok) throw Object.assign(new Error(`provider-http-${response.status}`), {status:response.status,providerCall:{operation,reason:`provider-http-${response.status}`}});
    const type = response.headers.get('content-type') ?? '', entry = response.headers.get('cf-entrypoint');
    assert(type.startsWith('multipart/form-data') && typeof entry === 'string' && entry, 'invalid-worker-content');
    const parts = await new Response(output, {headers:{'content-type':type}}).formData();
    assert(parts.has(entry), 'invalid-worker-content');
    return {parts, entry};
  }
  async function upload(url, bytes, etag) {
    const destination = importUploadURL(url);
    assert(++requests <= maxRequests, 'provider-request-budget');
    const {response} = await providerResponse({method:'PUT',timeoutMs,
      reserveRetry:() => requests < maxRequests && (++requests, true),
      send:signal => request(destination, { method:'PUT', redirect:'error', signal, headers:{'Content-Length':String(bytes.length)}, body:bytes }),
      failure:(cause,attempts) => Object.assign(new Error('d1-import-upload-transport-failed'), {providerTransport:{operation:'PUT D1 import upload',endpoint:'https://[REDACTED].r2.cloudflarestorage.com/[D1 import upload]',attempts,status:null,reason:transportReason(cause)}}),
    });
    // Upload bodies and signed URLs are never diagnostics, including on failure.
    await response.body?.cancel().catch(() => {});
    assert(response.status === 200, 'd1-import-upload-failed');
    assert(response.headers.get('etag')?.replace(/^"|"$/g, '') === etag, 'd1-import-upload-etag-mismatch');
  }
  return { accountId, envelope, list, importSql(id, sql) { return importD1({envelope,upload,redact:text => redactValues(text,[accountId,token])}, id, sql); }, request:requestResult, workerContent,
    zoneRequest(path, options = {}) { return requestResult(path, { ...options, zone: true }); } };
}
