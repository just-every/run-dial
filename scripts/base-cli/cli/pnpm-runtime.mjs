import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import { missing } from './errors.mjs';
import { shellQuote } from './node-runtime-cache.mjs';

// The project's pinned pnpm, provided the way rer provides its pinned Node:
// fetched once from the npm registry, its tarball checked against the
// registry's sha512 integrity before anything is extracted or run, and kept in
// rer's own cache (~/.rer/pnpm/pnpm-VERSION). Only rer's own commands for the
// project put it on their PATH; nothing global changes, and it is used only
// when the person's PATH has no pnpm of the pinned version.
export const pnpmCache = () => join(homedir(), '.rer', 'pnpm');
const directoryOf = version => join(pnpmCache(), `pnpm-${version}`);
const shim = version => join(directoryOf(version), 'shim');
const receipt = version => join(directoryOf(version), '.rer-verified.json');
const entry = version => join(directoryOf(version), 'bin', 'pnpm.cjs');

async function digest(path, algorithm, encoding) {
 const hash = createHash(algorithm);
 for await (const chunk of createReadStream(path)) hash.update(chunk);
 return hash.digest(encoding);
}
async function owned(path, directory) {
 const stat = await lstat(path);
 if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o022)) throw Error('Unsafe pnpm cache placement.');
}
async function prepareCache() {
 for (const path of [join(homedir(), '.rer'), pnpmCache()]) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  try { await owned(path, true); } catch { throw missing(`The pnpm cache directory must be an owned, non-linked directory without group/other write access: ${path}. Correct its placement and permissions before retrying.`); }
 }
 return pnpmCache();
}

/** The verified cached pnpm's PATH directory, or undefined when none is cached. */
export async function cachedPnpm(version) {
 try { await lstat(directoryOf(version)); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
 try {
  for (const path of [join(homedir(), '.rer'), pnpmCache(), directoryOf(version), shim(version)]) await owned(path, true);
  for (const path of [receipt(version), entry(version), join(shim(version), 'pnpm')]) await owned(path, false);
  const record = JSON.parse(await readFile(receipt(version), 'utf8'));
  if (record.version !== version || !/^sha512-/.test(record.integrity) || record.entrySha256 !== await digest(entry(version), 'sha256', 'hex')) throw Error('pnpm cache integrity mismatch.');
  return shim(version);
 } catch {
  throw missing(`The cached pnpm is unsafe or incomplete. Preserve it for inspection with: mv ${shellQuote(directoryOf(version))} ${shellQuote(directoryOf(version) + '.quarantine-' + Date.now())}. Then rerun the original rer command to fetch a verified release.`);
 }
}

async function download(url, destination, limit, signal) {
 const response = await fetch(url, { signal, redirect: 'error' });
 if (!response.ok || !response.body) throw Error('The pnpm release could not be downloaded.');
 let bytes = 0;
 const bounded = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; callback(bytes > limit ? Error('pnpm release download exceeds its size limit.') : null, chunk); } });
 await pipeline(response.body, bounded, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
}
function extract(archive, directory, signal) {
 const child = spawn('tar', ['-xzf', archive, '-C', directory], { stdio: 'ignore', signal });
 return new Promise((resolve, reject) => {
  let failure;
  child.once('error', error => { failure = error; });
  child.once('close', code => code === 0 && !failure ? resolve() : reject(failure ?? Error('Verified pnpm release extraction failed.')));
 });
}

/** Fetch, verify and cache pnpm VERSION; returns its PATH directory. `registry` is the npm registry origin. */
export async function downloadPnpm(version, cancellation, { registry = 'https://registry.npmjs.org' } = {}) {
 const cache = await prepareCache(), temporary = await mkdtemp(join(cache, '.download-'));
 const signal = AbortSignal.any([cancellation, AbortSignal.timeout(60000)].filter(Boolean));
 try {
  const metadata = join(temporary, 'release.json'), archive = join(temporary, 'pnpm.tgz');
  await download(`${registry}/pnpm/${version}`, metadata, 1024 * 1024, signal);
  const release = JSON.parse(await readFile(metadata, 'utf8'));
  const integrity = release?.dist?.integrity;
  if (release?.version !== version || typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) throw Error('The pnpm release integrity is missing.');
  await download(`${registry}/pnpm/-/pnpm-${version}.tgz`, archive, 64 * 1024 * 1024, signal);
  if (`sha512-${await digest(archive, 'sha512', 'base64')}` !== integrity) throw Error('pnpm release integrity verification failed; nothing was extracted or run.');
  // This is the first point at which any downloaded content can be run.
  await extract(archive, temporary, signal);
  const extracted = join(temporary, 'package');
  if (JSON.parse(await readFile(join(extracted, 'package.json'), 'utf8')).version !== version) throw Error('Verified pnpm release did not name the project pin.');
  await mkdir(join(extracted, 'shim'), { mode: 0o700 });
  // `node` is rer's own: the command puts its Node first on PATH beside this.
  await writeFile(join(extracted, 'shim', 'pnpm'), `#!/bin/sh\nexec node ${shellQuote(entry(version))} "$@"\n`, { mode: 0o700 });
  await writeFile(join(extracted, '.rer-verified.json'), JSON.stringify({ version, integrity, entrySha256: await digest(join(extracted, 'bin', 'pnpm.cjs'), 'sha256', 'hex') }) + '\n', { flag: 'wx', mode: 0o600 });
  await chmod(extracted, 0o700);
  try { await rename(extracted, directoryOf(version)); }
  catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !(await cachedPnpm(version))) throw error; }
  return shim(version);
 } finally { await rm(temporary, { recursive: true, force: true }); }
}
