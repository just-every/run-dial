import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as https } from 'node:https';
import { request as http } from 'node:http';
import { Readable } from 'node:stream';
import { isPublicAddress } from '../../integrations/core/public-address.ts';
export async function publicFetch(input, init, redirects = 0) {
 const request = new Request(input, init), url = new URL(request.url), host = url.hostname.replace(/^\[|\]$/g, '');
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || host === 'localhost' || /\.(?:localhost|local|internal)$/.test(host)) throw new Error('Egress destination refused');
 const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
 if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Egress destination is not public');
 const pinned = addresses[0], headers = Object.fromEntries(request.headers);
 for (const name of ['host', 'connection', 'proxy-authorization', 'transfer-encoding', 'content-length']) delete headers[name];
 const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer());
 if (body) headers['content-length'] = String(body.length);
 const response = await new Promise((resolve, reject) => {
  const outgoing = (url.protocol === 'https:' ? https : http)(url, { method: request.method, headers, agent: false, rejectUnauthorized: true,
   lookup: (_host, options, done) => options.all ? done(null, [pinned]) : done(null, pinned.address, pinned.family),
  }, incoming => {
   const responseHeaders = new Headers();
   for (let i = 0; i < incoming.rawHeaders.length; i += 2) responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
   incoming.once('end', () => request.signal.removeEventListener('abort', abort));
   incoming.once('close', () => request.signal.removeEventListener('abort', abort));
   resolve(new Response(request.method === 'HEAD' || [204, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers: responseHeaders }));
  });
  const abort = () => outgoing.destroy(new Error('Egress aborted')); request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  outgoing.setTimeout(30000, () => outgoing.destroy(new Error('Egress timeout'))); outgoing.once('error', reject); outgoing.end(body);
 });
 if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
  if (request.redirect === 'manual') return response;
  await response.body?.cancel();
  if (request.redirect === 'error' || redirects >= 10) throw new Error('Egress redirect refused');
  const destination = new URL(response.headers.get('location'), url), nextHeaders = new Headers(request.headers);
  if (destination.origin !== url.origin) for (const name of ['authorization', 'cookie']) nextHeaders.delete(name);
  const get = response.status === 303 || ([301, 302].includes(response.status) && request.method === 'POST');
  return publicFetch(destination, { method: get ? 'GET' : request.method, headers: nextHeaders, signal: request.signal, redirect: request.redirect, ...(!get && body ? { body } : {}) }, redirects + 1);
 }
 return response;
}
