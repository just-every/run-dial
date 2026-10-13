import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { refuse } from './errors.mjs';
import { DEV_AI_MARKER, DEV_LAYER_MARKER } from './dev-identity.mjs';

// What a run site may hold: static pages and the files they use, served as
// Cloudflare static assets with default HTML handling. Never server code,
// Wrangler configuration, migrations, settings, local data or owner data.
const FORBIDDEN = /^(?:wrangler\.(?:json|jsonc|toml)|_worker\.js|_routes\.json|_headers|_redirects|.*\.(?:sql|rer|db|sqlite|sqlite3|env|map))$/i;
// Routes that exist only on an installed instance.
export const INSTANCE_ROUTES = ['/signin', '/sign-in', '/login', '/setup', '/app', '/auth', '/api', '/__dev', '/health', '/.well-known'];
const MAX_FILE = 25 * 1024 * 1024, MAX_FILES = 20000;

/** Every file, as a site path ("run.html") with its bytes. */
async function files(folder) {
 const found = new Map();
 async function walk(directory, prefix) {
  for (const name of (await readdir(directory)).sort()) {
   const path = join(directory, name), site = prefix + name, status = await lstat(path);
   if (name.startsWith('.')) throw refuse(`The run site holds a hidden file: ${site}. It contains only public pages and their files.`);
   if (status.isSymbolicLink() || (!status.isFile() && !status.isDirectory())) throw refuse(`The run site holds a link or special file: ${site}.`);
   if (status.isDirectory()) { await walk(path, site + '/'); continue; }
   if (FORBIDDEN.test(name)) throw refuse(`The run site holds ${site}, which is not a static page or asset. Server code, configuration, migrations and data never go in it.`);
   if (status.size > MAX_FILE) throw refuse(`The run site file ${site} is larger than 25 MiB.`);
   found.set(site, await readFile(path));
   if (found.size > MAX_FILES) throw refuse('The run site holds more than 20,000 files.');
  }
 }
 await walk(folder, '');
 return found;
}

const safeDecode = path => { try { return decodeURI(path); } catch { return path; } };

/** How Cloudflare's static assets (auto-trailing-slash) answer a path, or null. */
export function servedFile(names, pathname) {
 const path = pathname.replace(/^\/+/, '');
 if (!path) return names.has('index.html') ? 'index.html' : null;
 if (names.has(path) && !path.endsWith('.html')) return path;
 const bare = path.replace(/\/$/, '');
 if (names.has(`${bare}.html`)) return `${bare}.html`;
 if (names.has(`${bare}/index.html`)) return `${bare}/index.html`;
 return null;
}

// href/src attributes, srcset candidates and CSS url() references.
function references(text, html) {
 const found = [];
 if (html) {
  for (const match of text.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
   const [, tag, attributes] = match, rel = /\brel\s*=\s*["']?([^"'>]*)/i.exec(attributes)?.[1].toLowerCase() ?? '';
   for (const attribute of attributes.matchAll(/\b(href|src|srcset|action|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const name = attribute[1].toLowerCase(), value = (attribute[2] ?? attribute[3]).replace(/&amp;/g, '&');
    const values = name === 'srcset' ? value.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean) : [value];
    // Only a plain link or a page anchor navigates; everything else is fetched by the page.
    const navigates = name === 'href' && (tag.toLowerCase() === 'a' || tag.toLowerCase() === 'area' || (tag.toLowerCase() === 'link' && /\b(?:canonical|alternate|author|license|help|me)\b/.test(rel)));
    for (const url of values) found.push({ url, navigates });
   }
  }
 }
 for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) found.push({ url: match[1] ?? match[2] ?? match[3], navigates: false });
 return found;
}

/**
 * Refuse a run site folder that is not exactly static pages and the files they
 * use: an index and a Run page, every same-origin link resolving, no link to an
 * instance-only route, nothing fetched from another origin, no dev layer, and
 * none of the given private values (owner identity, secrets, the dev key).
 */
export async function checkSite(folder, { privateValues = [] } = {}) {
 const all = await files(folder), names = new Set(all.keys());
 if (!names.has('index.html')) throw refuse('The run site has no index.html (its homepage).');
 if (!servedFile(names, '/run')) throw refuse('The run site has no /run page.');
 const markers = [DEV_LAYER_MARKER, DEV_AI_MARKER].map(value => Buffer.from(value));
 const secrets = privateValues.filter(value => typeof value === 'string' && value.length >= 6).map(value => Buffer.from(value));
 const problems = [];
 for (const [site, bytes] of all) {
  if (markers.some(marker => bytes.includes(marker))) throw refuse(`The run site file ${site} contains the local-only dev layer.`);
  if (secrets.some(secret => bytes.includes(secret))) throw refuse(`The run site file ${site} contains this installation's private data (owner identity or a secret). The run site renders only edition identity.`);
  const html = site.endsWith('.html'), css = site.endsWith('.css');
  if (!html && !css) continue;
  for (const { url, navigates } of references(bytes.toString('utf8'), html)) {
   if (!url || /^(?:#|mailto:|tel:|data:|javascript:void)/i.test(url)) continue;
   if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
    if (!navigates) problems.push(`${site} fetches ${url} from another origin`);
    continue;
   }
   const pathname = posix.resolve('/' + posix.dirname(site), url.replace(/[?#].*$/, ''));
   if (INSTANCE_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))) problems.push(`${site} links to ${pathname}, which exists only on an installed instance`);
   else if (!servedFile(names, safeDecode(pathname))) problems.push(`${site} links to ${pathname}, which the site does not have`);
  }
 }
 if (problems.length) throw refuse(`The run site has broken or out-of-site references: ${problems.slice(0, 8).join('; ')}${problems.length > 8 ? `; and ${problems.length - 8} more` : ''}.`);
 return { files: names.size, pages: [...names].filter(name => name.endsWith('.html')).length };
}
