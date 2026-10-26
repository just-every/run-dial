import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { testPartitions } from '../ci-test-files.mjs';

// Follow fixture imports and spawned script paths as well as test files. This
// keeps newly discovered browser tests from inheriting a stale matrix boolean.
const seen = new Set();
async function usesBrowser(file) {
  file = resolve(file);
  if (seen.has(file)) return false;
  seen.add(file);
  const source = await readFile(file, 'utf8');
  if (/@(?:playwright\/test|axe-core\/playwright)|\bchromium\b/.test(source)) return true;
  for (const [, reference] of source.matchAll(/['"]([^'"\n]+\.(?:mjs|cjs|js|ts|tsx))['"]/g)) {
    if (!reference.startsWith('.') && !reference.startsWith('scripts/') && !reference.startsWith('tests/')) continue;
    const target = resolve(reference.startsWith('.') ? dirname(file) : '.', reference);
    try { await access(target); }
    catch { continue; }
    if (await usesBrowser(target)) return true;
  }
  // Unknown computed script paths must not silently lose their browser setup.
  return /`[^`]*\$\{[^`]*\.(?:mjs|cjs|js)[^`]*`/.test(source);
}

const [group, selection, ...extra] = process.argv.slice(2);
const partitions = await testPartitions();
let files;
if (group === 'test' && /^\d+$/.test(selection ?? '')) files = partitions.shards[Number(selection)];
if (group === 'journeys') files = partitions.journeys[selection];
if (extra.length || (['static', 'build', 'editor'].includes(group) ? selection !== undefined : !files?.length)) {
  throw new Error('Expected a ci-verify.mjs partition');
}
let browser = group === 'build' || group === 'editor';
for (const file of files ?? []) browser ||= await usesBrowser(file);
console.log(`browser=${browser}`);
