// Turns probe records into failures. Every failure names the page, the case, the
// section and its evidence.
import { describeCase } from './cases.mjs';

const LATE_MS = 34; // two frames
const within = (key, scope) => key === scope || key.startsWith(scope + '>');
const list = (keys, limit = 6) => keys.slice(0, limit).join(', ') + (keys.length > limit ? ` and ${keys.length - limit} more` : '');

/** Replays in one load: a one-shot animation on a rebuilt element starting more
 * than two frames after the original did, or an animated element whose opacity
 * dropped by more than 0.15 after rising (unless it did so on the plain load). */
export function replays(record, baseline) {
 const found = [];
 for (const [id, entries] of Object.entries(record.starts ?? {})) {
  const [key, name] = id.split(' ');
  for (const entry of entries.slice(1)) { const late = entry.start - entries[0].start; if (late > LATE_MS) { found.push(`${key} restarted its ${name} animation ${Math.round(late)} ms late`); break; } }
 }
 for (const [key, opacity] of Object.entries(record.opacity ?? {})) {
  if (opacity.dip && !baseline?.opacity?.[key]?.dip) found.push(`${key} opacity fell from ${opacity.dip.from.toFixed(2)} to ${opacity.dip.to.toFixed(2)}`);
 }
 return found;
}

/** What one edit load did: replaced elements (less those the plain load replaces),
 * those outside the region the case may rebuild, replays, and frames that lacked
 * a page section present at the edit. */
export function measure(item, record, { survey, baseline }) {
 const base = baseline.record ?? {}, excluded = new Set(base.replaced ?? []);
 const replaced = (record.replaced ?? []).filter(key => !excluded.has(key));
 let allowed = () => true;
 if (item.kind === 'section') { const scope = survey.sections[item.section].key; allowed = key => within(key, scope); }
 else if (item.kind === 'loose') allowed = key => !survey.sections.some(section => within(key, section.key));
 else if (item.kind === 'cloudflare') allowed = key => (record.addressSections ?? []).some(scope => within(key, scope)) || (record.addressLoose && !survey.sections.some(section => within(key, section.key)));
 return { replaced, outside: replaced.filter(key => !allowed(key)), replays: replays(record, base), missing: record.missing ?? [] };
}

/** A page the check may skip: React never hydrated it, it loads no application
 * script (scripts.mjs) and its plain load raised no page or console error. A page
 * whose scripts load but never hydrate (a broken client entry, or client scripts
 * on another origin that the check aborts) is a failure, not a skip. */
export const plainHtml = (load, scripts) => load.record?.settled === 'not hydrated' && !scripts.length && !load.errors.length;

/** The failure for a page whose plain load never hydrated and is not plain HTML. */
export function judgeUnhydrated({ path, scripts, baseline: { record, errors } }) {
 const state = record?.settled ?? 'no probe record';
 const why = state === 'not hydrated' ? `React never hydrated the page${scripts.length ? ` although it loads application scripts (${list(scripts, 3)})` : ''}` : `the page did not settle (${state}${record?.error ? ': ' + record.error : ''})`;
 return `${path} plain load: ${why}${errors.length ? `; ${list([...new Set(errors)], 3)}` : ''}`;
}

/** Failures for one page: its plain load, its case loads and its canaries. */
export function judgePage(page) {
 const failures = [], { path, baseline, loads, survey } = page, base = baseline.record;
 const fail = (what, evidence) => failures.push(`${path} ${what}: ${evidence}`);
 const noisy = (what, load) => { if (load.errors.length) fail(what, `recovery was not quiet (${list([...new Set(load.errors)], 3)})`); };
 const unheld = (what, load) => { if (load.unheld?.length) fail(what, `not exercised: the check's script hold let ${list(load.unheld, 3)} reach the page before the probe released the scripts`); return load.unheld?.length > 0; };
 unheld('plain load', baseline);
 noisy('plain load', baseline);
 if (base.rer?.count) fail('plain load', `window.__rerHydration.count is ${base.rer.count} with no edit (${list(base.rer.stacks ?? [], 2)})`);
 let exercised = false;
 for (const { item, load } of loads) {
  const what = describeCase(item, survey), record = load.record;
  if (!record || record.settled !== 'hydrated') { fail(what, record?.settled === 'error' ? `the probe failed: ${record.error}` : `the page did not settle after hydration within the time limit (${record?.settled ?? 'no record'})`); continue; }
  if (unheld(what, load)) continue;
  noisy(what, load);
  if (item.kind === 'plain') {
   if (item.reduced && record.oneShot.length) fail(what, `one-shot animations ran: ${list(record.oneShot)}`);
   if (record.rer?.count) fail(what, `window.__rerHydration.count is ${record.rer.count} with no edit`);
   continue;
  }
  if (!record.editBeforeHydration) { fail(what, 'not exercised: the edit landed after React had started hydrating'); continue; }
  if (record.fiberAtRelease !== false) { fail(what, 'not exercised: React hydrated before the probe released the scripts (a script the check cannot hold, such as the client bundle inlined in an inline module script, hydrated the page)'); continue; }
  if (item.kind !== 'cloudflare' && !record.edit) { fail(what, 'not exercised: the probe found no text to edit'); continue; }
  const { replaced, outside, replays: replayed, missing } = measure(item, record, page);
  if (outside.length) fail(what, `React replaced ${outside.length} element(s) outside ${item.kind === 'section' ? 'the edited section' : item.kind === 'loose' ? 'the loose content (a page section was rebuilt)' : 'the sections holding addresses'}: ${list(outside)}`);
  if (replaced.length) {
   if (item.kind !== 'cloudflare') exercised = true;
   if (!(record.rer?.count >= 1)) fail(what, `React rebuilt ${replaced.length} element(s) but window.__rerHydration.count is ${record.rer?.count ?? 'absent'}; the client entry must pass onRecoverableError: createRecoverableErrorHandler()`);
  }
  for (const replay of replayed) fail(what, `an intro replayed: ${replay}`);
  if (missing.length) fail(what, `${missing.length} frame(s) lacked a page section present at the edit (${list([...new Set(missing.flatMap(frame => frame.lost))])})`);
 }
 if (survey.sections.length && loads.some(({ item }) => item.kind === 'section' || item.kind === 'loose') && !exercised) fail('all edits', 'not exercised: no edit before hydration made React rebuild anything, so the check proved nothing on this page');
 if (survey.sections.length && !loads.some(({ item }) => item.kind === 'section')) fail('all edits', 'not exercised: no page section has text to edit');
 return failures;
}
