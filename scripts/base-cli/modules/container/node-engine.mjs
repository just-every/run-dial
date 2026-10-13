import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { D1 } from './adapters/d1.mjs';
import { Jobs } from './adapters/jobs.mjs';
import { Objects } from './adapters/objects.mjs';
import { retainedCache } from './adapters/retained.mjs';
import { publicFetch } from './adapters/egress.mjs';
import { assets } from './assets.mjs';
import { ensurePortabilitySchema } from './portability-schema.mjs';
import { migrate } from './migrations.mjs';
export async function nodeEngine({ root, data, manifest, settings, edge }) {
 const platform = new DatabaseSync(join(data, 'platform.sqlite')); platform.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
 const env = { ...manifest.config.vars, ...settings, ASSETS: assets(join(root, 'dist/client')) }, databases = {}, queues = [];
 for (const [binding, plan] of Object.entries(manifest.migrations)) { const db = new D1(join(data, binding + '.sqlite')); databases[binding] = db; env[binding] = db; await migrate(db, plan); await ensurePortabilitySchema(db, manifest.portabilityMigrations); }
 const objects = {};
 for (const bucket of manifest.config.r2_buckets ?? []) { const store = new Objects(platform, join(data, 'objects'), bucket.binding); objects[bucket.binding] = store; env[bucket.binding] = store; }
 await Object.values(objects)[0]?.recover();
 for (const producer of manifest.config.queues?.producers ?? []) { const consumer = manifest.config.queues.consumers.find(item => item.queue === producer.queue); const jobs = new Jobs(platform, producer.queue, { maxRetries: consumer?.max_retries, batchSize: consumer?.max_batch_size }); env[producer.binding] = jobs; queues.push(jobs); }
 if (manifest.config.durable_objects?.bindings?.length) {
  for (const binding of manifest.config.durable_objects.bindings) { if (manifest.cacheContract !== 'lamp-retained-v1' || binding.class_name !== 'SnapshotCache') throw new Error('Unsupported Node binding'); env[binding.name] = retainedCache(platform); }
 }
 globalThis[Symbol.for('rer.container.bindings')] = env;
 const previousFetch = globalThis.fetch; globalThis.fetch = edge ? (input, init) => edge(new Request(input, init), publicFetch) : publicFetch;
 // Lamp uses its persistent retained contract; the optional Cache API is deliberately unsupported.
 globalThis.caches = { open: async () => { throw new Error('Cache API unavailable on container Node'); } };
 const app = (await import(pathToFileURL(join(root, manifest.entry)))).default;
 const pending = new Set(), execution = { waitUntil(promise) { pending.add(promise); promise.catch(() => console.error('Background effect failed')).finally(() => pending.delete(promise)); } };
 return { env, databases, objects, app, execution,
  async fetch(request) {
   if(['GET','HEAD'].includes(request.method)&&!manifest.config.assets?.run_worker_first){const response=await env.ASSETS.fetch(request);if(response.status!==404)return response;}
   return app.fetch(request,env,execution);
  },
  scheduled: event => app.scheduled?.(event, env, execution),
  async drain() { if (app.queue) for (const jobs of queues) await jobs.drain(app.queue.bind(app), env, execution); },
  dead: () => queues.reduce((sum, jobs) => sum + jobs.dead(), 0),
  async close() { await Promise.allSettled([...pending]); await Promise.all(Object.values(databases).map(db => db.close())); platform.close(); globalThis.fetch = previousFetch; },
 };
}
