import { StringDecoder } from 'node:string_decoder';
import { assert } from './validation.mjs';

// Do not flush an incomplete final character: a replacement would corrupt a
// truncated credential prefix before the caller can redact it.
const decodePrefix = bytes => new StringDecoder('utf8').write(bytes.subarray(0,256));

async function bodyPrefix(response) {
  if (!response.body) return {body:'',complete:true};
  const reader = response.body.getReader(); let bytes = Buffer.alloc(0), complete = false;
  try {
    while (bytes.length < 256) {
      const {done,value} = await reader.read();
      if (done) { complete = true; break; }
      bytes = Buffer.concat([bytes,value.subarray(0,256-bytes.length)]);
    }
  } catch { /* HTTP status remains authoritative if its diagnostic body breaks. */ }
  finally { await reader.cancel().catch(() => {}); }
  return {body:decodePrefix(bytes),complete};
}

/** One credential-free, bounded request. Retain only bounded response evidence. */
/** `expected` holds the deploy identity fields the caller knows; each must match. */
export async function healthRequest({origin, expected, request, timeoutMs, offsetMs, retryIdentityMismatch = false}) {
  const attempt = {offsetMs,status:null,cfRay:null,contentType:null,body:'',errorClass:null};
  let response;
  try {
    response = await request(`${origin}/health`, {redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{'Cache-Control':'no-cache','Accept':'application/json'}});
  } catch {
    attempt.errorClass = 'health-transport-failed';
    return {attempt,transient:true};
  }
  attempt.status = response.status;
  attempt.cfRay = response.headers.get('cf-ray')?.slice(0,256) ?? null;
  attempt.contentType = response.headers.get('content-type')?.slice(0,256) ?? null;
  if (response.status !== 200 || response.redirected) {
    const prefix = await bodyPrefix(response);
    attempt.body = prefix.body;
    attempt.errorClass = 'health-http-failed';
    return {attempt,routePropagation:!response.redirected && response.status === 404 && prefix.complete && prefix.body.trim() === 'error code: 1042',transient:!response.redirected && (response.status === 404 || response.status >= 500 && response.status <= 599)};
  }
  let bytes = Buffer.alloc(0);
  try {
    assert(response.body,'empty-response');
    const reader = response.body.getReader();
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        bytes = Buffer.concat([bytes, value]);
        attempt.body = decodePrefix(bytes);
        assert(bytes.length <= 65536,'response-too-large');
      }
    } finally { await reader.cancel().catch(() => {}); }
  } catch (error) {
    attempt.errorClass = ['response-too-large','empty-response'].includes(error.message) ? error.message : 'health-transport-failed';
    // A redirect or permanent status can never become retryable via body IO.
    return {attempt,transient:attempt.errorClass === 'health-transport-failed' && (response.status === 200 || response.status === 404 || response.status >= 500 && response.status <= 599)};
  }
  let body;
  try { body = JSON.parse(bytes.toString('utf8')); }
  catch { attempt.errorClass = 'malformed-response'; return {attempt,transient:false}; }
  if (body?.ok !== true || Object.entries(expected).some(([key, value]) => body.deployment?.[key] !== value)) {
    attempt.errorClass = 'health-identity-mismatch';
    // Right after an upload the edge can still answer from another version: that
    // settles within the bound. Final source observation also waits out healthy
    // identity mismatches; other callers reject a wrong identity from the
    // expected version at once.
    const key = expected.versionId ? 'versionId' : 'sourceSha';
    const other = body?.ok === true && typeof body.deployment?.[key] === 'string' && body.deployment[key] !== expected[key];
    return {attempt,transient:other || retryIdentityMismatch && body?.ok === true};
  }
  return {attempt,transient:false};
}

/** Retries are spaced 1 s, doubling to a 10 s cap, never closer than the 2 s poll
 * interval of the standalone readiness window: 2, 2, 4, 8, 10, 10 ... seconds. */
const MIN_DELAY_MS = 2000, MAX_DELAY_MS = 10000;

/** The total bound includes requests, body reads and backoff; no request starts at the deadline.
 * Only a transient outcome is retried. Every attempt is recorded, in order, whatever the end. */
export async function waitHealth({origin,receipt,versionId,expected={sourceSha:receipt.source.sha,fingerprint:receipt.fingerprint,versionId},request,timeoutMs=30000,totalMs=90000,clock=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onAttempt=()=>{},single=false,freshUpload=false,window,retryIdentityMismatch=false}) {
  assert(Number.isFinite(totalMs) && totalMs > 0 && totalMs <= 90000 && Number.isFinite(timeoutMs) && timeoutMs > 0,'invalid-health-bound');
  const start = clock(); const attempts = []; let delay = 1000;
  while (true) {
    const remaining = Math.min(totalMs - (clock()-start), window?.remaining() ?? Infinity);
    if (remaining <= 0) break;
    const result = await healthRequest({origin,expected,request,timeoutMs:Math.max(1,Math.ceil(Math.min(timeoutMs,remaining))),offsetMs:Math.round(clock()-start),retryIdentityMismatch});
    attempts.push(result.attempt); await onAttempt(result.attempt,attempts);
    if (!result.attempt.errorClass) return {ok:true,versionId,attempts};
    // A newly uploaded workers.dev route can briefly disappear even after its
    // first healthy answer. Only the observed edge 1042 response gets this exception.
    const routePropagation = freshUpload && new URL(origin).protocol === 'https:' && new URL(origin).hostname.endsWith('.workers.dev') && result.routePropagation;
    if (!result.transient || single && result.attempt.errorClass !== 'health-identity-mismatch' && !routePropagation) break;
    const rest = Math.min(totalMs - (clock()-start), window?.remaining() ?? Infinity);
    if (rest <= 0) break;
    await sleep(Math.min(Math.max(delay,MIN_DELAY_MS),rest)); delay = Math.min(delay*2,MAX_DELAY_MS);
  }
  const last = attempts.at(-1);
  const error = new Error(`${last?.errorClass ?? 'health-timeout'}-last-status-${last?.status ?? 'transport'}`);
  error.attempts = attempts; error.status = last?.status ?? null;
  throw error;
}
