import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { nodeCache } from './node-runtime-cache.mjs';
import { projectNodePin } from './node-runtime-discovery.mjs';

// Read-only warnings about disk this machine spends twice: Node releases and
// workerd binaries that checkouts pin differently, quarantine copies nothing
// cleaned up, and a checkout on a volume where pnpm cannot clone from its store.
// None of these stop anything, so they never change doctor's ok.
const MB = 1024 * 1024;

async function size(path) {
 const info = await stat(path).catch(() => undefined);
 if (!info) return 0;
 if (!info.isDirectory()) return info.size;
 let total = 0;
 for (const entry of await readdir(path).catch(() => [])) total += await size(join(path, entry));
 return total;
}

// Other checkouts this machine knows about: the ones with a dev or preview
// server registered right now.
async function runningCheckouts(env) {
 const directory = resolve(env.RER_SERVERS_DIR ?? join(homedir(), '.rer/servers'));
 let records;
 try { records = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).running ?? []; } catch { return []; }
 const found = [];
 for (const checkout of new Set(records.map(record => record.checkout))) {
  try { found.push(await realpath(checkout)); } catch {}
 }
 return found;
}

async function pins(root) {
 const read = async file => { try { return JSON.parse(await readFile(join(root, file), 'utf8')); } catch { return {}; } };
 const store = await readdir(join(root, 'node_modules/.pnpm')).catch(() => []);
 return {
  Node: await projectNodePin(root).catch(() => undefined),
  pnpm: (await read('package.json')).packageManager?.replace(/^pnpm@/, ''),
  workerd: [...new Set(store.filter(name => /^workerd@\d/.test(name)).map(name => name.slice('workerd@'.length).split('_')[0]))].sort().join(' and ') || undefined,
 };
}

const COSTS = { Node: 'about 125 MB for each extra release', pnpm: 'a separate pnpm download', workerd: 'about 125-145 MB for each extra version' };

export async function cacheWarnings(root, { env = process.env } = {}) {
 const warnings = [], here = await realpath(root), mine = await pins(here);
 const cache = nodeCache(), entries = (await readdir(cache).catch(() => [])).filter(name => /^node-v\d/.test(name));
 for (const name of entries.filter(name => name.includes('.quarantine-'))) {
  warnings.push(`${join(cache, name)} is a leftover quarantine copy of a Node release (${Math.round(await size(join(cache, name)) / MB)} MB). Delete it with: rm -r ${JSON.stringify(join(cache, name))}`);
 }
 const releases = entries.filter(name => !name.includes('.quarantine-')).map(name => name.slice(6).split('-')[0]);
 if (releases.length > 1 && mine.Node) warnings.push(`The Node cache ${cache} holds ${releases.length} releases (${releases.join(', ')}) and this checkout pins ${mine.Node}. Each release is about 125 MB; delete the ones no checkout pins.`);
 const homeDevice = (await stat(homedir())).dev, peers = (await runningCheckouts(env)).filter(path => path !== here);
 if ((await stat(here)).dev !== homeDevice) warnings.push(`This checkout is on another volume than your home folder, where rer keeps its Node cache and pnpm its package store. pnpm cannot clone packages across volumes, so this checkout copies them in full (0.4-0.9 GB instead of 0.02-0.17 GB). Move it to the same volume.`);
 for (const peer of peers) {
  const theirs = await pins(peer);
  for (const [name, value] of Object.entries(mine)) if (value && theirs[name] && value !== theirs[name]) warnings.push(`${peer} pins ${name} ${theirs[name]} and this checkout pins ${value}; every distinct pin keeps its own copy (${COSTS[name]}). Align them when you can.`);
  if ((await stat(peer)).dev !== (await stat(here)).dev) warnings.push(`${peer} is on another volume than this checkout, so the two cannot share pnpm's package store by cloning files.`);
 }
 return warnings;
}
