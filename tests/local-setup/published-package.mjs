import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

async function inventory(root) {
 const files = [];
 async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
   const path = join(directory, entry.name);
   if (entry.isDirectory()) await walk(path);
   else { assert.ok(entry.isFile(), 'published package has only regular files'); files.push([relative(root, path), createHash('sha256').update(await readFile(path)).digest('hex')]); }
  }
 }
 await walk(root); return files.sort(([a], [b]) => a.localeCompare(b));
}
// Explicit qualification uses independently downloaded npm bytes. Calling the
// global launcher would silently delegate to the checkout's patched package.
export async function publishedPackage() {
 const entry = process.env.DIAL_PUBLISHED_RER_ENTRY;
 if (!entry) return undefined;
 const root = await realpath(resolve(dirname(entry), '..'));
 assert.equal(await realpath(entry), join(root, 'bin/rer.mjs'), 'execute the published dispatcher directly');
 const installed = await realpath(new URL('../../node_modules/@runeditrun/rer', import.meta.url));
 assert.notEqual(root, installed, 'published proof uses an independent package');
 const registry = JSON.parse(await readFile(process.env.DIAL_PUBLISHED_RER_MANIFEST, 'utf8'));
 const tarball = await readFile(process.env.DIAL_PUBLISHED_RER_TARBALL);
 const integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64');
 assert.equal(integrity, registry.dist.integrity, 'download matches npm registry integrity');
 const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
 const project = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
 assert.equal(pkg.name, registry.name); assert.equal(pkg.version, registry.version);
 assert.equal(pkg.version, project.devDependencies[pkg.name], 'published package matches declared CLI pin');
 const scratch = await mkdtemp(join(tmpdir(), 'dial-published-bytes-'));
 try {
  execFileSync('tar', ['-xzf', process.env.DIAL_PUBLISHED_RER_TARBALL, '-C', scratch], { stdio: 'pipe' });
  const actual = await inventory(root);
  assert.deepEqual(actual, await inventory(join(scratch, 'package')), 'executed package is byte-for-byte the unpatched npm tarball');
  return { entry: join(root, 'bin/rer.mjs'), receipt: { publishedCliExecuted: true, publishedPackage: pkg.name, publishedVersion: pkg.version, publishedIntegrity: integrity, publishedContentsSha256: createHash('sha256').update(JSON.stringify(actual)).digest('hex'), publishedDirectDispatcher: true } };
 } finally { await rm(scratch, { recursive: true, force: true }); }
}
