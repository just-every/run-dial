// Which pages the hydration check loads, which cases it runs on each, and the
// Cloudflare email-obfuscation rewrite it applies to served HTML.

export const MAX_PAGES = 6;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const RAW = new Set(['script', 'style', 'textarea', 'noscript', 'template', 'xmp', 'title']);

const REDIRECTS = new Set([301, 302, 303, 307, 308]), HOPS = 5;
const html = answer => answer.status === 200 && /text\/html/i.test(answer.type);
const pagePath = (href, base) => { try { const url = new URL(href, base); return url.origin === new URL(base).origin ? url.pathname : null; } catch { return null; } };

/** Requests `start` and follows same-origin redirects, at most HOPS. Returns the
 * final { path, answer }, the redirects followed and, when the final answer is not
 * a page, why (stopped). */
async function follow(request, start, origin) {
 const followed = [];
 let path = start, answer = await request(path);
 for (;;) {
  if (!(REDIRECTS.has(answer.status) && answer.location)) return { path, answer, followed, stopped: html(answer) ? null : `${path} answered ${answer.status}${answer.type ? ' ' + answer.type : ''}` };
  let next = null; try { next = new URL(answer.location, origin + path); } catch {}
  const note = `${path} answered ${answer.status} to ${answer.location}`;
  if (!next || next.origin !== origin) return { path, answer, followed, stopped: `${note}, another origin the check does not follow` };
  if (followed.length >= HOPS) return { path, answer, followed, stopped: `${note}, past ${HOPS} redirects` };
  followed.push(note); path = next.pathname + next.search; answer = await request(path);
 }
}

/** The public pages to check: `publicPages` when the seed declares it, otherwise
 * the page `/` answers (following same-origin redirects, at most HOPS) plus
 * same-origin links on it that answer 200 HTML without a session (following only a
 * trailing-slash redirect), at most MAX_PAGES. `request(path)` answers
 * { status, type, location, body } from `origin`. Returns the pages, the redirects
 * followed from `/` and what was not checked (refused). */
export async function selectPages(request, declared, origin) {
 if (Array.isArray(declared) && declared.length) return { source: 'publicPages', pages: await Promise.all([...new Set(declared)].map(async path => { const answer = await request(path); return { path, body: answer.body, cacheControl: answer.cacheControl }; })), redirects: [], refused: [] };
 const home = await follow(request, '/', origin);
 if (home.stopped) return { source: 'discovered', pages: [], redirects: home.followed, refused: [home.stopped] };
 const pages = [{ path: home.path, body: home.answer.body, cacheControl: home.answer.cacheControl }], refused = [];
 const links = [...new Set([...home.answer.body.matchAll(/<a\b[^>]*?\bhref=(["'])([^"']*)\1/gi)].map(match => match[2].startsWith('//') ? null : pagePath(match[2], origin + home.path)).filter(path => path && path !== '/' && path !== new URL(home.path, origin).pathname && !/\.[A-Za-z0-9]+$/.test(path)))];
 for (const path of links) {
  if (pages.length >= MAX_PAGES) break;
  let answer = await request(path), final = path;
  if (REDIRECTS.has(answer.status) && answer.location && pagePath(answer.location, origin + path) === path + '/') { final = path + '/'; answer = await request(final); }
  if (html(answer)) { if (!pages.some(page => page.path === final)) pages.push({ path: final, body: answer.body, cacheControl: answer.cacheControl }); }
  else refused.push(`${path} answered ${answer.status}${answer.location ? ' to ' + answer.location : ''}`);
 }
 return { source: 'discovered', pages, redirects: home.followed, refused };
}

// Cloudflare's Email Address Obfuscation: a text address becomes an anchor to
// /cdn-cgi/l/email-protection (a span when it is already inside a link), and a
// mailto: href becomes /cdn-cgi/l/email-protection#<hex>. <head> and raw-text
// elements are left alone.
const encode = address => { const key = 0x5a; return key.toString(16) + [...address].map(c => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join(''); };
const decoder = `<script>(function(){function d(h){var k=parseInt(h.slice(0,2),16),s='';for(var i=2;i<h.length;i+=2)s+=String.fromCharCode(parseInt(h.slice(i,i+2),16)^k);return s}[].forEach.call(document.querySelectorAll('a[href*="/cdn-cgi/l/email-protection#"]'),function(a){a.setAttribute('href','mailto:'+d(a.getAttribute('href').split('#')[1]))});[].forEach.call(document.querySelectorAll('.__cf_email__'),function(e){e.parentNode.replaceChild(document.createTextNode(d(e.getAttribute('data-cfemail'))),e)});document.currentScript.remove()})()</script>`;

/** Returns { html, count }. With `decode`, appends Cloudflare's decoder so it runs
 * before any held application script (the decoder is deferred; it runs before
 * DOMContentLoaded). */
export function cloudflareRewrite(source, { decode = false } = {}) {
 const tag = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:-]*)\b[^>]*>/g;
 let out = '', at = 0, count = 0, link = false, head = false;
 for (;;) {
  tag.lastIndex = at;
  const match = tag.exec(source), end = match ? match.index : source.length;
  const text = source.slice(at, end);
  out += head ? text : text.replace(EMAIL, address => { count++; return link ? `<span class="__cf_email__" data-cfemail="${encode(address)}">[email&#160;protected]</span>` : `<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encode(address)}">[email&#160;protected]</a>`; });
  if (!match) break;
  let token = match[0];
  const closing = match[1] === '/', name = match[2]?.toLowerCase();
  if (name === 'head') head = !closing;
  if (name === 'a') {
   link = !closing;
   if (!closing) token = token.replace(/\bhref=(["'])mailto:([^"'?]+)([^"']*)\1/i, (all, quote, address) => { count++; return `href=${quote}/cdn-cgi/l/email-protection#${encode(decodeURIComponent(address))}${quote}`; });
  }
  out += token; at = match.index + match[0].length;
  if (name && !closing && RAW.has(name)) { const close = source.toLowerCase().indexOf('</' + name, at), stop = close < 0 ? source.length : close; out += source.slice(at, stop); at = stop; }
 }
 if (decode) { const close = out.lastIndexOf('</body>'); out = close < 0 ? out + decoder : out.slice(0, close) + decoder + out.slice(close); }
 return { html: out, count };
}

/** The loads for one page, from its plain load's survey. */
export function planCases(page) {
 const cases = [];
 page.survey.sections.forEach((section, index) => {
  if (!section.split && !section.lone) return;
  cases.push({ kind: 'section', section: index, release: 'after' });
  if (page.intros.some(key => key === section.key || key.startsWith(section.key + '>'))) cases.push({ kind: 'section', section: index, release: 'mid' });
 });
 if (page.survey.loose) cases.push({ kind: 'loose', release: 'after' });
 if (page.addresses) for (const decode of [true, false]) {
  cases.push({ kind: 'cloudflare', decode, release: 'after' });
  if (page.intros.length) cases.push({ kind: 'cloudflare', decode, release: 'mid' });
 }
 cases.push({ kind: 'plain', reduced: true, release: 'after' });
 return cases;
}

export function describeCase(item, survey) {
 const when = item.release === 'mid' ? 'released mid-intro' : 'released after the intros';
 if (item.kind === 'section') { const section = survey.sections[item.section]; return `edit in ${section.label} (${section.key}), ${when}`; }
 if (item.kind === 'loose') return `edit in text outside every section, ${when}`;
 if (item.kind === 'cloudflare') return `Cloudflare email rewrite ${item.decode ? 'decoded before hydration' : 'with its anchors present at hydration'}, ${when}`;
 return item.reduced ? 'plain load with prefers-reduced-motion: reduce' : 'plain load';
}
