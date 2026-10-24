import assert from 'node:assert/strict';
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

contract(['BRAND-001', 'PROFILE-003'], 'a website read stores its mark, colours and face with the face\'s own licence, and serves the mark and face under /media/brand/ inline with nosniff', async () => {
  const site = await acmeSite();
  const f = await fixture(internet({ 'acme.example': site.port }));
  try {
    const read = await json(await f.send('/api/app/site-look/read', { body: { url: 'acme.example' } }));
    assert.equal(read.look, 'site');
    assert.equal(read.website.host, 'acme.example');
    assert.ok(Number.isFinite(Date.parse(read.website.readAt)), 'the read is stored with its time');
    assert.equal(read.read.name, 'Acme Tracking');
    assert.deepEqual(read.read.colours, { background: '#fbf7ef', ink: '#1f2a44', accent: '#0f7b6c', buttonInk: '#7fbfb5' });
    assert.deepEqual([read.read.face.family, read.read.face.licence, read.read.face.usable], ['Acme Sans', 'OFL', true]);
    // The pair that fails contrast is replaced for its role only, and the stored look says so.
    const { buttonInk, ...kept } = read.shown.colours;
    assert.deepEqual(kept, { background: '#fbf7ef', ink: '#1f2a44', accent: '#0f7b6c' });
    assert.notEqual(buttonInk, '#7fbfb5');
    assert.deepEqual(read.notes.filter(note => note.code === 'contrast').flatMap(note => note.adjusted.map(change => change.role)), ['buttonInk']);
    for (const [file, type, bytes] of [[read.read.mark, 'image/svg+xml', Buffer.from(mark)], [read.read.face.file, 'font/woff2', face]]) {
      assert.match(file.url, /^\/media\/brand\/[a-f0-9]{64}\.[a-z0-9]+$/);
      const response = await f.send(file.url, { anonymous: true });
      assert.equal(response.status, 200, file.url);
      assert.equal(response.headers.get('content-type'), type);
      assert.equal(response.headers.get('content-disposition'), 'inline');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    assert.equal((await f.send(`/media/brand/${'0'.repeat(64)}.svg`, { anonymous: true })).status, 404, 'only the stored look\'s files are public');
    // The stored look is what Settings reads; `shown` is the public look booking pages will wear.
    assert.deepEqual(await json(await f.send('/api/app/site-look')), read);
    assert.deepEqual([read.shown.kind, read.shown.mark, read.shown.face.file], ['site', read.read.mark, read.read.face.file]);
  } finally { await f.close(); await site.close(); }
});

contract('BRAND-001', 'a site that refuses or gives nothing leaves the plain look, a failed read keeps the look read before, and the stored look says why', async () => {
  const [site, blank, refusing] = await Promise.all([acmeSite(), serveSite({ '/': ['text/html', '<!doctype html><html><head></head><body></body></html>'] }), closedPort()]);
  const f = await fixture(internet({ 'acme.example': site.port, 'blank.example': blank.port, 'refusing.example': refusing }));
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
  } finally { await f.close(); await Promise.all([site.close(), blank.close()]); }
});
