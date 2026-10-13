// The in-page half of the hydration check. `probe` is serialized into an init
// script, so it must stay self-contained (no imports, no closures over module
// scope). It runs before the document parses, while the check holds every
// application script in the network layer:
//  - when parsing ends (readyState "interactive"), it surveys the page sections,
//    makes the case's edit, snapshots every element in <body> and starts sampling;
//  - it releases the held scripts (window.__rerRelease) once every one-shot
//    animation has finished ("after") or at the midpoint of the edited section's
//    intro window ("mid"), recording whether React had already hydrated;
//  - every frame it samples one-shot animations, the opacity of animated elements
//    and which page sections are present;
//  - once React owns the page and the DOM and animations are quiet, it records
//    which snapshot elements were replaced and sets settledAt.
// Elements are matched across a rebuild by a structural key (tag:index path from
// <body>) that ignores script, style, link, template and noscript elements and the
// nodes the probe inserted.
export function probe(config) {
 const S = window.__rerProbe = { config, survey: null, edit: null, editBeforeHydration: null, sectionKeys: [], addressSections: [], addressLoose: false,
  replaced: [], starts: {}, opacity: {}, missing: [], frames: 0, oneShot: [], releasedAt: null, releaseNote: null, fiberAtRelease: null, hydratedAt: null, settledAt: null, settled: null, rer: null, error: null };
 const SECTION = new Set(['HEADER', 'NAV', 'SECTION', 'ARTICLE', 'ASIDE', 'FOOTER']), SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT']);
 const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/, ADDRESS = '.__cf_email__,a[href*="/cdn-cgi/l/email-protection"]';
 const inserted = new WeakSet(), tracked = new WeakMap(), watch = new Set();
 const now = () => Math.round(performance.now() * 10) / 10;
 const own = (el, prefix) => { for (const key of Object.keys(el)) if (key.startsWith(prefix)) return el[key]; return undefined; };
 const fiber = el => own(el, '__reactFiber$') !== undefined;
 const counted = el => !SKIP.has(el.tagName) && !inserted.has(el);
 const kids = el => [...el.children].filter(counted);
 const keyOf = el => {
  const parts = [];
  for (let e = el; e !== document.body; e = e.parentElement) { if (!e || !e.parentElement || !counted(e)) return null; parts.unshift(e.tagName.toLowerCase() + ':' + kids(e.parentElement).indexOf(e)); }
  return parts.join('>');
 };
 const resolveKey = key => {
  let el = document.body;
  for (const part of key.split('>')) { const at = part.lastIndexOf(':'); el = kids(el)[+part.slice(at + 1)]; if (!el || el.tagName.toLowerCase() !== part.slice(0, at)) return null; }
  return el;
 };
 const walk = (el, key, out) => { let i = 0; for (const child of el.children) { if (!counted(child)) continue; const k = (key ? key + '>' : '') + child.tagName.toLowerCase() + ':' + i++; out.push([child, k]); walk(child, k, out); } return out; };
 const outermost = () => { const out = []; const visit = el => { for (const child of el.children) { if (!counted(child)) continue; if (SECTION.has(child.tagName)) out.push(child); else visit(child); } }; visit(document.body); return out; };
 const label = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.classList.length ? '.' + el.classList[0] : '') + (el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : '');
 const texts = root => {
  const out = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { const p = n.parentElement; if (p && !p.closest('script,style,template,noscript,textarea,svg') && n.nodeValue.trim()) out.push(n); }
  return out;
 };
 // A text node with sibling nodes is a separate text fiber: splitting it always mismatches.
 const mixed = n => n.nodeValue.trim().length >= 4 && n.parentNode.childNodes.length >= 2;
 const lone = n => n.nodeValue.trim().length >= 2 && n.parentNode.childNodes.length === 1;
 const split = n => { const rest = n.splitText(Math.max(1, Math.floor(n.nodeValue.length / 2))), span = document.createElement('span'); inserted.add(span); span.textContent = rest.nodeValue; rest.replaceWith(span); };
 const anyFiber = () => fiber(document.body) || [...document.body.querySelectorAll('*')].some(fiber);
 // An element React has not hydrated yet: no fiber, under a parent React owns that does not set its HTML.
 const pending = () => [...document.body.querySelectorAll('*')].filter(el => counted(el) && !el.closest('svg') && !fiber(el) && el.parentElement && fiber(el.parentElement) && !own(el.parentElement, '__reactProps$')?.dangerouslySetInnerHTML).length;
 const oneShot = () => document.getAnimations().filter(a => {
  if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) return false;
  const timing = a.effect && a.effect.getComputedTiming();
  return timing && Number.isFinite(timing.endTime) && timing.activeDuration >= 50;
 });
 const outside = n => !outermost().some(section => section.contains(n));
 let snapshot = [], scope = null, editAt = null, lastMutation = 0;

 function begin() {
  const sections = outermost();
  S.sectionKeys = sections.map(keyOf);
  S.survey = {
   sections: sections.map(section => { const all = texts(section); return { key: keyOf(section), label: label(section), split: all.some(mixed), lone: all.some(lone) }; }),
   loose: texts(document.body).some(n => outside(n) && mixed(n)),
   advisories: texts(document.body).filter(n => mixed(n) && EMAIL.test(n.nodeValue)).map(n => { const section = sections.find(s => s.contains(n)); return { section: section ? label(section) : 'outside every section', text: n.nodeValue.trim().slice(0, 80) }; }),
  };
  S.addressSections = sections.filter(s => s.querySelector(ADDRESS) || EMAIL.test(s.textContent)).map(keyOf);
  S.addressLoose = texts(document.body).some(n => outside(n) && EMAIL.test(n.nodeValue)) || [...document.querySelectorAll(ADDRESS)].some(outside);
  S.editBeforeHydration = !anyFiber();
  if (config.kind === 'section' || config.kind === 'loose') {
   const root = config.kind === 'section' ? sections[config.section] : document.body;
   if (config.kind === 'section') scope = root;
   const candidates = root ? texts(root).filter(n => config.kind === 'section' || outside(n)) : [];
   const target = candidates.find(mixed) ?? (config.kind === 'section' ? candidates.find(lone) : undefined);
   if (target) {
    const mode = mixed(target) ? 'split' : 'text';
    S.edit = { mode, parent: keyOf(target.parentElement), text: target.nodeValue.trim().slice(0, 60) };
    if (mode === 'split') split(target); else target.nodeValue = 'Übersetzt: ' + target.nodeValue;
   }
  }
  snapshot = walk(document.body, '', []);
  editAt = now();
  new MutationObserver(() => { lastMutation = now(); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  requestAnimationFrame(frame);
 }

 function release(note) {
  // React owning any element already means a script the check could not hold (an
  // inline module script) hydrated the page, so the release timing was not exercised.
  S.releasedAt = now(); S.releaseNote = note ?? null; S.fiberAtRelease = anyFiber();
  window.__rerRelease();
 }

 function tryRelease() {
  if (S.releasedAt !== null || S.frames < 3) return;
  const animations = oneShot();
  if (config.release === 'mid') {
   const mine = animations.filter(a => (scope ?? document.body).contains(a.effect.target));
   if (!mine.length) return release('no intro to release into');
   if (mine.some(a => a.startTime === null)) return;
   const start = Math.min(...mine.map(a => a.startTime + a.effect.getTiming().delay)), end = Math.max(...mine.map(a => a.startTime + a.effect.getComputedTiming().endTime));
   const at = document.timeline.currentTime;
   if (at >= (start + end) / 2) release(`${Math.round(100 * (at - start) / (end - start))}% through the intro window (${Math.round(start)}-${Math.round(end)} ms)`);
   return;
  }
  if (animations.some(a => a.playState !== 'finished') && now() - editAt < 15000) return;
  release();
 }

 function sample() {
  S.frames++;
  for (const a of oneShot()) {
   const el = a.effect.target;
   if (!el || !el.isConnected) continue;
   let record = tracked.get(el);
   // A new element object at a key gets a new id, so a rebuilt element is a second entry.
   if (!record) { const key = keyOf(el); if (key === null) continue; record = { key, id: S.oneShot.length + 1 }; tracked.set(el, record); watch.add(key); }
   const name = a.animationName || a.id || 'animation', list = (S.starts[record.key + ' ' + name] ??= []);
   if (!S.oneShot.includes(record.key + ' ' + name)) S.oneShot.push(record.key + ' ' + name);
   if (a.startTime !== null && !list.some(item => item.id === record.id)) list.push({ id: record.id, start: Math.round((a.startTime + a.effect.getTiming().delay) * 10) / 10, seen: now() });
  }
  for (const key of watch) {
   const el = resolveKey(key);
   if (!el) continue;
   const opacity = +getComputedStyle(el).opacity, record = (S.opacity[key] ??= { first: opacity, max: opacity, dip: null });
   if (opacity > record.max) record.max = opacity;
   else if (record.max > record.first && record.max - opacity > 0.15 && (!record.dip || record.max - opacity > record.dip.from - record.dip.to)) record.dip = { from: record.max, to: opacity, at: now() };
  }
  const present = new Set(outermost().map(keyOf)), lost = S.sectionKeys.filter(key => !present.has(key));
  if (lost.length) S.missing.push({ at: now(), lost });
 }

 function frame() {
  if (S.settledAt !== null) return;
  try {
   sample();
   tryRelease();
   const t = now();
   if (S.releasedAt !== null) {
    if (S.hydratedAt === null && fiber(document.body) && pending() === 0) S.hydratedAt = t;
    const quiet = t - lastMutation > 300 && !oneShot().some(a => a.playState === 'running');
    if (S.hydratedAt !== null && t - S.hydratedAt > 300 && quiet) return settle('hydrated');
    if (S.hydratedAt === null && t - S.releasedAt > 8000 && !anyFiber()) return settle('not hydrated');
    if (t - S.releasedAt > 20000) return settle('timeout');
   }
  } catch (error) { S.error = String(error && error.stack || error); return settle('error'); }
  requestAnimationFrame(frame);
 }

 function settle(state) {
  S.settled = state; S.settledAt = now();
  S.replaced = snapshot.filter(([el]) => !el.isConnected).map(([, key]) => key);
  S.rer = window.__rerHydration ? JSON.parse(JSON.stringify(window.__rerHydration)) : null;
 }

 let begun = false;
 document.addEventListener('readystatechange', () => {
  if (begun || document.readyState === 'loading') return;
  begun = true;
  try { begin(); } catch (error) { S.error = String(error && error.stack || error); settle('error'); }
 });
}
