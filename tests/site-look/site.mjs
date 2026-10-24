import { createServer } from 'node:http';
import { brotliCompressSync } from 'node:zlib';

// A public-looking address for every fake host: the reader refuses private ones before it connects.
const publicAddress = '93.184.215.14';

/** A local HTTP server answering `pages` (path → [content type, body]); any other path is 404. */
export async function serveSite(pages) {
  const server = createServer((request, response) => {
    const page = pages[new URL(request.url, 'http://site').pathname];
    if (!page) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': page[0] }).end(page[1]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}

/** A local port nothing listens on: a site that refuses every connection. */
export async function closedPort() {
  const { port, close } = await serveSite({});
  await close();
  return port;
}

/** The internet at Dial's network edge: DNS over HTTPS names each fake host a public address, and its requests reach
 * that host's local port. Anything else is a request the test did not expect. */
export function internet(hosts) {
  return async request => {
    const url = new URL(request.url);
    if (url.hostname === 'cloudflare-dns.com') {
      const name = url.searchParams.get('name');
      const known = Object.hasOwn(hosts, name);
      return Response.json({ Status: known ? 0 : 3, Answer: known && url.searchParams.get('type') === '1' ? [{ name, type: 1, data: publicAddress }] : [] });
    }
    if (!Object.hasOwn(hosts, url.hostname)) throw new Error(`Unexpected outbound request to ${url.host}`);
    return fetch(`http://127.0.0.1:${hosts[url.hostname]}${url.pathname}${url.search}`, { headers: { accept: request.headers.get('accept') ?? '*/*' }, redirect: 'manual' });
  };
}

/** A WOFF2 face holding only a `name` table: its family and its own licence description and URL. */
export function woff2Face(family, licence, licenceUrl) {
  const records = [[1, family], [13, licence], [14, licenceUrl]].map(([id, text]) => [id, Buffer.from(text, 'utf16le').swap16()]);
  const name = Buffer.alloc(6 + records.length * 12 + records.reduce((size, [, text]) => size + text.length, 0));
  name.writeUInt16BE(records.length, 2);
  name.writeUInt16BE(6 + records.length * 12, 4);
  let offset = 0;
  records.forEach(([id, text], index) => {
    const at = 6 + index * 12;
    [3, 1, 0x409, id, text.length, offset].forEach((value, field) => name.writeUInt16BE(value, at + field * 2));
    text.copy(name, 6 + records.length * 12 + offset);
    offset += text.length;
  });
  const compressed = brotliCompressSync(name);
  // One directory entry: known tag 5 (name), untransformed, then its length as UIntBase128.
  const directory = Buffer.from([5, ...base128(name.length)]);
  const header = Buffer.alloc(48);
  header.write('wOF2', 0, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(48 + directory.length + compressed.length, 8);
  header.writeUInt16BE(1, 12);
  header.writeUInt32BE(12 + 16 + name.length, 16);
  header.writeUInt32BE(compressed.length, 20);
  return Buffer.concat([header, directory, compressed]);
}

function base128(value) {
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}
