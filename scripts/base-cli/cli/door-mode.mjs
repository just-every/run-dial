// Door mode for one checkout: its saved origin is http://NAME.localhost:PORT,
// it serves on 127.0.0.1:<OS-assigned port> behind the machine's front door,
// and its probes go straight to that port (never through the door). A saved
// 127.0.0.1 origin keeps direct mode; --port and --host always serve directly.
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { claimSiteName, doorHost, doorOrigin, doorProtocol, doorSecretHeader, doorSite, readDoorState, runningDoor, verifyDoor } from './door.mjs';
import { refuse } from './errors.mjs';
import { firstFreePort } from './port.mjs';
import { localSettingKeys } from './settings.mjs';
import { shared } from './shared.mjs';

const moveRecord = '.rer/local/door-move.json';

// The enabled door this checkout can use, or a refusal saying why not.
export async function enabledDoor(env = process.env) {
 const state = await readDoorState(env);
 if (!state?.door?.enabled) throw refuse(`The front door is not enabled on this computer (${state?.directory ?? 'RER_DOOR_DIR'}). Enable it with rer door enable, or serve directly with rer dev --direct.`);
 const running = await runningDoor(env);
 const protocol = running?.protocol ?? state.door.protocol;
 if (protocol !== doorProtocol) throw refuse(`The front door speaks protocol ${protocol}, which this checkout's rer (protocol ${doorProtocol}) does not know. Run rer door restart with the installed rer.`);
 return state.door;
}

// The listening side of a door origin: 127.0.0.1 on a port the OS assigns,
// guarded by a secret chosen for this start.
export function doorSelection(name, port, fields) {
 return { ...fields, url: doorOrigin(name, port), host: '127.0.0.1', port: 0, explicitPort: false, door: { name, port, host: doorHost(name, port), header: doorSecretHeader, secret: randomBytes(32).toString('base64url') } };
}

// Selection for a checkout whose saved origin is a door origin, or that asks
// for the door (--door on a fresh setup). Returns undefined for direct mode.
export async function selectDoor(project, options, previous, fields) {
 if (options.port !== undefined || options.host !== undefined || options.direct) return undefined;
 const saved = previous && doorSite(previous.origin);
 if (saved) {
  // A server or setup on a saved origin re-claims the name it names
  // (registering a checkout that rer door remove unregistered) and never
  // serves under a name another checkout holds.
  await enabledDoor();
  if (['dev', 'preview', 'setup'].includes(options.verb)) await claimSavedName(project, previous.origin);
  return doorSelection(saved.name, saved.port, fields);
 }
 if (!options.door) return undefined;
 if (previous) throw refuse('This checkout is already set up at ' + previous.origin + '. Move it to the front door with rer dev --door, which keeps its data.');
 const door = await enabledDoor(), name = await claimSiteName(process.env, project.root, { mode: 'door' });
 return doorSelection(name, door.port, fields);
}

// A server on a door origin holds the name that origin names: it registers it
// again after rer door remove, and refuses when another checkout holds it.
export async function claimSavedName(project, origin) {
 const site = doorSite(origin);
 if (site && (await readDoorState())?.door) await claimSiteName(process.env, project.root, { preferred: site.name, mode: 'door', exact: true });
}

// Record the server's door route on its registry entry and send rer's own
// requests for the origin straight to its proxy.
export async function announceDoorRoute(selected, proxy, registry) {
 const { routeOrigin } = await shared('app-fetch.mjs');
 routeOrigin(selected.url, { port: proxy.port, headers: { [doorSecretHeader]: selected.door.secret } });
 await registry?.update({ port: proxy.port, door: { v: doorProtocol, name: selected.door.name, port: selected.door.port, secret: selected.door.secret } });
}

// A running server's route, from its registry entry: only while its server
// process is alive and itself listens on the recorded proxy port, so nothing
// rer sends (a dev key among it) reaches a process that took that port later.
export async function routeRunning(record) {
 if (!record?.door) return;
 const { alive } = await import('../modules/job-queue/identity.mjs');
 const { listeners } = await shared('process-diagnostics.mjs');
 const live = await alive(record.owner).catch(() => false);
 const holds = live && (await listeners([record.owner.pid])).some(row => row.pid === record.owner.pid && row.names.some(name => /^(?:127\.0\.0\.1|\[?::ffff:127\.0\.0\.1\]?):(\d+)$/.exec(name)?.[1] === String(record.port)));
 if (!holds) throw refuse(`This checkout's server (PID ${record.owner?.pid}) is not serving on its recorded port 127.0.0.1:${record.port}, so nothing was sent to it. Stop it with rer dev --stop, then start it again with rer dev.`);
 const { routeOrigin } = await shared('app-fetch.mjs');
 routeOrigin(record.url, { port: record.port, headers: { [doorSecretHeader]: record.door.secret } });
}

// Before a dev key is printed for a door origin.
export async function verifyDoorFor(url) {
 const site = doorSite(url);
 if (site) await verifyDoor(process.env, site.port);
}

// The saved origin, read without changing anything (rer describe).
export async function savedOrigin(project) {
 const secrets = project.adapter?.hooks?.secrets;
 if (!secrets) return null;
 let text;
 try { text = await readFile(join(project.root, secrets.file ?? '.dev.vars'), 'utf8'); } catch { return null; }
 try {
  const values = (secrets.format ?? 'dotenv') === 'json' ? JSON.parse(text) : (await shared('local/environment.mjs')).localVariables(text);
  return typeof values?.[localSettingKeys(project).origin] === 'string' ? values[localSettingKeys(project).origin] : null;
 } catch { return null; }
}

// rer dev --door / --direct: rewrite only the saved origin, keeping the local
// database and state. --door records the direct origin it replaces; --direct
// restores it (or the first free port from 8787, or --port).
export async function moveCheckout(project, options, out, registry) {
 const secrets = project.adapter?.hooks?.secrets;
 if (!secrets) throw refuse('This checkout declares no saved origin, so it cannot move to or from the front door.');
 const { readSettings, replaceSavedOrigin } = await shared('adapter-settings.mjs');
 const key = localSettingKeys(project).origin, current = (await readSettings(project.root, secrets)).values[key];
 if (!current) throw refuse('This checkout is not set up yet. Run rer dev without --door or --direct; with the door enabled it is set up there.');
 const atDoor = Boolean(doorSite(current));
 if (options.door === atDoor) return;
 const running = await registry.existing(options.verb, { ...options, supplied: new Set() });
 if (running) throw refuse(`Stop this checkout's running server first (rer dev --stop), then move it.`);
 let target, record;
 const { privateDirectory, readPrivateFile, writePrivateFile } = await shared('private-files.mjs');
 if (options.door) {
  const door = await enabledDoor(), name = await claimSiteName(process.env, project.root, { mode: 'door' });
  target = doorOrigin(name, door.port);
  record = { previousOrigin: current, movedAt: new Date().toISOString() };
 } else {
  let previous;
  try { previous = JSON.parse(await readPrivateFile(join(project.root, moveRecord))).previousOrigin; } catch {}
  target = options.port !== undefined ? `http://127.0.0.1:${options.port}` : previous && !doorSite(previous) ? previous : `http://127.0.0.1:${await firstFreePort('127.0.0.1')}`;
  const site = doorSite(current);
  if (site && await readDoorState()) await claimSiteName(process.env, project.root, { preferred: site.name, mode: 'direct', origin: target });
 }
 const { localOperation } = await shared('local/operation.mjs');
 let operation;
 try { operation = await localOperation(project.root); } catch (error) { throw refuse(error.message); }
 try {
  await replaceSavedOrigin(project.root, secrets, target);
  if (record) { await privateDirectory(project.root, ['.rer', 'local']); await writePrivateFile(join(project.root, moveRecord), JSON.stringify(record) + '\n'); }
  else await rm(join(project.root, moveRecord), { force: true });
 } finally { await operation.release(); }
 const line = options.door ? `Moved this checkout from ${current} to ${target}, through the front door. Its data is kept; rer dev --direct moves it back.` : `Moved this checkout from ${current} back to ${target}. Its data is kept.`;
 if (options.json) out.event('moved', { from: current, to: target }); else out.human(line);
}
