import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, parse, sep, dirname, basename } from 'node:path';
import { contained } from './project.mjs';
import { refuse } from './errors.mjs';
import { viteServesArchive } from './archive-vite.mjs';

const message = 'Save the archive at a normalized path inside this checkout\'s exports/ (exports/x.rer, ./exports/x.rer or an absolute path there), or at an absolute path outside this checkout. Traversal (..), unsafe symlinks and paths served by the app are refused.';
// Static refusals (shape, location, links) run here and touch nothing. `unserved()` then asks the seed's
// real Vite configuration whether the app would serve the path; the caller runs it after prepareData, because
// that configuration may need a file only prepareData generates (a checkout that never built has none yet).
export async function locateExport(root, file) {
 const checkout = await realpath(root);
 const located = destination => ({ path: destination, unserved: () => requireUnserved(checkout, destination) });
 if ((!isAbsolute(file) && file.includes('\\')) || file.split(/[\\/]/).includes('..')) throw refuse(message);
 if (!isAbsolute(file)) {
  return located(await insideExports(checkout, relative(checkout, resolve(checkout, file))));
 }
 let destination = resolve(file); const within = relative(checkout, destination);
 if (inside(within)) return located(await insideExports(checkout, within));
 // Resolve existing ancestors, including platform temporary-directory aliases.
 // A link outside the checkout must not put the export back inside it.
 let current = parse(destination).root;
 const parts = destination.slice(current.length).split(sep);
 for (const [index, part] of parts.entries()) {
  current = resolve(current, part);
  const status = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!status) break;
  const actual = await realpath(current), name = relative(checkout, actual);
  // Parent aliases (such as macOS /var) can lead to the real checkout root.
  // Once there, validate the remaining path without resolving its symlinks.
  if (!name && !status.isSymbolicLink()) return located(await insideExports(checkout, parts.slice(index + 1).join(sep)));
  if (inside(name)) throw refuse(message);
  if (index === parts.length - 1 && status.isSymbolicLink()) throw refuse(message);
  current = actual;
  destination = resolve(current, ...parts.slice(index + 1));
 }
 return located(destination);
}
const inside = path => !path || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
async function insideExports(checkout, path) {
 if (!path.startsWith('exports' + sep) || !inside(path)) throw refuse(message);
 return contained(checkout, path, { optional: true });
}
async function requireUnserved(root, destination) {
 try { if (await viteServesArchive(root, destination)) throw Error('Served destination'); }
 catch { throw refuse(message); }
}
export async function locateImport(root, file) {
 if (!isAbsolute(file)) return { path: await contained(root, file, { privateFile: true }), unserved: async () => {} };
 const { path, unserved } = await locateExport(root, file);
 return { path: await contained(dirname(path), basename(path), { privateFile: true }), unserved };
}
