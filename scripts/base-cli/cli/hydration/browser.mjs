// Chromium from the seed's own Playwright, the two ways of serving pages to it
// (the production build as rer deploy hosts it, or a running origin), and one
// load: scripts held until the probe releases them, every external request aborted.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { RerError } from '../errors.mjs';
import { serveHosted } from '../hosted-output.mjs';
import { probe } from './probe.mjs';
import { cloudflareRewrite } from './cases.mjs';

const INSTALL = 'pnpm exec playwright install chromium';

export async function launchChromium(root) {
 const require = createRequire(join(root, 'package.json'));
 let playwright, name;
 for (const candidate of ['playwright-core', '@playwright/test', 'playwright']) { try { playwright = require(candidate); name = candidate; break; } catch {} }
 if (!playwright?.chromium) throw new RerError('hydration_browser_missing', `The hydration check runs Chromium through the seed's own Playwright, and none of playwright-core, @playwright/test or playwright resolves from ${join(root, 'package.json')}. Add @playwright/test to devDependencies, install, then run ${INSTALL}.`, 1);
 // Pages fulfilled by the check would otherwise count as public, and Chromium would
 // refuse a dev server's loopback HMR socket from them.
 try { return await playwright.chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks'] }); }
 catch (error) { throw new RerError('hydration_browser_missing', `The hydration check could not start Chromium from the seed's ${name}: ${String(error.message).split('\n').find(line => line.trim()) ?? error}. Install the browser it pins with ${INSTALL}.`, 1); }
}

const strip = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);
const plainHeaders = headers => { const out = {}; headers.forEach((value, key) => { if (!strip.has(key)) out[key] = value; }); return out; };

/** The production build served the way rer deploy hosts it, at its https origin. */
export async function hostedServer(root, options) {
 const hosted = await serveHosted(root, options);
 const request = async (path, init) => { const response = await hosted.fetch(path.replace(/^\//, ''), init); return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) }; };
 return { origin: hosted.origin, mode: 'hosted', close: () => hosted.close(), request,
  answer: async route => { const r = route.request(), url = new URL(r.url()); const answer = await request(url.pathname + url.search, { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined }); return { status: answer.status, headers: plainHeaders(answer.headers), body: answer.body }; } };
}

/** A running rer dev or rer preview. */
export function originServer(origin) {
 origin = new URL(origin).origin;
 const request = async (path, init) => { const response = await fetch(origin + path, { redirect: 'manual', ...init }); return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) }; };
 return { origin, mode: 'origin', close: async () => {}, request,
  answer: async route => { const response = await route.fetch({ maxRedirects: 0 }); const headers = { ...response.headers() }; for (const key of strip) delete headers[key]; return { status: response.status(), headers, body: await response.body() }; } };
}

/** One page load: returns the probe's record, console and page errors, the
 * same-origin script requests (scripts), those answered before the probe released
 * the hold (unheld: none unless the hold failed) and the aborted cross-origin script
 * requests sent in CORS mode, as module fetches are (crossScripts). */
export async function runLoad(browser, server, path, item, { timeout = 30000 } = {}) {
 const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: item.reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
 const errors = [], warnings = [], aborted = new Set(), scripts = new Set(), unheld = new Set(), crossScripts = new Set();
 let release, isReleased = false; const released = new Promise(resolve => { release = () => { isReleased = true; resolve(); }; });
 try {
  const page = await context.newPage();
  await page.exposeBinding('__rerRelease', () => { release(); });
  await page.addInitScript({ content: `(${probe})(${JSON.stringify({ kind: item.kind, section: item.section, release: item.release })})` });
  page.on('pageerror', error => errors.push(`page error: ${String(error.message).split('\n')[0]}`));
  page.on('console', message => {
   const text = message.text(), type = message.type();
   if (type === 'error' && !(/^Failed to load resource/.test(text) && aborted.has(message.location().url))) errors.push(`console error: ${text.split('\n')[0].slice(0, 300)}`);
   if (type === 'warning' && /hydrat/i.test(text)) warnings.push({ text: text.split('\n')[0].slice(0, 300), componentStack: /\n\s+at \S/.test(text) });
  });
  await page.route('**/*', async route => {
   const request = route.request(), url = new URL(request.url());
   if (url.origin !== server.origin) {
    aborted.add(request.url());
    if (request.resourceType() === 'script' && request.headers().origin) crossScripts.add(request.url());
    return route.abort();
   }
   if (request.resourceType() === 'script') { scripts.add(url.pathname); await released; }
   if (request.resourceType() === 'script' && !isReleased) unheld.add(url.pathname);
   try {
    const rewrite = item.kind === 'cloudflare' && request.isNavigationRequest() && request.frame() === page.mainFrame();
    if (!rewrite && server.mode === 'origin') return await route.continue();
    const answer = await server.answer(route);
    if (rewrite && answer.status === 200) answer.body = Buffer.from(cloudflareRewrite(answer.body.toString('utf8'), { decode: item.decode }).html);
    await route.fulfill(answer);
   } catch (error) { if (!page.isClosed()) await route.abort().catch(() => {}); if (!/closed|disposed/i.test(String(error))) errors.push(`check could not serve ${url.pathname}: ${error.message}`); }
  });
  const started = Date.now();
  await page.goto(server.origin + path, { waitUntil: 'commit', timeout });
  const settled = await page.waitForFunction(() => window.__rerProbe?.settledAt !== null && window.__rerProbe?.settledAt !== undefined, null, { timeout, polling: 50 }).then(() => true, () => false);
  const record = await page.evaluate(() => window.__rerProbe ?? null).catch(() => null);
  return { record: settled ? record : { ...(record ?? {}), settled: 'timeout' }, errors, warnings, aborted: [...aborted], scripts: [...scripts], unheld: [...unheld], crossScripts: [...crossScripts], ms: Date.now() - started };
 } finally { release(); await context.close(); }
}

/** Runs tasks with at most `width` in flight, keeping their order. */
export async function pool(tasks, width) {
 const results = []; let next = 0;
 await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, async () => { while (next < tasks.length) { const index = next++; results[index] = await tasks[index](); } }));
 return results;
}
