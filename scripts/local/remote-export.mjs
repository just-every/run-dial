import { readFile, unlink, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { main as transferClient } from '../base-cli/modules/portability/cli.mjs';
import { readArchive } from '../base-cli/modules/portability/index.mjs';
// The published authenticated HTTP client owns transport, record verification,
// private output and atomic promotion. Dial cleans its completed source snapshot.
export async function remoteExport(origin, sessionFile, path) {
 if (!sessionFile || !origin) throw Error('remote-credentials-required');
 if ((await lstat(sessionFile)).mode & 0o077) throw Error('private-session-file-required');
 let manifest, closing;
 try {
  await transferClient(['export', '--origin', origin, '--session-file', sessionFile, '--out', path]);
  for await (const record of readArchive(Readable.toWeb(createReadStream(path)))) {
   if (record.kind === 'manifest') manifest = record;
   if (record.kind === 'closing') closing = record;
  }
  return { target: 'remote', contentHash: closing.contentHash, tables: manifest.tables.map(({name,count}) => ({name,count})), objects: manifest.objects.length, exclusions: manifest.excludedTables, requiredConfiguration: manifest.requiredConfiguration };
 } finally {
  const checkpoint = await readFile(path + '.transfer.json', 'utf8').then(JSON.parse).catch(() => null);
  if (checkpoint) {
   try {
    await transferClient(['abort', '--origin', origin, '--session-file', sessionFile, '--resume', checkpoint.id]);
    await unlink(path + '.transfer.json');
   } catch { process.stderr.write('Source cleanup was not confirmed; maintenance expires after five minutes. Keep the private job checkpoint for cleanup.\n'); }
  }
 }
}
try { console.log(JSON.stringify({ok: true, ...await remoteExport(process.argv[2], process.argv[3], process.argv[4])})); }
catch { console.log(JSON.stringify({ok: false, reason: 'hosted-export-refused', exitCode: 4})); process.exitCode = 1; }
