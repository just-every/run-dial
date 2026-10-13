import { portabilityPlan, ensurePortabilitySchema } from '../modules/container/portability-schema.mjs';
import { exportArchive, importArchive, fileRecords } from '../modules/portability/files.mjs';
import { readLegacyArchive } from '../modules/portability/format.mjs';
import { recoverLegacyArchive } from '../modules/portability/legacy-files.mjs';
import { legacyEmptyTables, requireLegacyEmpty } from '../modules/portability/legacy-safety.mjs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createPortability, readArchive, PortabilityError } from '../modules/portability/index.mjs';

async function run(direction, { root, path, binding, buckets, policy, transient, legacyRecovery }) {
 // Verify the entire input before opening bindings or acquiring an import lock.
 if (direction === 'import') for await (const record of fileRecords(path,legacyRecovery?readLegacyArchive:readArchive)) {}
 const { getPlatformProxy, unstable_splitSqlQuery } = createRequire(join(root, 'package.json'))('wrangler');
 // Unlike Wrangler's --persist-to base, the API takes the versioned directory.
 const proxy = await getPlatformProxy({ configPath: join(root, 'wrangler.jsonc'), persist: { path: join(root, '.wrangler/state/v3') }, remoteBindings: false });
 try {
  const options={ db: proxy.env[binding], buckets: Object.fromEntries(Object.entries(buckets).map(([name, binding]) => [name, proxy.env[binding]])), policy };
  if(direction==='legacy-preflight') {
   await requireLegacyEmpty(options,await legacyEmptyTables(options.db));
   return {checkedEmpty:true};
  }
  await ensurePortabilitySchema(proxy.env[binding], await portabilityPlan(unstable_splitSqlQuery));
  if(legacyRecovery)return await recoverLegacyArchive(options,path,legacyRecovery.output,transient,legacyRecovery.acknowledged);
  const service = await createPortability(options);
  return await (direction === 'export' ? exportArchive : importArchive)(service, path, transient);
 } finally { await proxy.dispose(); }
}

try { console.log(JSON.stringify({ ok: true, ...await run(process.argv[2], JSON.parse(process.argv[3])) })); }
catch (error) {
 const refusal = error instanceof PortabilityError && (error.status === 409 || ['wrong_product', 'schema_mismatch', 'table_inventory', 'configuration_inventory'].includes(error.code));
 const exitCode = error.message === 'archive_json' ? 2 : refusal || error.code === 'EEXIST' ? 4 : 1;
 // Report only symbolic codes; native database errors can contain private data.
 const reason = error instanceof PortabilityError ? error.code.split(':')[0] : /^[A-Z_]+$/.test(error.code ?? '') ? error.code : error.message === 'archive_json' ? 'archive_json' : 'native_error';
 console.log(JSON.stringify({ ok: false, code: exitCode === 2 ? 'invalid_archive' : exitCode === 4 ? 'restore_refused' : 'transfer_failed', reason, exitCode })); process.exitCode = exitCode;
}
