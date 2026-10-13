import { secretScanner } from './secret-scanner.mjs';
// Every HTTP advance gets a fresh wrapper. Scan the complete object, including
// credentials straddling part boundaries; never depend on process-local tails.
export function guardedBucket(bucket, knownSecrets) {
 const scanned = new Map();
 return new Proxy(bucket, { get(target, key) {
  if (key === 'get') return async (name, options) => {
   const result = await target.get(name, options); if (!result) return result;
   if (scanned.get(name) !== result.etag) {
    const whole = options?.range ? await target.get(name) : result;
    if (!whole || whole.etag !== result.etag) throw Error('archive-object-changed');
    const scan = secretScanner(knownSecrets);
    if (whole.body) for await (const bytes of whole.body) scan(bytes);
    else scan(new Uint8Array(await whole.arrayBuffer()));
    scanned.set(name, result.etag);
    // The full object's body was consumed; return an independently checked read.
    if (!options?.range) {
     const next = await target.get(name, options);
     if (!next || next.etag !== result.etag) throw Error('archive-object-changed');
     return next;
    }
   }
   return result;
  };
  if (key === 'list') return async options => {
   const page = await target.list(options);
   for (const object of page.objects) secretScanner(knownSecrets)(new TextEncoder().encode(JSON.stringify({ key: object.key, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata })));
   return page;
  };
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
 } });
}
