import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUN_WORKER_FIRST } from '../modules/deploy-kit/render.mjs';
import { publicAssetPaths } from '../modules/deploy-kit/artifact.mjs';
import { migrate } from '../modules/container/migrations.mjs';
import { RerError } from './errors.mjs';

// Serve the production build the way rer deploy hosts it (assets behind the
// Worker, deploy identity bound, a public https origin) on loopback, with no
// network or account. The ingress hands the app the hosted URL and Host.
const ORIGIN = 'https://rer-hosted-check.invalid';
const ingress = `export default {fetch(request,env){const url=new URL(request.headers.get('x-rer-original-url')),headers=new Headers(request.headers);headers.delete('x-rer-original-url');headers.set('host',url.host);return env.APP.fetch(new Request(url,{method:request.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:request.body}:{})}))}}`;
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const optional = path => read(path).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });

async function files(root, directory = '') {
 const result = [];
 for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
  const path = directory ? `${directory}/${entry.name}` : entry.name;
  if (entry.isDirectory()) result.push(...await files(root, path)); else if (entry.isFile()) result.push(path);
 }
 return result.sort();
}
const moduleTypes = { '.js':'ESModule', '.mjs':'ESModule', '.cjs':'CommonJS', '.wasm':'CompiledWasm', '.bin':'Data', '.txt':'Text', '.html':'Text', '.sql':'Text' };

// The seed's own wrangler carries the Miniflare its preview already runs.
async function miniflareFor(root) {
 const wrangler = createRequire(join(root, 'package.json')).resolve('wrangler/package.json');
 return import(pathToFileURL(createRequire(wrangler).resolve('miniflare')));
}

// Deploy binds its declared secrets. A secret item's verifyStandIn is the
// hosted-valid value this check uses (MAIL_PROVIDER: "resend" where the setup
// default "development" is refused once deployed); otherwise stand-ins follow
// the setup manifest's kind or default.
const standIn = (item, field) => typeof item.verifyStandIn === 'string' && item.verifyStandIn ? item.verifyStandIn : field?.kind === 'email' ? 'owner@example.com' : typeof field?.default === 'string' && field.default ? field.default : randomBytes(24).toString('hex');
const links = html => [...html.matchAll(/(?:src|href)=["'](\/[^"'#?\s]+)/g)].map(match => match[1].slice(1)).filter(path => !path.startsWith('/') && /\.[A-Za-z0-9]+$/.test(path));

/** The build served as rer deploy hosts it, with the vars, origin and (stand-in) secrets of its
 * deploy declaration. `fetch(path, init)` answers for the deployed origin. */
export async function serveHosted(root, { declaration: declarationPath = 'deploy.json' } = {}) {
 const build = join(root, 'dist/server'), client = join(root, 'dist/client');
 let config;
 try { config = await read(join(build, 'wrangler.json')); }
 catch { throw new RerError('hosted_output_missing', 'No production build at dist/server/wrangler.json. Run rer build, then rer verify.', 1); }
 let declaration;
 try { declaration = await read(join(root, declarationPath)); }
 catch { throw new RerError('hosted_output_missing', `No readable deploy declaration at ${declarationPath}. A seed whose deploy reads another file names it with the commandAdapter option deployDeclaration.`, 1); }
 const manifest = await optional(join(root, 'rer-setup.json'));
 const { Miniflare, convertV4MiniflareOptions = options => options } = await miniflareFor(root);
 const entry = join(build, config.main);
 const modules = [entry, ...(await files(build)).map(path => join(build, path)).filter(path => path !== entry && moduleTypes[extname(path)])].map(path => ({ type: moduleTypes[extname(path)], path }));
 const identity = { sourceSha: createHash('sha1').update(randomBytes(16)).digest('hex'), fingerprint: createHash('sha256').update(randomBytes(16)).digest('hex'), versionId: crypto.randomUUID() };
 const secrets = Object.fromEntries((declaration.secrets ?? []).map(item => [item.binding, standIn(item, manifest.fields?.find(field => field.name === item.binding))]));
 const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false, workers: [{ name: 'ingress', modules: true, script: ingress, serviceBindings: { APP: 'app' } }, {
  name: 'app', modules, modulesRoot: build, compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { ...config.vars, ...declaration.vars, ...secrets, ...(declaration.originVar ? { [declaration.originVar]: ORIGIN } : {}),
   RER_DEPLOY_SOURCE: identity.sourceSha, RER_DEPLOY_FINGERPRINT: identity.fingerprint, RER_VERSION: { id: identity.versionId, tag: '', timestamp: new Date().toISOString() } },
  d1Databases: Object.fromEntries((config.d1_databases ?? []).map(item => [item.binding, item.database_id ?? item.database_name])),
  r2Buckets: Object.fromEntries((config.r2_buckets ?? []).map(item => [item.binding, item.bucket_name])),
  kvNamespaces: Object.fromEntries((config.kv_namespaces ?? []).map(item => [item.binding, item.id ?? item.binding])),
  queueProducers: Object.fromEntries((config.queues?.producers ?? []).map(item => [item.binding, item.queue])),
  durableObjects: Object.fromEntries((config.durable_objects?.bindings ?? []).filter(item => !item.script_name).map(item => [item.name, { className: item.class_name, useSQLite: true }])),
  ...(config.assets ? { assets: { directory: client, binding: config.assets.binding ?? 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: RUN_WORKER_FIRST } } } : {}),
 }] }));
 let loopback;
 try {
  loopback = await mf.ready;
  const { unstable_splitSqlQuery: split } = createRequire(join(root, 'package.json'))('wrangler');
  for (const item of config.d1_databases ?? []) {
   const directory = resolve(build, item.migrations_dir ?? 'migrations'), plan = [];
   for (const name of (await readdir(directory).catch(() => [])).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(join(directory, name), 'utf8');
    plan.push({ name, sql, sha256: createHash('sha256').update(sql).digest('hex'), statements: split(sql) });
   }
   await migrate(await mf.getD1Database(item.binding, 'app'), plan);
  }
 } catch (error) { await mf.dispose(); throw error; }
 return { client, identity, origin: ORIGIN, close: () => mf.dispose(),
  fetch: (path, { headers, ...init } = {}) => fetch(loopback, { ...init, redirect: 'manual', headers: { ...headers, 'x-rer-original-url': `${ORIGIN}/${path}` } }) };
}

export async function checkHostedOutput(root, options) {
 const hosted = await serveHosted(root, options), { client, identity } = hosted, failures = [];
 try {
  const request = async path => { const response = await hosted.fetch(path); return { status: response.status, type: response.headers.get('content-type') ?? '', etag: response.headers.get('etag'), body: await response.text() }; };
  const built = await files(client).catch(() => []);
  const documents = await Promise.all(built.filter(path => extname(path) === '.html').map(path => readFile(join(client, path), 'utf8')));
  const home = await request('');
  if (home.status === 200 && home.type.includes('text/html')) documents.push(home.body);
  // Every built file answers 200 by its own path, built `.html` documents included.
  const html = built.filter(path => extname(path) === '.html' && !path.split('/').some(part => part.startsWith('.')));
  const paths = [...new Set([...[...publicAssetPaths(built), ...html].map(path => path.split('/').map(encodeURIComponent).join('/')), ...documents.flatMap(links)])];
  for (let i = 0; i < paths.length; i += 8) await Promise.all(paths.slice(i, i + 8).map(async path => {
   const answer = await request(path);
   if (answer.status !== 200) failures.push(`${answer.status} /${path}`);
   // A browser revisits a built .html with If-None-Match: it must answer 304, not the app's 404.
   else if (answer.etag && path.endsWith('.html')) {
    const again = await hosted.fetch(path, { headers: { 'if-none-match': answer.etag } }); await again.body?.cancel();
    if (again.status !== 304) failures.push(`${again.status} /${path} (If-None-Match)`);
   }
  }));
  failures.sort();
  const health = await request('health');
  let body; try { body = JSON.parse(health.body); } catch {}
  const deployment = body?.deployment ?? {};
  const wrong = health.status !== 200 ? [`HTTP ${health.status}`] : [...(body?.ok === true ? [] : ['ok']), ...['sourceSha', 'fingerprint', 'versionId'].filter(key => deployment[key] !== identity[key]).map(key => `deployment.${key}`)];
  if (wrong.length) failures.push(`/health lacks the deploy identity (${wrong.join(', ')}); it must answer {ok:true, deployment:{sourceSha, fingerprint, versionId}} from RER_DEPLOY_SOURCE, RER_DEPLOY_FINGERPRINT and RER_VERSION.id`);
  if (failures.length) throw new RerError('hosted_output_failed', `The production build would break when hosted: rer deploy runs the Worker before static assets (run_worker_first), and served this way:\n  ${failures.join('\n  ')}\nServe built files with staticAssetResponse and answer /health with deploymentHealth (SEED-COMMAND-CONTRACT.md, Hosted assets and deploy identity).`, 1, { failures });
  return { assets: paths.length, health: 'identity' };
 } finally { await hosted.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try { console.log(JSON.stringify(await checkHostedOutput(resolve(process.argv[2] ?? '.'), { declaration: process.argv[3] }))); }
 catch (error) { console.error(error.message); process.exitCode = 1; }
}
