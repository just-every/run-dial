// Which scripts a page loads count as the application's, so a page that loads them
// and never hydrates fails rather than being skipped as plain HTML. They are:
// script requests to the page's own origin; module scripts and modulepreload links
// in the served document, from any origin (a Vite base on a CDN host); and
// cross-origin script requests sent in CORS mode, as every module fetch is, that
// the document does not name as a classic <script src>. A third-party classic
// script on a plain-HTML page is none of these.

const attribute = (attrs, name) => { const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(attrs); return match ? (match[1] ?? match[2] ?? match[3]) : null; };
const resolveUrl = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };

/** The module scripts (inline ones as "inline module script"), modulepreload links
 * and classic script sources of a served document, as absolute URLs. */
export function documentScripts(html, pageUrl) {
 const tag = /<!--[\s\S]*?-->|<(script|link)\b([^>]*)>/gi, modules = [], classic = [];
 for (let match; (match = tag.exec(html));) {
  const name = match[1]?.toLowerCase(), attrs = match[2] ?? '';
  if (name === 'link') {
   const href = attribute(attrs, 'href');
   if (href && (attribute(attrs, 'rel') ?? '').toLowerCase().split(/\s+/).includes('modulepreload')) modules.push(resolveUrl(href, pageUrl));
  } else if (name === 'script') {
   const src = attribute(attrs, 'src'), module = (attribute(attrs, 'type') ?? '').trim().toLowerCase() === 'module';
   if (module) modules.push(src ? resolveUrl(src, pageUrl) : 'inline module script');
   else if (src) classic.push(resolveUrl(src, pageUrl));
   const close = html.toLowerCase().indexOf('</script', tag.lastIndex);
   tag.lastIndex = close < 0 ? html.length : close;
  }
 }
 return { modules: modules.filter(Boolean), classic: classic.filter(Boolean) };
}

/** The application scripts of one load of `path`, given the document it was served:
 * same-origin paths as paths, other origins as full URLs. */
export function applicationScripts(load, html, origin, path) {
 const page = new URL(path, origin), show = url => { const parsed = new URL(url, page); return parsed.origin === page.origin ? parsed.pathname + parsed.search : parsed.href; };
 const { modules, classic } = documentScripts(html ?? '', page.href), named = new Set(classic);
 const found = [...load.scripts, ...modules.map(url => url === 'inline module script' ? url : show(url)), ...load.crossScripts.filter(url => !named.has(url)).map(show)];
 return [...new Set(found)];
}
