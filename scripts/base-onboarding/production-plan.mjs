import {productionPlan,serializePlan} from './production-options.mjs';

// Short-lived: resolves the Worker's Miniflare options with Wrangler and writes
// them as JSON to stdout, a pipe only the starting runtime reads. The plan holds
// private settings, so it is never written to a file or an argument.
if(process.env.RER_ORIGIN_KEY && !/^[A-Z][A-Z0-9_]*$/.test(process.env.RER_ORIGIN_KEY))throw Error('Invalid local origin setting name');
const plan=await productionPlan(process.cwd(),process.env.RER_DEV_ORIGIN,Number(process.env.RER_RUNTIME_PORT),process.env.RER_RUNTIME_HOST);
await new Promise((done,fail)=>process.stdout.write(serializePlan(plan),error=>error?fail(error):done()));
