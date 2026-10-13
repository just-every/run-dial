import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { rootCertificates } from 'node:tls';
import { ensurePortabilitySchema } from './portability-schema.mjs';
import { migrate } from './migrations.mjs';
async function files(root) { const result = []; for (const item of await readdir(root, { withFileTypes: true })) { const path = join(root, item.name); if (item.isDirectory()) result.push(...await files(path)); else if (/\.(m?js)$/.test(item.name)) result.push(path); } return result; }
export async function workerEngine({ root, data, manifest, settings, edge }) {
 const config = manifest.config, directory = join(root, 'dist/server'), entry = join(root, manifest.entry);
 const modules = [entry, ...(await files(directory)).filter(path => path !== entry)].map(path => ({ type: 'ESModule', path }));
 const app = { name:'app', modules, modulesRoot:directory, compatibilityDate:config.compatibility_date, compatibilityFlags:config.compatibility_flags,
  bindings:{ ...config.vars, ...settings }, d1Databases:Object.fromEntries((config.d1_databases ?? []).map(item => [item.binding, item.database_name])),
  r2Buckets:Object.fromEntries((config.r2_buckets ?? []).map(item => [item.binding, item.bucket_name])),
  durableObjects:Object.fromEntries((config.durable_objects?.bindings ?? []).map(item => [item.name, { className:item.class_name, useSQLite:true }])),
  queueProducers:Object.fromEntries((config.queues?.producers ?? []).map(item => [item.binding, item.queue])),
  queueConsumers:Object.fromEntries((config.queues?.consumers ?? []).map(item => [item.queue, { maxBatchSize:item.max_batch_size, maxRetries:item.max_retries }])),
  assets:{ directory:join(root, 'dist/client'), binding:config.assets?.binding ?? 'ASSETS', routerConfig:{ has_user_worker:true }, run_worker_first:config.assets?.run_worker_first ?? false },
  outboundService: edge ? request => edge(request, request => mf.getWorker('egress').then(worker => worker.fetch(request))) : 'egress',
 };
 const mf = new Miniflare(convertV4MiniflareOptions({ host:'127.0.0.1',port:0,cf:false,resourcePersistencePath:data,unsafeLocalExplorer:false,
  workers:[{ name:'ingress',modules:true,script:`export default {fetch(request,env){const observed=request.headers.get('x-rer-original-url');if(!observed)return new Response(null,{status:400});const url=new URL(observed),headers=new Headers(request.headers);headers.delete('x-rer-original-url');headers.set('host',url.host);return env.APP.fetch(new Request(url,{method:request.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:request.body}:{})}))}}`,serviceBindings:{ APP:'app' } }, app,
   { name:'egress',modules:true,script:'export default {fetch(request,env){return env.NETWORK.fetch(request)}}',serviceBindings:{ NETWORK:{ network:{ allow:['public'],tlsOptions:{ trustBrowserCas:true,trustedCertificates:[...rootCertificates] } } } } }],
 }));
 await mf.ready; const databases = {}, objects = {};
 for (const [binding, plan] of Object.entries(manifest.migrations)) { const db = await mf.getD1Database(binding, 'app'); databases[binding] = db; await migrate(db, plan); await ensurePortabilitySchema(db, manifest.portabilityMigrations); }
 for (const bucket of config.r2_buckets ?? []) objects[bucket.binding] = await mf.getR2Bucket(bucket.binding, 'app');
 const worker = await mf.getWorker('app');
 return { mf, databases, objects, app:worker,
  fetch(request) { const headers = new Headers(request.headers); headers.set('x-rer-original-url', request.url); return mf.dispatchFetch(request.url, { method:request.method,headers,body:request.body,duplex:'half',redirect:'manual' }); },
  scheduled:event => worker.scheduled(event), async drain() {}, dead:() => 0, close:() => mf.dispose(),
 };
}
