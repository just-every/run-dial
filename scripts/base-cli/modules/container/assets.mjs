import { readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
const types = { '.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon' };
export function assets(directory) {
 return { async fetch(input, init) {
  const request = new Request(input, init); if (!['GET','HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  let path; try { path = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response(null, { status: 400 }); }
  if (path.includes('\0') || path.includes('\\') || path.split('/').some(item => item.startsWith('.'))) return new Response(null, { status: 404 });
  const root = await realpath(directory), candidate = join(root, path); let file;
  try { file = await realpath(candidate); if ((await stat(file)).isDirectory()) file = await realpath(join(file, 'index.html')); } catch { return new Response(null, { status: 404 }); }
  const local = relative(root, file); if (local === '..' || local.startsWith('../')) return new Response(null, { status: 404 });
  const bytes = await readFile(file); return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream' } });
 } };
}
