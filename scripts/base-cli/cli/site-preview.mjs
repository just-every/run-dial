import { createServer } from 'node:http';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { servedFile } from './site-check.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };

async function names(folder) {
 const found = new Set();
 async function walk(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
   if (entry.isDirectory()) await walk(join(directory, entry.name), prefix + entry.name + '/');
   else if (entry.isFile()) found.add(prefix + entry.name);
  }
 }
 await walk(folder, '');
 return found;
}

/**
 * Serve a built run site on loopback the way Cloudflare's static assets serve
 * it (auto-trailing-slash HTML handling, 404.html for a missing path): the
 * preview `rer dev` prints as RER_SITE. GET and HEAD only; nothing else is read.
 */
export async function sitePreview(folder, { host = '127.0.0.1', ports }) {
 const server = createServer(async (request, response) => {
  try {
   if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { allow: 'GET, HEAD' }); return response.end(); }
   const url = new URL(request.url, 'http://site.invalid'), files = await names(folder);
   let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { pathname = '/'; }
   // A request for page.html is answered at its canonical path, as the host does.
   if (pathname.endsWith('.html') && files.has(pathname.slice(1))) {
    const canonical = pathname.endsWith('/index.html') || pathname === '/index.html' ? pathname.slice(0, -'index.html'.length) : pathname.slice(0, -'.html'.length);
    response.writeHead(307, { location: canonical + url.search }); return response.end();
   }
   const file = pathname.includes('\0') || pathname.split('/').some(part => part === '..' || part.startsWith('.')) ? null : servedFile(files, pathname);
   const target = file ?? (files.has('404.html') ? '404.html' : null);
   if (!target || !(await lstat(join(folder, target))).isFile()) { response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return response.end('Not found'); }
   const body = await readFile(join(folder, target));
   response.writeHead(file ? 200 : 404, { 'content-type': types[extname(target).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': body.length });
   response.end(request.method === 'HEAD' ? undefined : body);
  } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
 });
 for (const port of ports) {
  const bound = await new Promise(resolve => {
   const failed = () => resolve(false);
   server.once('error', failed);
   server.listen(port, host, () => { server.off('error', failed); resolve(true); });
  });
  if (bound) return { url: `http://${host === '::1' ? '[::1]' : host}:${port}`, port, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
 }
 throw new Error('No free port for the run site preview.');
}
