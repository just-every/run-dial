import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { LOCAL_ONLY_KEYS } from './owner.mjs';

/** A deploy's private settings file: an owned 0600 regular file of KEY=VALUE lines
 * (blank lines and # comments allowed, one optional pair of double quotes). */
export async function readDeployEnvFile(root, envFile, localOnlyKeys = []) {
  const handle = await open(resolve(root, envFile), constants.O_RDONLY | constants.O_NOFOLLOW);
  let encoded;
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.nlink !== 1 || (status.mode & 0o077) !== 0 || (process.getuid && status.uid !== process.getuid())) throw new Error('Deploy env file must be an owned private regular file (0600)');
    encoded = await handle.readFile('utf8');
  } finally { await handle.close(); }
  const settings = {};
  for (const line of encoded.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error('Invalid deploy env file');
    if (Object.hasOwn(settings, match[1])) throw new Error('Repeated deploy env key');
    settings[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  const local = [...LOCAL_ONLY_KEYS, ...localOnlyKeys].find(key => Object.hasOwn(settings, key));
  if (local) throw new Error(`Local-only key ${local} is refused for deploy; remove it from the file`);
  return settings;
}
