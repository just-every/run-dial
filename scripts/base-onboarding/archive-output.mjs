import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Stream output, including copied public assets: a renamed archive is still
// private. Never include its contents in an error or read it into one buffer.
async function hasManifest(file) {
 let tail = '', kind = false, format = false, header = '', depth = 0, quoted = false, escaped = false, reading = true, started = false;
 const manifest = text => { try { const value = JSON.parse(text); return value?.kind === 'manifest' && value.format === 'runeditrun-portability'; } catch { return false; } };
 for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
  // Parse the leading JSON object too, so escaped property names and pretty
  // printing cannot hide an otherwise valid portability manifest. The format
  // limits a manifest line to 24 MiB; never retain the archive's rows.
  if (reading) for (const character of chunk) {
   if (!started) { if (/\s/.test(character)) continue; if (character !== '{') { reading = false; break; } started = true; }
   header += character;
   if (header.length > 24 * 1024 * 1024) { reading = false; header = ''; break; }
   if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; }
   else if (character === '"') quoted = true;
   else if (character === '{') depth++;
   else if (character === '}' && --depth === 0) { if (manifest(header)) return true; reading = false; header = ''; break; }
  }
  const text = tail + chunk;
  kind ||= /"kind"\s*:\s*"manifest"/.test(text);
  format ||= /"format"\s*:\s*"runeditrun-portability"/.test(text);
  if (kind && format) return true;
  tail = text.slice(-256);
 }
 return false;
}
export async function assertArchiveFree(directory) {
 const status = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
 if (!status) return;
 if (status.isSymbolicLink()) throw new Error('Build output must not contain symbolic links.');
 if (status.isDirectory()) {
  for (const name of await readdir(directory)) await assertArchiveFree(join(directory, name));
 } else if (status.isFile() && (/\.rer(?:\.[\w-]+\.partial)?$/i.test(directory) || await hasManifest(directory))) {
  throw new Error('Build output contains an installation archive. Move archives to exports/ and build again.');
 }
}

// Runs after Vite copies publicDir and writes each client/Worker bundle, also
// for direct vite build and custom output directories.
export function archiveOutputGuard() {
 let root;
 return {
  name: 'rer:private-archives', apply: 'build', enforce: 'post',
  configResolved(config) { root = config.root; },
  writeBundle: { order: 'post', async handler(options) {
   if (options.dir) await assertArchiveFree(resolve(root, options.dir));
   else if (options.file) await assertArchiveFree(resolve(root, options.file));
  } },
 };
}
