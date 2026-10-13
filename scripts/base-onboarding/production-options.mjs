import {createRequire} from 'node:module';
import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readSettings} from './adapter-settings.mjs';
import {productionModules} from './production-modules.mjs';

// The project's own Miniflare, found through its pinned Wrangler without
// loading Wrangler: serving needs only Miniflare, and loading Wrangler as well
// keeps tens of megabytes resident for the whole session.
export async function projectMiniflare(root){
 return createRequire(await realpath(resolve(root,'node_modules/wrangler/package.json')))('miniflare');
}

// Runs once, in a short-lived process (production-plan.mjs): the pinned Wrangler
// converter supplies real bindings/assets/migrations, and the result is plain
// data for the serving process to hand to Miniflare.
export async function productionPlan(root,origin,port,host='127.0.0.1'){
 const require=createRequire(await realpath(resolve(root,'node_modules/wrangler/package.json')));
 const {unstable_getMiniflareWorkerOptions,unstable_readConfig}=require('wrangler');
 const miniflare=require('miniflare');
 const config=unstable_readConfig({config:resolve(root,'dist/server/wrangler.json')});
 const selected=unstable_getMiniflareWorkerOptions(config);
 const vars=(await readSettings(root,{file:'.dev.vars'})).values;
 const {modulesRules,...workerOptions}=selected.workerOptions;
 const worker={...workerOptions,name:config.name,...await productionModules(selected.main,modulesRules,miniflare),
  bindings:{...workerOptions.bindings,...vars,[process.env.RER_ORIGIN_KEY ?? 'AUTH_ORIGIN']:origin,RER_DEV_ORIGIN:origin,...(process.env.RER_DEV_KEY?{RER_DEV_KEY:process.env.RER_DEV_KEY}:{})}};
 // No Local Explorer, and trigger handlers only when the project declares Cron Triggers and rer preview runs them (RER_RUNTIME_TRIGGERS):
 // rer's scheduler calls this internal loopback port, and the public proxy answers 404 for /cdn-cgi/*.
 return {host,port,unsafeTriggerHandlers:process.env.RER_RUNTIME_TRIGGERS==='1',unsafeLocalExplorer:false,workers:[worker,...selected.externalWorkers]};
}

// JSON drops functions and flattens buffers, patterns and maps without a word.
// A plan that would change on its way to the serving process is refused.
export function serializePlan(plan){
 return JSON.stringify(plan,function(key,value){
  const original=this[key],kind=typeof original==='object'&&original!==null?Object.getPrototypeOf(original)?.constructor?.name:typeof original;
  if(['function','bigint','symbol','Uint8Array','Buffer','ArrayBuffer','Map','Set','RegExp'].includes(kind))throw Error(`The Worker configuration holds a ${kind} at "${key}" that cannot be passed to the preview runtime.`);
  return value;
 });
}
