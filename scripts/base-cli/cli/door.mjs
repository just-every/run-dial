// The front door's protocol (version 1). The door itself lives in the global
// `rer` package, which bundles this file; each checkout's pinned copy reads the
// same state, so the two meet only here.
//
// RER_DOOR_DIR (default ~/.rer/door): a 0700 directory owned by this account,
// never a link, holding 0600 files:
//   state.json    door policy, recorded environment and the registered sites
//                 (and the names removed ones keep reserved)
//                 (written under the job queue's bakery lock)
//   token         the door's secret; it proves it holds it before rer prints a key
//   process.json  the running door: protocol, PID and start, port, addresses,
//                 version and version directory
// A checkout keeps its door identity in its own .rer/local/door-site.json
// ({id}, 0600); a registered site records the same id, so a moved or renamed
// checkout keeps its name (and with it its origin and sign-in).
// A checkout in door mode serves on 127.0.0.1:<proxyPort> and records
// `door: {v, name, port, secret}` on its server-registry entry (also 0600). Its
// proxy answers only its own Host carrying the per-start secret header, which
// only the door (and rer's own probes) add.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { identity } from '../modules/job-queue/identity.mjs';
import { processInfo } from '../modules/job-queue/processes.mjs';
import { transaction } from '../modules/job-queue/storage.mjs';
import { refuse } from './errors.mjs';
import { shared } from './shared.mjs';

export const doorProtocol = 1;
export const defaultDoorPort = 8700;
export const doorSecretHeader = 'x-rer-door-secret';
export const doorChallengeHeader = 'x-rer-door-challenge';
export const doorIdentityPath = '/__rer/door/identity';
export const doorDefaults = Object.freeze({ serverLimit: 10, idleSeconds: 43200 });

export const doorDirectory = (env = process.env) => resolve(env.RER_DOOR_DIR ?? join(userInfo().homedir, '.rer/door'));
export const doorOrigin = (name, port) => `http://${name}.localhost:${port}`;
export const doorHost = (name, port) => `${name}.localhost:${port}`;

// A checkout's name: the DNS-safe slug of its folder name.
export function siteSlug(path) {
 return basename(path).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 50).replace(/-+$/, '') || 'site';
}

// { name, port } when `origin` is exactly a saved front-door origin.
export function doorSite(origin) {
 let url; try { url = new URL(origin); } catch { return undefined; }
 const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.localhost$/.exec(url.hostname);
 if (!match || url.protocol !== 'http:' || !url.port || url.origin !== origin) return undefined;
 return { name: match[1], port: Number(url.port) };
}

async function ownedDirectory(directory, create) {
 if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
 let info;
 try { info = await lstat(directory); } catch (error) { if (error.code === 'ENOENT' && !create) return false; throw error; }
 if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid()) throw refuse(`The front door directory ${directory} is foreign or linked. Preserve it for inspection and choose an owned RER_DOOR_DIR.`);
 if (create) await chmod(directory, 0o700);
 return true;
}

// A 0600 file in the door directory, or undefined when it does not exist.
export async function readPrivate(path) {
 let info;
 try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
 if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid()) throw refuse(`${path} is foreign or linked. Preserve it for inspection.`);
 if ((info.mode & 0o077) !== 0) await chmod(path, 0o600);
 return readFile(path, 'utf8');
}

export async function writePrivate(path, text) {
 const existing = await readPrivate(path);
 if (existing !== undefined) await chmod(path, 0o600);
 await writeFile(path, text, { mode: 0o600 });
 await chmod(path, 0o600);
}

export async function prepareDoorDirectory(env = process.env) {
 const directory = doorDirectory(env);
 await ownedDirectory(directory, true);
 for (const name of ['locks', 'logs']) await ownedDirectory(join(directory, name), true);
 return directory;
}

// The recorded door, read-only: { directory, door, sites } or undefined.
// `sites` lists registered checkouts only, never a removed one's reservation.
export async function readDoorState(env = process.env) {
 const directory = doorDirectory(env);
 if (!await ownedDirectory(directory, false)) return undefined;
 const text = await readPrivate(join(directory, 'state.json'));
 if (text === undefined) return undefined;
 const state = JSON.parse(text);
 return state.door ? { directory, door: state.door, sites: (state.sites ?? []).filter(site => !site.removed) } : undefined;
}

// Change the door state under the lock. `action(state)` edits state.door and
// state.sites in place. (The lock's own file also keeps empty queue fields.)
export async function changeDoorState(env, action) {
 const directory = await prepareDoorDirectory(env);
 await readPrivate(join(directory, 'state.json'));
 const lifetime = await identity();
 try {
  return await transaction(directory, lifetime.info, async state => { state.sites ??= []; return action(state); });
 } finally { await lifetime.close(); }
}

export async function ensureToken(directory) {
 const path = join(directory, 'token');
 if (await readPrivate(path) === undefined) await writeFile(path, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
 return (await readPrivate(path)).trim();
}

// The proof names the loopback address it was asked on, so a process holding
// one address cannot relay a challenge to the door on the other.
export const doorProof = (token, challenge, address) => createHmac('sha256', token).update(`rer-door:${address}:${challenge}`).digest('hex');

// The running door's record, when its process is alive: { pid, start, port, ... }.
export async function runningDoor(env = process.env) {
 const directory = doorDirectory(env);
 if (!await ownedDirectory(directory, false)) return undefined;
 const text = await readPrivate(join(directory, 'process.json'));
 if (!text) return undefined;
 const record = JSON.parse(text), current = await processInfo(record.pid);
 return current && !current.zombie && current.start === record.start ? record : undefined;
}

// Names are unique and stable per checkout. `rer door remove` keeps a removed
// checkout's name reserved for it (`removed: true`), because its saved origin
// still names it: the door stops routing it, no other checkout can claim it,
// and that checkout's next rer dev or rer door add takes it back. A
// reservation ends only when its checkout folder no longer exists.
function releaseVanished(state) {
 state.sites = state.sites.filter(site => !site.removed || existsSync(site.checkout));
}

const identityFile = '.rer/local/door-site.json';
const newIdentity = () => randomBytes(16).toString('hex');

// The door identity a checkout folder holds, or undefined.
export function checkoutIdentity(root) {
 try { const id = JSON.parse(readFileSync(join(root, identityFile), 'utf8')).id; return /^[0-9a-f]{32}$/.test(id) ? id : undefined; } catch { return undefined; }
}

export async function saveCheckoutIdentity(root, id) {
 if (checkoutIdentity(root) === id) return;
 const { privateDirectory, writePrivateFile } = await shared('private-files.mjs');
 await privateDirectory(root, ['.rer', 'local']);
 await writePrivateFile(join(root, identityFile), JSON.stringify({ id }) + '\n');
}

// In a door state being changed: the checkout's entry, claiming a name when it
// has none (its slug, or `preferred`, with a numeric suffix when another
// checkout holds that name). A removed entry is registered again.
// `id` is the identity the checkout folder holds (undefined when it holds
// none). A checkout is found by its folder, or else by its identity: a
// registered checkout whose folder no longer holds that identity has moved,
// and its entry follows it to the new folder, name and all. A copy (whose
// identity the original folder still holds) is a checkout of its own and gets
// a new identity. An entry registered before checkouts kept an identity
// follows a checkout whose saved origin names it (`preferred`) once its own
// folder is gone. The caller saves `entry.id` in the checkout folder.
// `holder` names the checkout that holds `preferred` when it is not this one.
export function claimEntry(state, checkout, preferred, id) {
 releaseVanished(state);
 // By folder, unless that folder now holds another checkout's identity.
 let entry = state.sites.find(site => site.checkout === checkout && !(site.id && id && site.id !== id)), copy = false;
 if (!entry && id) {
  const prior = state.sites.find(site => site.id === id);
  if (prior && checkoutIdentity(prior.checkout) !== id) entry = Object.assign(prior, { checkout, movedAt: Date.now() });
  else copy = Boolean(prior);
 }
 if (!entry && preferred) {
  const named = state.sites.find(site => site.name === preferred && !site.id && !existsSync(site.checkout));
  if (named) entry = Object.assign(named, { checkout, movedAt: Date.now() });
 }
 if (entry) delete entry.removed;
 else {
  const taken = new Set(state.sites.map(site => site.name)), base = preferred ?? siteSlug(checkout);
  let name = base;
  for (let suffix = 2; taken.has(name); suffix++) name = `${base}-${suffix}`;
  entry = { name, checkout, addedAt: Date.now() };
  state.sites.push(entry);
 }
 entry.id ??= copy || !id ? newIdentity() : id;
 const holder = preferred && entry.name !== preferred ? state.sites.find(site => site.name === preferred) : undefined;
 return { entry, holder };
}

// A checkout's registered name, claiming one when it has none. `mode` (door or
// direct) and a direct `origin` are kept on the entry for listings while the
// checkout is stopped. With `exact` (a saved door origin, which names its
// host), the claim must give `preferred` itself: when another checkout holds
// it, or this checkout is registered under another name, nothing changes and
// rer refuses, so a name and its cookies never reach a second checkout.
export async function claimSiteName(env, checkout, { preferred, mode, origin, exact = false } = {}) {
 const describe = entry => { if (mode) entry.mode = mode; if (origin) entry.origin = origin; else if (mode === 'door') delete entry.origin; };
 const held = checkoutIdentity(checkout);
 const claimed = await changeDoorState(env, state => {
  const { entry, holder } = claimEntry(state, checkout, preferred, held);
  if (exact && entry.name !== preferred) throw refuse(holder
   ? `This checkout's saved origin names ${preferred}.localhost, which the front door has registered for another checkout (${holder.checkout}). Nothing was started and no sign-in link was printed. Give this checkout its own name: rer dev --direct, then rer dev --door.`
   : `This checkout's saved origin names ${preferred}.localhost, but the front door has it registered as ${entry.name}. Nothing was started and no sign-in link was printed. Move it again: rer dev --direct, then rer dev --door.`);
  describe(entry);
  return { name: entry.name, id: entry.id };
 });
 await saveCheckoutIdentity(checkout, claimed.id);
 return claimed.name;
}

const portOf = name => Number(/:(\d+)$/.exec(name)?.[1]);

async function challenge(host, port, token) {
 const { loopbackRequest } = await shared('app-fetch.mjs');
 const nonce = randomBytes(24).toString('hex');
 const reply = await loopbackRequest({ host, port, path: doorIdentityPath, headers: { host: `localhost:${port}`, [doorChallengeHeader]: nonce }, timeoutMs: 5000 });
 let answer; try { answer = JSON.parse(reply.body.toString('utf8')); } catch {}
 const expected = Buffer.from(doorProof(token, nonce, host)), given = Buffer.from(String(answer?.proof ?? ''));
 return reply.status === 200 && given.length === expected.length && timingSafeEqual(given, expected) ? answer : undefined;
}

// Before rer prints a dev key for a door origin on port `port`: every loopback
// listener on it must belong to the door PID recorded in its state, and the
// door must prove it holds the 0600 token on each address it serves. While
// `rer door restart` (or enable) replaces the door (`restarting` in its state,
// for at most restartWindowMs), a failed check is repeated until the new door
// passes it, so a start under way finishes against the new door.
export const restartWindowMs = 90_000;
export async function verifyDoor(env, port) {
 for (;;) {
  try { return await verifyOnce(env, port); }
  catch (error) {
   const since = (await readDoorState(env).catch(() => undefined))?.door?.restarting;
   if (!(Date.now() - since < restartWindowMs)) throw error;
   await delay(250);
  }
 }
}

async function verifyOnce(env, port) {
 const directory = doorDirectory(env), record = await runningDoor(env);
 const { listeners, processName } = await shared('process-diagnostics.mjs');
 const holders = (await listeners()).filter(row => row.names.some(name => portOf(name) === port));
 const foreign = holders.find(row => row.pid !== record?.pid);
 const withheld = 'No sign-in link was printed.';
 if (foreign) throw refuse(`Port ${port} is held by PID ${foreign.pid} (${await processName(foreign.pid)}), which is not this account's front door${record ? ` (PID ${record.pid})` : ''}. ${withheld} Stop PID ${foreign.pid}, then run rer door restart.`);
 if (!record || record.port !== port) throw refuse(`The front door is not running on port ${port}. ${withheld} Start it with rer door start, then run this again.`);
 const token = (await readPrivate(join(directory, 'token')))?.trim();
 if (!token) throw refuse(`The front door's token is missing from ${directory}. ${withheld} Run rer door restart.`);
 for (const host of ['127.0.0.1', '::1']) {
  let answer;
  try { answer = await challenge(host, port, token); }
  catch (error) {
   // No IPv6 loopback, or nothing on [::1]:P while the door serves only 127.0.0.1.
   if (host === '::1' && ['ECONNREFUSED', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ENETUNREACH'].includes(error.code) && !record.addresses?.includes('::1')) continue;
   throw refuse(`The front door (PID ${record.pid}) did not answer on ${host === '::1' ? '[::1]' : host}:${port}: ${error.code ?? error.message}. ${withheld} Run rer door restart.`);
  }
  if (!answer || answer.pid !== record.pid) throw refuse(`Something other than this account's front door (PID ${record.pid}) answers on ${host === '::1' ? '[::1]' : host}:${port}. ${withheld} Find and stop it, then run rer door restart.`);
 }
 return record;
}
