import { open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { createPortability, readArchive, PortabilityError } from '@runeditrun/rer/modules/portability';
import { absent, privateFile, promote } from '@runeditrun/rer/modules/portability/cli-options';
import { readSettings } from '@runeditrun/rer/adapter-settings';
import { snapshotInput } from './archive-input.mjs';
import { dialPolicy, guardedBucket } from './archive-policy.mjs';
import { restoreMigrations } from './migration-replay.mjs';
async function* records(path) {
 const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
 try { yield* readArchive(Readable.toWeb(file.createReadStream({ autoClose: false }))); }
 finally { await file.close(); }
}
async function moveArchive(direction, path, journal) {
 if (direction === 'export') await absent(path);
 else for (const file of [path,journal].filter(Boolean)) for await (const record of records(file)) { if (!record.kind) throw Error('archive-invalid-record'); }
 const { values: vars } = await readSettings(process.cwd(), { file: '.dev.vars' });
 const { getPlatformProxy } = await import('wrangler');
 const proxy = await getPlatformProxy({ configPath: resolve('wrangler.toml'), persist: { path: resolve('.wrangler/state/v3') }, remoteBindings: false });
 let service, id, complete = false, manifest, closing, temporaryOwned = false;
 const temporary = path + '.partial';
 try {
  const { policy, knownSecrets } = await dialPolicy(proxy.env.DB, vars);
  service = await createPortability({ db: proxy.env.DB, buckets: { FILES: guardedBucket(proxy.env.FILES, knownSecrets) }, policy, migrations: () => restoreMigrations(proxy.env.DB, policy) });
  if (direction === 'export') {
   const file = await privateFile(temporary); temporaryOwned = true;
   try {
    id = await service.exports.create();
    while ((await service.exports.advance(id, { maxParts: 16 })).phase === 'building') { /* Base advances its durable snapshot. */ }
    const reader = (await service.exports.download(id)).getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; await file.writeFile(value); } }
    finally { await reader.cancel(); reader.releaseLock(); }
    await file.sync();
   } finally { await file.close(); }
   for await (const record of records(temporary)) { if (record.kind === 'manifest') manifest = record; if (record.kind === 'closing') closing = record; }
   await promote(temporary, path); temporaryOwned = false; complete = true; // promote renames the file into place: nothing is left to remove
  } else {
   for await (const record of records(path)) {
    if (record.kind === 'manifest') { manifest = record; id = await service.imports.create(manifest); }
    else if (record.kind === 'part') await service.imports.uploadPart(id, record.index, record);
    else closing = record;
   }
   let laterJournal;
   if (journal) for await (const record of records(journal)) if (record.kind === 'manifest') laterJournal = { sourceIdentity: record.sourceIdentity, epoch: record.epoch, journal: record.journal };
   await service.imports.finalize(id, { contentHash: closing.contentHash, archiveHash: closing.archiveHash, ...(laterJournal ? { laterJournal } : {}) }); complete = true;
  }
  return { contentHash: closing.contentHash, tables: manifest.tables.map(({ name, count }) => ({ name, count })), objects: manifest.objects.length, exclusions: manifest.excludedTables, requiredConfiguration: manifest.requiredConfiguration };
 } finally {
  try { if (id) { if (direction === 'export') await service.exports.abort(id); else if (!complete) await service.imports.abort(id); } }
  finally { if (temporaryOwned) await unlink(temporary); await proxy.dispose(); }
 }
}
export async function transfer(direction, path, journal) {
 if (direction !== 'import') return moveArchive(direction, path);
 const snapshot = await snapshotInput(path, process.cwd());
 let later;
 try { later = journal ? await snapshotInput(journal, process.cwd()) : undefined; return await moveArchive(direction, snapshot.path, later?.path); }
 finally { await later?.dispose(); await snapshot.dispose(); }
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
 try { console.log(JSON.stringify({ ok: true, ...await transfer(process.argv[2], process.argv[3], process.argv[4]) })); }
 catch (error) {
  const reason = error instanceof PortabilityError ? error.code.split(':')[0] : /^archive-[a-z-]+$/.test(error.message) ? error.message : error.message === 'archive_json' ? 'archive_json' : error.code ?? 'native_error';
  console.log(JSON.stringify({ ok: false, reason, exitCode: reason === 'archive_json' || reason === 'archive_format' ? 2 : error instanceof PortabilityError || /^archive-|EEXIST/.test(reason) ? 4 : 1 })); process.exitCode = 1;
 }
}
