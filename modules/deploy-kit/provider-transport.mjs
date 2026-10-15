// A missing HTTP status does not prove that a write never reached Cloudflare.
// Only these connection-establishment failures make replaying a write safe.
const UNSENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);
function unsent(error, seen = new Set()) {
  if (!error || seen.has(error) || seen.size >= 8) return false;
  seen.add(error);
  if (Array.isArray(error.errors)) return error.errors.length > 0 && error.errors.every(cause => unsent(cause, seen));
  if (typeof error.code === 'string') return UNSENT.has(error.code);
  return unsent(error.cause, seen);
}

/** Retry only before a response, once, sharing the original deadline and budget. */
export async function providerResponse({send, method, timeoutMs, callerSignal, reserveRetry, failure}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const read = method === 'GET' || method === 'HEAD';
  for (let attempt = 1; ; attempt++) {
    // Leave time for a second read when the first one times out. Caller deadlines
    // remain authoritative and are never reset by a retry.
    const firstRead = read && attempt === 1 ? new AbortController() : undefined;
    const timer = firstRead ? setTimeout(() => firstRead.abort(new DOMException('Provider read timed out','TimeoutError')), Math.max(1, Math.ceil(timeoutMs / 2))) : undefined;
    timer?.unref();
    const attemptSignal = firstRead ? AbortSignal.any([signal, firstRead.signal]) : signal;
    try { return {response:await send(attemptSignal),attempts:attempt}; }
    catch (cause) {
      if (attempt === 1 && !signal.aborted && (read || unsent(cause)) && reserveRetry()) continue;
      throw failure(cause, attempt);
    }
    // Headers end the retry window; body consumption keeps the total deadline.
    finally { clearTimeout(timer); }
  }
}

export function transportOutput(error) {
  const lines = [], seen = new Set();
  for (let cause = error; cause && !seen.has(cause) && seen.size < 4; cause = cause.cause) {
    seen.add(cause);
    lines.push([typeof cause.code === 'string' ? cause.code : '', typeof cause.message === 'string' ? cause.message : ''].filter(Boolean).join(': '));
  }
  // Network errors can echo signed URLs. Keep their destination, never URL
  // credentials, query parameters or fragments, before later secret redaction.
  return lines.filter(Boolean).join('\n').replace(/\bhttps?:\/\/[^\s<>"']+/gi, value => {
    try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
    catch { return '[URL omitted]'; }
  });
}

export function transportReason(error) {
  const seen = new Set();
  for (let cause = error; cause && !seen.has(cause) && seen.size < 4; cause = cause.cause) {
    seen.add(cause);
    if (typeof cause.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(cause.code)) return cause.code;
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') return cause.name;
  }
  return 'network error';
}
