import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runRer } from './runtime.mjs';

async function stateBytes(directory) {
 const files = ['.dev.vars'];
 for (const root of ['.wrangler/state', '.rer/local']) {
  const entries = await readdir(join(directory, root), { recursive: true, withFileTypes: true });
  for (const entry of entries) if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
 }
 return Object.fromEntries(await Promise.all(files.sort().map(async path => [path,
  createHash('sha256').update(await readFile(resolve(directory, path))).digest('hex')])));
}

// Exercise the public installed CLI against the stopped journey's real state.
export async function legacyResetRefusal(directory) {
 const before = await stateBytes(directory);
 for (const name of ['local-build', 'local-setup']) {
  const legacy = join(directory, '.wrangler', name);
  let createdDirectory = false, createdFile = false;
  try { await mkdir(legacy); createdDirectory = true; }
  catch (error) {
   if (error.code !== 'EEXIST') throw error;
   const info = await lstat(legacy);
   assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'existing legacy path is an ordinary directory');
   assert.deepEqual(await readdir(legacy), [], 'existing legacy directory is empty before the fixture');
  }
  const fixture = join(legacy, 'recovery.data');
  const contents = 'Synthetic retired-runtime recovery data';
  try {
   await writeFile(fixture, contents, { flag: 'wx' }); createdFile = true;
   const output = await runRer(directory, ['reset', '--yes', '--cwd', directory], { expected: 4 });
   const events = output.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
   assert.equal(events.some(event => event.event === 'inventory'), false, 'legacy preflight refuses before reset inventory');
   assert.deepEqual(await stateBytes(directory), before, 'refused reset preserves private settings and local application state');
   assert.equal(await readFile(fixture, 'utf8'), contents, 'legacy recovery data remains intact');
  } finally {
   if (createdFile) await unlink(fixture);
   if (createdDirectory) await rmdir(legacy);
  }
 }
}
