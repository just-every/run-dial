import { lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const LOCAL_MODELS_FILE = '.rer/local/models.json';
/** Refuse presence, including symlinks: never read this key to build a plan. */
export async function refuseLocalModels(root) {
  try { await lstat(join(root, LOCAL_MODELS_FILE)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('local-only-models-file');
}

/** A local settings file: .dev.vars or .env with any suffix (.dev.vars.production,
 * .env.local), or a NAME.env file such as rer's own dev-key.env. */
export const localEnvFile = path => /(?:^|\/)(?:\.dev\.vars(?:\.[^/]*)?|\.env(?:\.[^/]*)?|[^/]+\.env)$/.test(path);

/** Refuse build output that holds a local settings file, by presence alone: the
 * Cloudflare Vite plugin copies .dev.vars into dist/<worker>/ for preview, and a
 * deployment never carries one. The error names the first file, relative to root;
 * its contents are never read. */
export async function refuseLocalEnvFiles(root, directories) {
  for (const directory of directories) {
    let entries;
    try { entries = await readdir(join(root, directory), { withFileTypes: true, recursive: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const found = entries.map(entry => relative(root, join(entry.parentPath, entry.name)).split('\\').join('/')).filter(localEnvFile).sort()[0];
    if (found) throw Object.assign(new Error('local-env-file-in-build-output'), { resource: found });
  }
}
