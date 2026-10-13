// The Base hydration check (SEED-COMMAND-CONTRACT.md, "Hydration units"). rer
// verify runs it on the production build served as rer deploy hosts it; run it on
// its own against a running rer dev or rer preview with --origin:
//   node scripts/base-cli/cli/hydration/check.mjs [ROOT] [--origin URL] [--pages /,/docs] [--details]
// For each public page it edits text in each page section before React hydrates
// (scripts held in the network layer) and fails when anything outside that section
// is replaced, an intro replays, a frame loses a section, recovery is noisy or
// uncounted, or a hydrated page's document lacks Cache-Control: no-transform.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RerError } from '../errors.mjs';
import { hostedServer, launchChromium, originServer, pool, runLoad } from './browser.mjs';
import { cloudflareRewrite, describeCase, planCases, selectPages } from './cases.mjs';
import { applicationScripts } from './scripts.mjs';
import { judgePage, judgeUnhydrated, measure, plainHtml } from './verdict.mjs';

const CONTEXTS = 3;

/** Checks the pages and returns the result; `report(lines)` receives its human
 * summary (pages, skips, redirects followed, what was not checked) before it
 * returns or fails on a page. With no page to load it fails naming why. */
export async function checkHydration(root, { origin, pages: declared, declaration, report } = {}) {
 const started = Date.now();
 const server = origin ? originServer(origin) : await hostedServer(root, { declaration });
 let browser;
 try {
  const request = async path => { const answer = await server.request(path); return { status: answer.status, type: answer.headers.get('content-type') ?? '', location: answer.headers.get('location'), cacheControl: answer.headers.get('cache-control'), body: answer.body.toString('utf8') }; };
  const failures = [];
  const selection = await selectPages(request, declared, server.origin);
  // A check that loads no page proves nothing, so it fails rather than passing.
  if (!selection.pages.length) {
   const notChecked = [...selection.redirects, ...selection.refused];
   throw new RerError('hydration_no_pages', `The hydration check loaded no page, so it checked nothing. Not checked: ${notChecked.join('; ')}. Make / answer a page as HTML (directly or through a redirect on the same origin), or name the seed's public pages with the commandAdapter option publicPages (SEED-COMMAND-CONTRACT.md, Hydration units).`, 1, { hydration: { pages: [], redirects: selection.redirects, notChecked: selection.refused, loads: 0 } });
  }
  browser = await launchChromium(root);
  const plain = { kind: 'plain', release: 'after' };
  const baselines = await pool(selection.pages.map(page => () => runLoad(browser, server, page.path, plain)), CONTEXTS);
  const pages = selection.pages.map((page, index) => {
   const baseline = baselines[index], record = baseline.record;
   const hydrated = record?.settled === 'hydrated', scripts = applicationScripts(baseline, page.body, server.origin, page.path);
   const intros = [...new Set((record?.oneShot ?? []).map(id => id.split(' ')[0]))];
   return { path: page.path, cacheControl: page.cacheControl, baseline, survey: record?.survey ?? { sections: [], loose: false, advisories: [] }, intros, addresses: cloudflareRewrite(page.body).count > 0, hydrated, scripts, skipped: plainHtml(baseline, scripts) };
  });
  // Only a document React hydrates needs no-transform: a redirect or a page that
  // never hydrates has no HTML whose rewrite could cause a mismatch.
  for (const page of pages.filter(page => page.hydrated)) if (!/(^|[\s,])no-transform($|[\s,])/i.test(page.cacheControl ?? '')) failures.push(`${page.path} document: Cache-Control is "${page.cacheControl ?? 'absent'}" and lacks no-transform, so a proxy (Cloudflare's email address obfuscation) may rewrite the HTML React hydrates`);
  for (const page of pages) if (!page.hydrated && !page.skipped) failures.push(judgeUnhydrated(page));
  const work = pages.filter(page => page.hydrated).flatMap(page => planCases(page).map(item => ({ page, item })));
  const loads = await pool(work.map(({ page, item }) => () => runLoad(browser, server, page.path, item)), CONTEXTS);
  work.forEach(({ page, item }, index) => { (page.loads ??= []).push({ item, load: loads[index] }); });
  for (const page of pages.filter(page => page.hydrated)) failures.push(...judgePage({ ...page, loads: page.loads ?? [] }));
  const result = {
   served: server.mode === 'hosted' ? 'production build as rer deploy hosts it' : server.origin,
   pages: pages.map(page => page.skipped ? { path: page.path, skipped: 'plain HTML: React does not hydrate this page and it loads no application script' } : {
    path: page.path,
    sections: page.survey.sections.map(section => `${section.label} (${section.key})`),
    intros: page.baseline.record?.oneShot ?? [],
    loads: 1 + (page.loads?.length ?? 0),
    advisories: page.survey.advisories.map(item => `${item.section}: "${item.text}" is text beside sibling elements and holds an email address; make the address the only child of its element`),
    cases: (page.loads ?? []).map(({ item, load }) => summarize(item, load, page)),
   }),
   ...(selection.redirects.length ? { redirects: selection.redirects } : {}),
   ...(selection.refused.length ? { notChecked: selection.refused } : {}),
   loads: pages.length + loads.length,
   ms: Date.now() - started,
  };
  report?.(summary(result));
  if (failures.length) throw new RerError('hydration_units_failed', `Page sections did not hydrate as separate units:\n  ${failures.join('\n  ')}\nEvery page section and the root chrome sit in a HydrationUnit, intros carry data-intro under the root's intro guard, and the client entry passes createRecoverableErrorHandler (src/base/hydration/README.md; SEED-COMMAND-CONTRACT.md, Hydration units).`, 1, { failures, hydration: result });
  return result;
 } finally { await browser?.close(); await server.close(); }
}

/** The human lines for a result: each page, then redirects and what was not checked. */
export function summary(result) {
 return [`Hydration check: ${result.pages.length} page(s), ${result.loads} load(s)`,
  ...result.pages.map(page => `  ${page.path}: ${page.skipped ? `skipped, ${page.skipped}` : `${page.loads} load(s), ${page.sections.length} section(s)`}`),
  ...(result.redirects ?? []).map(note => `  redirect followed: ${note}`),
  ...(result.notChecked ?? []).map(note => `  not checked: ${note}`)];
}

function summarize(item, load, page) {
 const record = load.record ?? {}, { replaced, outside, replays, missing } = record.replaced ? measure(item, record, page) : { replaced: [], outside: [], replays: [], missing: [] };
 return { case: describeCase(item, page.survey), ...(record.edit ? { edit: `${record.edit.mode} "${record.edit.text}"` } : {}), ...(record.releaseNote ? { released: record.releaseNote } : {}), ...(record.fiberAtRelease ? { hydratedBeforeRelease: true } : {}), ...(load.unheld?.length ? { unheld: load.unheld } : {}),
  replaced: replaced.length, replacedOutside: outside.length, replays: replays.length, framesMissingSection: missing.length, frames: record.frames, recovered: record.rer?.count ?? 0,
  ...(load.warnings.length ? { warnings: load.warnings.length, warningsWithStack: load.warnings.filter(w => w.componentStack).length, warning: load.warnings[0].text.slice(0, 160) } : {}), ...(load.errors.length ? { errors: load.errors } : {}), ...(load.aborted.length ? { aborted: load.aborted } : {}) };
}

async function declaredPages(root) {
 try { const { resolveProject } = await import('../project.mjs'); const project = await resolveProject(root); return { pages: project.adapter?.publicPages, declaration: project.adapter?.deployDeclaration ?? project.adapter?.deploy?.declaration }; }
 catch { return {}; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const args = process.argv.slice(2), flag = name => { const at = args.indexOf(name); return at < 0 ? undefined : args.splice(at, 2)[1]; };
 const origin = flag('--origin'), pages = flag('--pages')?.split(',').filter(Boolean), details = args.includes('--details');
 const root = resolve(args.find(arg => !arg.startsWith('--')) ?? '.'), declared = await declaredPages(root);
 try {
  const result = await checkHydration(root, { origin, pages: pages ?? declared.pages, declaration: declared.declaration });
  console.log(JSON.stringify(details ? result : { ...result, pages: result.pages.map(({ cases, ...page }) => page) }, null, 1));
 } catch (error) {
  console.error(error.message);
  if (details && error.hydration) console.error(JSON.stringify(error.hydration, null, 1));
  process.exitCode = 1;
 }
}
