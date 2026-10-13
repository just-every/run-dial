import { lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { readArchive, PortabilityError } from '../modules/portability/index.mjs';
import { readLegacyArchive } from '../modules/portability/format.mjs';
import { fileRecords } from '../modules/portability/files.mjs';
import { RerError, refuse } from './errors.mjs';

// Seeds declare their real bindings and data policy. The shared module owns the
// archive format and atomic restore; the shared runner owns its native children.
export function localPortability({ database, binding = 'DB', buckets = {}, policy, transient = [] }) {
 async function run({ root, path, journal, store, signal, operationToken, platform, legacyRecovery }, direction) {
  if (direction === 'export') {
   if (await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw refuse('Export requires a new archive path.');
  }
  if(legacyRecovery && (!legacyRecovery.acknowledged || await lstat(legacyRecovery.output).catch(error=>{if(error.code==='ENOENT')return null;throw error;})))throw refuse('Legacy recovery requires acknowledgement and a new output archive path.');
  if (direction === 'import') {
   // Refuse damaged or unverifiable archives before migrations open the
   // destination database. Worker and finalization verify again before publish.
   try {
    for await (const record of fileRecords(path,legacyRecovery?readLegacyArchive:readArchive)) {}
    if(journal)for await(const record of fileRecords(journal)) {}
   }
   catch (error) {
    if (!(error instanceof PortabilityError)) throw error;
    const message = error.code === 'legacy_archive_unverifiable'
     ? 'Restore refused (legacy_archive_unverifiable): version 1 metadata cannot be authenticated. Upgrade the original installation and re-export, or use rer import --legacy-v1 --input FILE --yes --acknowledge-unverified-metadata --output exports/recovered-v2.rer in an empty installation. See modules/portability/README.md#backup-only-v1-recovery.'
     : `Restore refused (${error.code}): archive verification failed.`;
    const refused = error.status === 409;
    throw new RerError(refused ? 'restore_refused' : 'transfer_failed', message, refused ? 4 : 1);
   }
  }
  if(legacyRecovery)store.report('Legacy v1 recovery: manifest metadata is unverified. Restored data will be audited and exported to a new v2 backup.');
  if(platform==='container') return (await import('./container-transfer.mjs')).containerTransfer({root,path,journal,store,signal,direction,binding,buckets,policy,transient});
  const input={ root, path, journal, binding, buckets, policy, transient, legacyRecovery };
  // Do not apply pending product migrations to a populated recovery target.
  // Check real existing bindings first; finalize repeats this under the lock.
  if(legacyRecovery)await nativeWorker(store,'legacy-preflight',input,signal);
  await store.run('Applying local data migrations', 'pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', database, '--local', '--persist-to', '.wrangler/state', '--config', 'wrangler.jsonc'], {
   cwd: root, signal, env: { ...process.env, RER_LOCAL_OPERATION: operationToken, WRANGLER_SEND_METRICS: 'false' },
  });
  const receipt=await nativeWorker(store,direction,input,signal);
  if(legacyRecovery)receipt.output=relative(root,legacyRecovery.output);
  return { target: 'local', [direction === 'export' ? 'output' : 'input']: relative(root, path), ...receipt };
 }
 return { legacyRecovery:true, export: context => run(context, 'export'), import: context => run(context, 'import') };
}

async function nativeWorker(store,direction,input,signal) {
  const worker = fileURLToPath(new URL('./portability-worker.mjs', import.meta.url));
  const child = store.spawn(`${direction === 'legacy-preflight' ? 'Checking empty recovery destination' : direction === 'export' ? 'Exporting' : 'Restoring'} local installation data`, process.execPath,
   [worker, direction, JSON.stringify(input)], { cwd: input.root, signal, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  await new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  await store.stop(child);
  const status = await closed;
  let receipt; try { receipt = JSON.parse(output.trim().split('\n').at(-1)); } catch { throw new RerError('transfer_failed', 'Local portability did not return a complete receipt.', 1); }
  if (status.code !== 0 || !receipt.ok) throw new RerError(receipt.code ?? 'transfer_failed', receipt.reason==='legacy_restored_export_failed'
   ? 'Legacy data was restored and audited, but its v2 export failed. Preserve this installation, resolve the output problem, then run rer export --output FILE. Do not reset it to retry recovery.'
   : receipt.migration ? `Restore refused (schema_mismatch:migration_data): migration ${receipt.migration} changed data after this archive was made, so its rows would skip that change. Restore an archive made after it.`
   : `The portability module refused or failed the archive operation (${receipt.reason ?? 'incomplete'}).`, receipt.exitCode ?? 1);
  delete receipt.ok;
  return receipt;
}
