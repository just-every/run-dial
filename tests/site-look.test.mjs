import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { contract } from './contract.mjs';
import { fixture } from './site-look/fixture.mjs';
import { closedPort, internet, serveSite, woff2Face } from './site-look/site.mjs';

const mark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0f7b6c"/><path fill="#ffffff" d="M18 46 32 14l14 32h-8l-6-15-6 15z"/></svg>';
const face = woff2Face('Acme Sans', 'This Font Software is licensed under the SIL Open Font License, Version 1.1.', 'https://openfontlicense.org');
const home = `<!doctype html><html lang="en"><head><title>Time tracking for teams | Acme Tracking</title>
<meta name="description" content="Acme Tracking keeps your team's hours in one place.">
<link rel="icon" type="image/svg+xml" href="/mark.svg"><link rel="stylesheet" href="/assets/site.css"></head>
<body><header><a class="skip-link" href="#main">Skip to content</a><a class="logo" href="/">Acme Tracking</a>
<nav><a href="/pricing">Pricing</a><a class="button button-primary" href="/signup">Start free</a></nav></header>
<main id="main"><h1>Hours, kept.</h1></main></body></html>`;
// The button's own text colour fails contrast on its fill; the rest of the palette passes.
const css = `:root { --paper: #fbf7ef; --ink: #1f2a44; --brand: #0f7b6c; }
@font-face { font-family: "Acme Sans"; font-weight: 400; src: url("../fonts/acme-sans.woff2") format("woff2"); }
html, body { background: var(--paper); color: var(--ink); font-family: "Acme Sans", system-ui, sans-serif; }
.skip-link { background: #ffde00; color: #000; }
.button-primary { background-color: var(--brand); color: #7fbfb5; }
@media (prefers-color-scheme: dark) { body { background: #000; } }`;
const acmeSite = () => serveSite({ '/': ['text/html; charset=utf-8', home], '/mark.svg': ['image/svg+xml', mark], '/assets/site.css': ['text/css', css], '/fonts/acme-sans.woff2': ['font/woff2', face] });
const json = async response => { assert.equal(response.status, 200); return response.json(); };

contract('BRAND-001', 'a website read stores its mark with its source, its colours, and its face\'s family, kind and own licence; only the mark is served under /media/brand/ (inline, nosniff), the site\'s font file never is, and booking pages set the face in an open face Dial bundles', async () => {
  const site = await acmeSite();
  const f = await fixture(internet({ 'acme.example': site.port }));
  try {
    const read = await json(await f.send('/api/app/site-look/read', { body: { url: 'acme.example' } }));
    assert.equal(read.look, 'site');
    assert.equal(read.website.host, 'acme.example');
    assert.ok(Number.isFinite(Date.parse(read.website.readAt)), 'the read is stored with its time');
    assert.equal(read.read.name, 'Acme Tracking');
    assert.deepEqual(read.read.colours, { background: '#fbf7ef', ink: '#1f2a44', accent: '#0f7b6c', buttonInk: '#7fbfb5' });
    // The face is described from its own file and the site's stack, and the file stays on the site.
    assert.deepEqual(read.read.face, { family: 'Acme Sans', kind: 'sans', licence: 'OFL', source: 'https://acme.example/fonts/acme-sans.woff2', unread: null });
    // The pair that fails contrast is replaced for its role only, and the stored look says so.
    const { buttonInk, ...kept } = read.shown.colours;
    assert.deepEqual(kept, { background: '#fbf7ef', ink: '#1f2a44', accent: '#0f7b6c' });
    assert.notEqual(buttonInk, '#7fbfb5');
    assert.deepEqual(read.notes.filter(note => note.code === 'contrast').flatMap(note => note.adjusted.map(change => change.role)), ['buttonInk']);
    assert.equal(read.read.mark.source, 'https://acme.example/mark.svg');
    assert.match(read.read.mark.url, /^\/media\/brand\/[a-f0-9]{64}\.[a-z0-9]+$/);
    const response = await f.send(read.read.mark.url, { anonymous: true });
    assert.equal(response.status, 200, read.read.mark.url);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.equal(response.headers.get('content-disposition'), 'inline');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(mark));
    const faceHash = createHash('sha256').update(face).digest('hex');
    for (const extension of ['woff2', 'woff', 'ttf', 'otf']) assert.equal((await f.send(`/media/brand/${faceHash}.${extension}`, { anonymous: true })).status, 404, 'the site\'s font file is never served');
    assert.equal((await f.send(`/media/brand/${'0'.repeat(64)}.svg`, { anonymous: true })).status, 404, 'only the stored look\'s files are public');
    // The stored look is what Settings reads; `shown` is the public look booking pages will wear, its face one Dial bundles.
    assert.deepEqual(await json(await f.send('/api/app/site-look')), read);
    assert.deepEqual([read.shown.kind, read.shown.mark], ['site', { url: read.read.mark.url, contentType: 'image/svg+xml' }]);
    assert.equal(read.shown.face.match, 'kind');
    assert.ok(!read.shown.face.file.url.startsWith('/media/'), 'the face shown is Dial\'s own file');
  } finally { await f.close(); await site.close(); }
});

contract('BRAND-001', 'a read never drops what was there: a site that refuses or gives nothing leaves the plain look or the look read before, the stored look says why, and a value set by hand survives a read of another website until the owner takes the read value', async () => {
  const [site, blank, refusing] = await Promise.all([acmeSite(), serveSite({ '/': ['text/html', '<!doctype html><html><head></head><body></body></html>'] }), closedPort()]);
  const f = await fixture(internet({ 'acme.example': site.port, 'acme-studio.example': site.port, 'blank.example': blank.port, 'refusing.example': refusing }));
  try {
    const refused = await json(await f.send('/api/app/site-look/read', { body: { url: 'refusing.example' } }));
    assert.deepEqual([refused.look, refused.because, refused.lastRead.ok, refused.website], ['plain', 'read_failed', false, null]);
    assert.ok(refused.lastRead.message);
    assert.deepEqual(await json(await f.send('/api/app/site-look')), refused);
    const empty = await json(await f.send('/api/app/site-look/read', { body: { url: 'blank.example' } }));
    assert.deepEqual([empty.look, empty.because, empty.lastRead.ok, empty.shown.kind], ['plain', 'nothing_found', false, 'plain']);

    const read = await json(await f.send('/api/app/site-look/read', { body: { url: 'acme.example' } }));
    assert.equal(read.look, 'site');
    const failed = await json(await f.send('/api/app/site-look/read', { body: { url: 'refusing.example' } }));
    assert.deepEqual([failed.look, failed.because, failed.lastRead.ok, failed.website], ['site', 'read', false, read.website]);
    assert.deepEqual(failed.shown, read.shown);

    const handSet = await json(await f.send('/api/app/site-look', { method: 'PUT', body: { name: 'Acme by hand', accent: '#5b2a86' } }));
    const other = await json(await f.send('/api/app/site-look/read', { body: { url: 'acme-studio.example' } }));
    assert.equal(other.website.host, 'acme-studio.example');
    assert.deepEqual(other.overrides, handSet.overrides);
    assert.deepEqual([other.shown.name, other.shown.colours.accent], ['Acme by hand', '#5b2a86']);
    const taken = await json(await f.send('/api/app/site-look', { method: 'PUT', body: { name: null } }));
    assert.deepEqual([taken.shown.name, taken.shown.colours.accent], [other.read.name, '#5b2a86']);
  } finally { await f.close(); await Promise.all([site.close(), blank.close()]); }
});
