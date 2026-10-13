import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalStateSafetyError } from '../base-onboarding/local/state.mjs';

// Pure preflight: old Dial wrappers could hide original credentials and state
// anywhere beneath these directories. Never infer safety from a filename.
export async function assertLegacyStateRecovered(root) {
 for (const name of ['local-build', 'local-setup']) {
  const path = join(root, '.wrangler', name);
  const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (info && (!info.isDirectory() || info.isSymbolicLink() || (await readdir(path)).length)) throw new LocalStateSafetyError(`Legacy ${name} state remains. Stop the old runtime and recover its original .dev.vars before removing the empty legacy directory; no data was changed.`);
 }
}
