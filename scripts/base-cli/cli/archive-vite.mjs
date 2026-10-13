import { access, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve, isAbsolute, sep, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const inside = (parent, child) => { const path = relative(parent, child); return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep)); };
async function resolvedDirectory(directory) {
 const pending = [];
 for (;;) {
  const actual = await realpath(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (actual) return resolve(actual, ...pending);
  const status = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (status?.isSymbolicLink()) throw new Error('Configured served directory has an unresolved link.');
  pending.unshift(basename(directory)); directory = dirname(directory);
 }
}
function buildDirectories(config) {
 const builds = [config.build, ...Object.values(config.environments ?? {}).map(environment => environment.build)].filter(Boolean);
 return builds.flatMap(build => {
  const outputs = Array.isArray(build.rollupOptions?.output) ? build.rollupOptions.output : [build.rollupOptions?.output];
  return [build.outDir, ...outputs.filter(Boolean).flatMap(output => [output.dir, output.file && dirname(output.file)])];
 });
}
// Resolve the actual config, including plugin hooks and Vite's implicit
// filesystem allowance. Reading the file alone misses folders a plugin adds.
export async function viteServesArchive(root, destination) {
 const names = ['vite.config.ts','vite.config.mts','vite.config.js','vite.config.mjs','vite.config.cjs','vite.config.cts'];
 let configFile;
 for (const name of names) if (await access(join(root, name)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) { configFile = join(root, name); break; }
 if (!configFile) return false;
 const require = createRequire(join(root, 'package.json'));
 const { resolveConfig } = await import(pathToFileURL(require.resolve('vite')).href);
 for (const command of ['serve', 'build']) {
  const mode = command === 'build' ? 'production' : 'development';
  const previousNodeEnv = process.env.NODE_ENV, previousCloudflareBuild = process.env.CLOUDFLARE_VITE_BUILD;
  let config;
  try {
   process.env.NODE_ENV = previousNodeEnv ?? mode;
   config = await resolveConfig({ root, configFile, mode, logLevel: 'silent' }, command, mode, mode);
  } finally {
   if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
   if (previousCloudflareBuild === undefined) delete process.env.CLOUDFLARE_VITE_BUILD; else process.env.CLOUDFLARE_VITE_BUILD = previousCloudflareBuild;
  }
  const base = config.root;
  if (config.server?.fs?.strict === false) return true;
  const directories = [config.publicDir, ...buildDirectories(config), ...config.server.fs.allow].filter(path => typeof path === 'string');
  for (const name of directories) {
   // An uncreated output/public folder can still sit below /tmp or another
   // linked ancestor. Compare its future real location with the export path.
   const directory = await resolvedDirectory(resolve(base, name));
   if (inside(directory, destination)) return true;
  }
 }
 return false;
}
