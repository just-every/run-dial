import { constants } from 'node:fs';
import { open, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { privateFile } from '@runeditrun/rer/modules/portability/cli-options';
// Hold a private immutable copy before validation; a caller replacing or editing
// the original archive cannot change the records used during restoration.
export async function snapshotInput(path, root) {
 const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
 let directory;
 try {
  const before = await source.stat({ bigint: true });
  if (!before.isFile() || before.nlink !== 1n || (before.mode & 0o077n) !== 0n) throw Error('archive-input-not-private');
  directory = await mkdtemp(join(root, '.seed/installer/transfer-'));
  const target = join(directory, 'input.jsonl');
  const file = await privateFile(target);
  try {
   for await (const bytes of source.createReadStream({ autoClose: false })) await file.writeFile(bytes);
   await file.sync();
  } finally { await file.close(); }
  const after = await source.stat({ bigint: true });
  if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) throw Error('archive-input-changed');
  return { path: target, dispose: () => rm(dirname(target), { recursive: true, force: true }) };
 } catch (error) { if (directory) await rm(directory, { recursive: true, force: true }); throw error; }
 finally { await source.close(); }
}
