import { PortabilityError } from '@runeditrun/rer/modules/portability';
import { secretScanner } from './secret-scanner.mjs';
// Base's HTTP handler preserves typed refusals but hides ordinary exceptions.
// Translate only the scanner's fixed refusal, never provider exception text.
function guardedScanner(knownSecrets) {
 const scan = secretScanner(knownSecrets);
 return bytes => {
  try { scan(bytes); }
  catch (error) {
   if (error instanceof Error && error.message === 'archive-object-contains-credential') throw new PortabilityError('archive-object-contains-credential', 409);
   throw error;
  }
 };
}
// Every HTTP advance gets a fresh wrapper. Scan the complete object, including
// credentials straddling part boundaries; never depend on process-local tails.
export function guardedBucket(bucket, knownSecrets) {
 const scanned = new Map();
 return new Proxy(bucket, { get(target, key) {
  if (key === 'get') return async (name, options) => {
   const result = await target.get(name, options); if (!result) return result;
   if (scanned.get(name) !== result.etag) {
    const whole = options?.range ? await target.get(name) : result;
    if (!whole || whole.etag !== result.etag) throw new PortabilityError('archive-object-changed', 409);
    const scan = guardedScanner(knownSecrets);
    if (whole.body) for await (const bytes of whole.body) scan(bytes);
    else scan(new Uint8Array(await whole.arrayBuffer()));
    scanned.set(name, result.etag);
    // The full object's body was consumed; return an independently checked read.
    if (!options?.range) {
     const next = await target.get(name, options);
     if (!next || next.etag !== result.etag) throw new PortabilityError('archive-object-changed', 409);
     return next;
    }
   }
   return result;
  };
  if (key === 'list') return async options => {
   const page = await target.list(options);
   for (const object of page.objects) guardedScanner(knownSecrets)(new TextEncoder().encode(JSON.stringify({ key: object.key, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata })));
   return page;
  };
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
 } });
}
