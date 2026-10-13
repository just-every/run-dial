import { open, mkdir, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { readArchive } from './index.mjs';
export async function* fileRecords(path,reader=readArchive) {
 const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
 try { yield* reader(Readable.toWeb(file.createReadStream({ autoClose: false }))); }
 finally { await file.close(); }
}
function receipt(manifest, closing, transient) {
 return {
  contentHash: closing.contentHash,
  archiveHash: closing.archiveHash,
  tables: manifest.tables.map(({ name, count }) => ({ name, count })),
  objects: manifest.objects.length, payloads: manifest.payloads.length,
  exclusions: { tables: manifest.excludedTables, columns: manifest.excludedColumns, configuration: true, transient },
  requiredConfiguration: manifest.requiredConfiguration,
 };
}
export async function exportArchive(service, path, transient) {
 let id, temporary, file;
 try {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  temporary = path + '.' + randomUUID() + '.partial';
  file = await open(temporary, 'wx', 0o600);
  id = await service.exports.create();
  while ((await service.exports.advance(id, { maxParts: 16 })).phase === 'building') {}
  const reader = (await service.exports.download(id)).getReader();
  try {
   for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    let offset = 0;
    while (offset < value.length) offset += (await file.write(value, offset)).bytesWritten;
   }
  } finally { await reader.cancel(); reader.releaseLock(); }
  await file.sync(); await file.close(); file = undefined;
  let manifest, closing;
  for await (const record of fileRecords(temporary)) { if (record.kind === 'manifest') manifest = record; if (record.kind === 'closing') closing = record; }
  await link(temporary, path);
  return receipt(manifest, closing, transient);
 } finally {
  await file?.close();
  if (temporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (id) await service.exports.abort(id);
 }
}
export async function importArchive(service, path, transient, journal) {
 let id, manifest, closing, complete = false;
 try {
  // Validate both complete archives before creating any restore state.
  let later;
  for (const file of [path, journal].filter(Boolean)) for await (const record of fileRecords(file)) {
   if (file === journal && record.kind === 'manifest') later = { sourceIdentity: record.sourceIdentity, epoch: record.epoch, journal: record.journal };
  }
  for await (const record of fileRecords(path)) {
   if (record.kind === 'manifest') { manifest = record; id = await service.imports.create(manifest); }
   else if (record.kind === 'part') await service.imports.uploadPart(id, record.index, record);
   else closing = record;
  }
  const status = await service.imports.finalize(id, { contentHash: closing.contentHash, archiveHash: closing.archiveHash, ...(later ? { laterJournal: later } : {}) }); complete = true;
  return { ...receipt(manifest, closing, transient), ...(status.bridged ? { bridged: status.bridged } : {}) };
 } finally { if (id && !complete) await service.imports.abort(id); }
}
