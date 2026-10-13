// Requests rer itself makes to a local app's own origin (health, sign-in,
// outbox, dev identity). A directly served origin uses fetch. A front-door
// origin (http://NAME.localhost:PORT) is never resolved and never goes through
// the door: rer connects with node:http to that checkout's own proxy on
// 127.0.0.1, which keeps the Host header (fetch drops a Host override, and musl
// and some Linux resolvers do not resolve *.localhost), and adds the proxy's
// per-start secret. Redirects within the routed origin are followed the way
// fetch follows them. A `*.localhost` origin with no route (its server is not
// running in this process's knowledge) is refused before anything is sent:
// whatever answers that name (the door, or a process that took its port) never
// receives rer's own requests, which can carry the checkout's dev key.
import http from 'node:http';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The shared loopback predicate, beside this copy in Base or in a seed's scripts/.
const portable = basename(dirname(fileURLToPath(import.meta.url))) === 'base-onboarding';
const { isLocalhostName } = await import(new URL(portable ? '../base-cli/modules/operator-auth/loopback.mjs' : '../modules/operator-auth/loopback.mjs', import.meta.url));

const routes = new Map();

/** Send this process's requests for `origin` to 127.0.0.1:`port` with `headers` added. */
export function routeOrigin(origin, { port, headers = {} }) {
 routes.set(new URL(origin).origin, { port, headers });
}

/** One HTTP/1.1 exchange with a loopback listener, Host as given. */
export function loopbackRequest({ host = '127.0.0.1', port, path = '/', method = 'GET', headers = {}, body, signal, timeoutMs = 30000 }) {
 return new Promise((resolve, reject) => {
  const request = http.request({ host, port, path, method, headers, agent: false, signal }, response => {
   const chunks = [];
   response.on('data', chunk => chunks.push(chunk));
   response.on('end', () => resolve({ status: response.statusCode, statusText: response.statusMessage ?? '', rawHeaders: response.rawHeaders, body: Buffer.concat(chunks) }));
   response.on('error', reject);
  });
  request.setTimeout(timeoutMs, () => request.destroy(Object.assign(Error(`No answer from ${host}:${port} within ${timeoutMs / 1000} s.`), { code: 'ETIMEDOUT' })));
  request.on('error', reject);
  request.end(body);
 });
}

async function bodyBytes(body) {
 if (body === undefined || body === null) return undefined;
 if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body);
 return Buffer.from(await new Response(body).arrayBuffer());
}

const nullBody = status => [101, 103, 204, 205, 304].includes(status);

function unrouted(url) {
 return Object.assign(new TypeError(`fetch failed: rer sends nothing to ${url.origin} except through that checkout's own server, which is not running here.`), { code: 'ERR_RER_UNROUTED' });
}

export async function appFetch(input, init = {}) {
 let url = new URL(input instanceof Request ? input.url : String(input));
 if (!routes.has(url.origin) && isLocalhostName(url.hostname)) throw unrouted(url);
 if (!routes.has(url.origin)) return fetch(input, init);
 let method = (init.method ?? 'GET').toUpperCase(), body = await bodyBytes(init.body);
 const sent = Object.fromEntries(new Headers(init.headers ?? {}));
 if (body !== undefined && init.body instanceof URLSearchParams && !sent['content-type']) sent['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
 for (let hops = 0; ; hops++) {
  const route = routes.get(url.origin);
  if (!route && isLocalhostName(url.hostname)) throw unrouted(url);
  if (!route) return fetch(url, { ...init, method, body });
  const reply = await loopbackRequest({ port: route.port, path: url.pathname + url.search, method, headers: { ...sent, ...route.headers, host: url.host, ...(body ? { 'content-length': String(body.length) } : {}) }, body, signal: init.signal });
  const headers = new Headers();
  for (let i = 0; i < reply.rawHeaders.length; i += 2) headers.append(reply.rawHeaders[i], reply.rawHeaders[i + 1]);
  const location = headers.get('location');
  if (location && [301, 302, 303, 307, 308].includes(reply.status) && (init.redirect ?? 'follow') !== 'manual') {
   if (init.redirect === 'error') throw new TypeError('fetch failed: redirect');
   if (hops >= 20) throw new TypeError('fetch failed: too many redirects');
   if (reply.status === 303 || ([301, 302].includes(reply.status) && method === 'POST')) { method = 'GET'; body = undefined; delete sent['content-type']; }
   url = new URL(location, url);
   continue;
  }
  const response = new Response(nullBody(reply.status) || method === 'HEAD' ? null : reply.body, { status: reply.status, statusText: reply.statusText, headers });
  Object.defineProperty(response, 'url', { value: url.href });
  return response;
 }
}
