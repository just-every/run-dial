import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, parse, sep, dirname, basename } from 'node:path';
import { contained } from './project.mjs';
import { refuse } from './errors.mjs';
import { viteServesArchive } from './archive-vite.mjs';

const message = 'Save the archive at a normalized path inside this checkout\'s exports/ (exports/x.rer, ./exports/x.rer or an absolute path there), or at an absolute path outside this checkout. Traversal (..), unsafe symlinks and paths served by the app are refused.';
export async function exportPath(root, file) {
 const checkout = await realpath(root);
 if ((!isAbsolute(file) && file.includes('\\')) || file.split(/[\\/]/).includes('..')) throw refuse(message);
 if (!isAbsolute(file)) {
  return insideExports(checkout, relative(checkout, resolve(checkout, file)));
 }
 let destination = resolve(file); const within = relative(checkout, destination);
 if (inside(within)) return insideExports(checkout, within);
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
  if (!name && !status.isSymbolicLink()) return insideExports(checkout, parts.slice(index + 1).join(sep));
  if (inside(name)) throw refuse(message);
  if (index === parts.length - 1 && status.isSymbolicLink()) throw refuse(message);
  current = actual;
  destination = resolve(current, ...parts.slice(index + 1));
 }
 await requireUnserved(checkout, destination); return destination;
}
const inside = path => !path || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
async function insideExports(checkout, path) {
 if (!path.startsWith('exports' + sep) || !inside(path)) throw refuse(message);
 const destination = await contained(checkout, path, { optional: true });
 await requireUnserved(checkout, destination); return destination;
}
async function requireUnserved(root, destination) {
 try { if (await viteServesArchive(root, destination)) throw Error('Served destination'); }
 catch { throw refuse(message); }
}
export async function importPath(root, file) {
 if (!isAbsolute(file)) return contained(root, file, { privateFile: true });
 const path = await exportPath(root, file);
 return contained(dirname(path), basename(path), { privateFile: true });
}
