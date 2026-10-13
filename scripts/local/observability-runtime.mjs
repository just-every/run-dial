import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ownDiagnosticProcesses } from './observability-processes.mjs';

const ownership = ownDiagnosticProcesses();
try {
 await ownership.started;
 const [root, persistence, temporary] = process.argv.slice(2);
 if (!root || !persistence || !temporary) throw Error('Diagnostic maintenance requires explicit owned paths.');
 const require = createRequire(await realpath(resolve(root, 'node_modules/wrangler/package.json')));
 const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = require('miniflare');
 // No application source, credentials, bindings, shared registry or providers.
 // The SDK requires a utility Worker, which refuses every application request.
 // Shared-storage mode separates observability from D1/R2/KV: the latter and the
 // private registry live only in the parent's disposable maintenance directory.
 const runtime = new Miniflare({ ...convertV4MiniflareOptions({
  host: '127.0.0.1', port: 0, cf: false,
  resourcePersistencePath: resolve(temporary, 'resources'), isolatedResourcePersistencePath: persistence,
  unsafeDevRegistryPath: resolve(temporary, 'registry'),
  unsafeLocalExplorer: true, unsafeObservability: true, unsafeTriggerHandlers: false,
  telemetry: { enabled: false }, log: new Log(LogLevel.NONE),
  workers: [{ name: 'dial-local-diagnostic-retirement', modules: true,
   compatibilityDate: '2026-01-01', unsafeRegisterWorker: false,
   script: 'export default { fetch() { return new Response(null, { status: 404 }); } }',
  }],
 }), unsafeEnableSharedStorage: true });
 ownership.attach(runtime);

 async function api(origin, action, body) {
  const response = await fetch(new URL(`/cdn-cgi/local/explorer/api/local/observability/${action}`, origin), {
   method: 'POST', headers: { 'content-type': 'application/json' },
   ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw Error('SDK diagnostic retirement API failed.');
  const result = await response.json();
  if (result.success !== true) throw Error('SDK diagnostic retirement was not acknowledged.');
  return result.result;
 }
 const origin = await runtime.ready;
 if (origin.hostname !== '127.0.0.1') throw Error('SDK diagnostic retirement is not loopback-only.');
 const cleared = await api(origin, 'clear');
 if (cleared?.success !== true) throw Error('SDK diagnostic retirement was not completed.');
 const result = await api(origin, 'query', { sql: 'SELECT (SELECT COUNT(*) FROM spans) AS spans, (SELECT COUNT(*) FROM logs) AS logs' });
 if (result?.columns?.join(',') !== 'spans,logs' || result.rows?.length !== 1 || result.rows[0]?.length !== 2 || result.rows[0].some(count => count !== 0)) throw Error('SDK diagnostic rows remain after retirement.');
 await ownership.complete();
} catch { ownership.fail(); }
