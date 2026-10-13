#!/usr/bin/env node
// Child of `rer build --site` and `rer dev`: builds the seed's declared site
// entry with the checkout's own Vite for Node (an SSR build), loads it and
// calls its sitePages({ styles }), then writes the static run site: "/" to
// index.html, "/run" to run.html, "/docs/a" to docs/a.html, "/404" to
// 404.html, the declared public files, and the stylesheet and files the
// entry's CSS imports compile to. The optional site config is a Vite config
// naming the plugins the site pages need (a docs virtual module, a CSS
// toolchain); the app's own Vite config is never loaded, because its Worker
// plugins do not run in Node. It reads no installation data.
// Usage: node site-render.mjs ROOT ENTRY OUTPUT [CONFIG]
import { cp, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, entry, output, config] = process.argv.slice(2);
const fail = message => { process.stderr.write(`${message}\n`); process.exit(2); };
if (!root || !entry || !output) fail('Usage: site-render.mjs ROOT ENTRY OUTPUT [CONFIG]');
const inside = (base, path) => { const target = resolve(base, path); return target === base || target.startsWith(base + sep) ? target : null; };
// Compiled CSS and the files it references land under this folder of the site.
const ASSETS = 'site-assets';

let vite;
try { vite = await import(pathToFileURL(createRequire(join(root, 'package.json')).resolve('vite')).href); }
catch { fail('The run site renders with the checkout\'s own Vite. Run rer install first.'); }
process.env.NODE_ENV ??= 'production';

// The Node bundle sits beside the output, inside the checkout, so its external
// imports resolve from the checkout's node_modules. It never enters the site.
const server = `${output}.render`;
let module, styles = [], files = [];
try {
 const built = await vite.build({
  root, configFile: config ? resolve(root, config) : false, envFile: false, logLevel: 'error', mode: 'production',
  build: {
   ssr: resolve(root, entry), outDir: server, emptyOutDir: true, copyPublicDir: false, ssrEmitAssets: true,
   cssCodeSplit: false, assetsDir: ASSETS, sourcemap: false, minify: false, reportCompressedSize: false, watch: null,
  },
 }).catch(error => fail(`The run site entry ${entry} did not build: ${error.message.split('\n')[0]}${config ? '' : ' If its pages need Vite plugins (a docs virtual module, a CSS toolchain), name a site Vite config: site: { config } in the command adapter.'}`));
 const outputs = (Array.isArray(built) ? built : [built]).flatMap(result => result.output ?? []);
 const chunk = outputs.find(item => item.type === 'chunk' && item.isEntry);
 if (!chunk) fail(`The run site entry ${entry} produced no module.`);
 files = outputs.filter(item => item.type === 'asset' && item.fileName.startsWith(`${ASSETS}/`)).map(item => item.fileName);
 styles = files.filter(name => name.endsWith('.css')).map(name => `/${name}`);
 await writeFile(join(server, 'package.json'), '{"type":"module"}\n');
 module = await import(pathToFileURL(join(server, chunk.fileName)).href);
 if (typeof module.sitePages !== 'function') fail(`${entry} must export sitePages(), returning { pages: [{ path, html }], assets: [public paths] }.`);
 const build = await module.sitePages({ styles });
 if (!Array.isArray(build?.pages) || !Array.isArray(build.assets)) fail('sitePages() returns { pages, assets }.');

 const written = new Set();
 for (const page of build.pages) {
  if (typeof page?.path !== 'string' || !/^\/(?:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)?$/i.test(page.path) || page.path.endsWith('.html') || typeof page.html !== 'string') fail(`Invalid site page ${JSON.stringify(page?.path)}: a path such as /run with its HTML.`);
  const file = page.path === '/' ? 'index.html' : `${page.path.slice(1)}.html`;
  if (written.has(file) || file.startsWith(`${ASSETS}/`)) fail(`Duplicate site page ${page.path}.`);
  written.add(file);
  await mkdir(dirname(join(output, file)), { recursive: true });
  await writeFile(join(output, file), page.html);
 }
 const publicDirectory = resolve(root, 'public');
 for (const asset of build.assets) {
  const source = typeof asset === 'string' && !asset.split('/').some(part => !part || part.startsWith('.')) && inside(publicDirectory, asset);
  if (!source || source === publicDirectory) fail(`Invalid site asset ${JSON.stringify(asset)}: a file or folder under public/.`);
  if (asset === ASSETS || asset.startsWith(`${ASSETS}/`)) fail(`public/${ASSETS} is reserved for the run site's compiled styles; rename it.`);
  await lstat(source).catch(() => fail(`Missing site asset public/${asset}.`));
  await cp(source, join(output, asset), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
 }
 // Only the emitted files: the Node chunks share the folder and never ship.
 for (const file of files) {
  await mkdir(dirname(join(output, file)), { recursive: true });
  await cp(join(server, file), join(output, file), { errorOnExist: true, force: false });
 }
 process.stdout.write(`${JSON.stringify({ pages: build.pages.length, assets: build.assets.length, styles: styles.length })}\n`);
} finally { await rm(server, { recursive: true, force: true }); }
// Vite and the loaded pages can keep handles open; every file is written.
process.exit(0);
