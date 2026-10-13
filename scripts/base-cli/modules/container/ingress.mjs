import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
export async function incoming(req, { trustedProxy, maxRequestBytes = 25 * 1024 * 1024 } = {}) {
 const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
 const peer = req.socket.remoteAddress?.replace('::ffff:', '') ?? '';
 const trusted = trustedProxy && (isIP(trustedProxy) ? peer===trustedProxy : (await lookup(trustedProxy,{all:true})).some(item=>item.address.replace('::ffff:','')===peer));
 let host = req.headers.host, proto = 'http', address = peer;
 if (trusted) { host = req.headers['x-forwarded-host'] ?? host; proto = req.headers['x-forwarded-proto'] ?? proto; address = req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() ?? peer; }
 for (const name of ['cf-connecting-ip','x-forwarded-host','x-forwarded-proto','x-forwarded-for','forwarded','x-rer-original-url']) headers.delete(name);
 if (!['http', 'https'].includes(proto) || typeof host !== 'string' || !/^(?:[a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::[0-9]+)?$/.test(host)) throw new Error('Invalid ingress origin');
 headers.set('cf-connecting-ip', address); headers.set('host', host);
 const url = `${proto}://${host}${req.url}`;
 const chunks = []; let size = 0;
 for await (const chunk of req) { size += chunk.length; if (size > maxRequestBytes) { const error = new Error('Request too large'); error.status = 413; throw error; } chunks.push(chunk); }
 return new Request(url, { method: req.method, headers, ...(!['GET','HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
}
export function outgoing(response, res) {
 res.statusCode = response.status;
 for (const [name, value] of response.headers) if (!['set-cookie','content-length','transfer-encoding'].includes(name)) res.setHeader(name, value);
 const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
 if (response.body) { const stream = Readable.fromWeb(response.body); res.once('close', () => stream.destroy()); stream.once('error', () => res.destroy()); stream.pipe(res); } else res.end();
}
