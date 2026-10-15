import { registerHooks } from 'node:module';

// Load the real Worker route with its build-time schema proof, without bundling
// a second copy of Base or replacing any HTTP handler, auth or database logic.
export async function hostedRoute(model) {
 const route = new URL('../../src/core/features/portability/routes.ts', import.meta.url).href;
 const hooks = registerHooks({
  resolve(specifier, context, next) {
   if (specifier === 'virtual:dial-archive-schema') return { url: 'dial-test:archive-schema', shortCircuit: true };
   return next(context.parentURL === route && specifier === './admission' ? './admission.ts' : specifier, context);
  },
  load(url, context, next) {
   if (url === 'dial-test:archive-schema') return { format: 'module', source: `export default ${JSON.stringify({ catalog: model.catalog, migrations: model.migrations })}`, shortCircuit: true };
   return next(url, context);
  },
 });
 try { return (await import(route)).hostedExport; } finally { hooks.deregister(); }
}
