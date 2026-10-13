// Package mode: a first-party checkout that pins the @runeditrun/rer package as
// an exact devDependency instead of carrying a vendored copy (scripts/rer.mjs,
// scripts/base-cli and scripts/base-onboarding). Its commands run `rer VERB`
// from node_modules/.bin, and its adapter imports the package's exports.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const packageName = '@runeditrun/rer';
export const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const vendoredPaths = ['scripts/rer.mjs', 'scripts/base-cli', 'scripts/base-onboarding'];

// The specifier a package.json declares for the package, if any.
export const declaredPackage = pkg => pkg?.devDependencies?.[packageName] ?? pkg?.dependencies?.[packageName];

// What a verb's OPERATIONS argv and package script are in each mode
// (a null verb is the bare `rer` alias).
export const commandArgv = (verb, packaged) => packaged ? ['rer', ...(verb ? [verb] : [])] : ['node', 'scripts/rer.mjs', ...(verb ? [verb] : [])];
export const commandLine = (verb, packaged) => commandArgv(verb, packaged).join(' ');

// The importer entry pnpm-lock.yaml holds for the package: { group,
// specifier, version, locked } (locked: the packages section resolves that
// version with a sha512 integrity), or undefined. pnpm writes lockfile
// version 9 in a fixed layout, which this reads line by line.
export async function lockedPackage(root) {
 let text;
 try { text = await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8'); } catch { return undefined; }
 const lines = text.split('\n'), indent = line => line.length - line.trimStart().length;
 // The lines under a key at a given indentation, up to the next line at or above it.
 const block = (from, to, key, depth) => {
  const start = lines.findIndex((line, index) => index >= from && index < to && indent(line) === depth && line.trim() === key);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < to && (!lines[end].trim() || indent(lines[end]) > depth)) end++;
  return [start + 1, end];
 };
 const importers = block(0, lines.length, 'importers:', 0), own = importers && block(...importers, '.:', 2);
 if (!own) return undefined;
 for (const group of ['devDependencies', 'dependencies']) {
  const entries = block(...own, `${group}:`, 4), entry = entries && block(...entries, `'${packageName}':`, 6);
  if (!entry) continue;
  const fields = Object.fromEntries(lines.slice(...entry).map(line => /^\s+(specifier|version):\s*'?([^'\s]*)'?\s*$/.exec(line)).filter(Boolean).map(match => [match[1], match[2]]));
  const packages = block(0, lines.length, 'packages:', 0), resolved = packages && block(...packages, `'${packageName}@${fields.version}':`, 2);
  return { group, specifier: fields.specifier, version: fields.version, locked: Boolean(resolved && lines.slice(...resolved).some(line => /^\s+resolution: \{integrity: sha512-/.test(line))) };
 }
 return undefined;
}
