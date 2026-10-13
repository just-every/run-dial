import { lstat, readdir, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { contained } from './project.mjs';
import { shared } from './shared.mjs';
import { origin, loopback } from './parse.mjs';
import { refuse } from './errors.mjs';
import { defaultPort, firstFreePort, busyPortMessage } from './port.mjs';
import { localSettingKeys } from './settings.mjs';
import { doorSite } from './door.mjs';
import { selectDoor } from './door-mode.mjs';

export async function selectedOrigin(project, options, { setup = false } = {}) {
 const { readSettings } = await shared('adapter-settings.mjs');
 const vars = project.adapter?.hooks?.secrets ? (await readSettings(project.root, project.adapter.hooks.secrets)).values : {};
 const { origin: originKey } = localSettingKeys(project);
 let previous;
 if (vars[originKey]) {
  try { previous = new URL(vars[originKey]); } catch { throw refuse('Saved origin is malformed. Restore private settings or use confirmed reset.'); }
  if (previous.origin !== vars[originKey] || previous.protocol !== 'http:' || !loopback(previous.hostname.replace(/^\[|\]$/g, ''))) throw refuse('Saved origin is unsafe. Restore private settings or use confirmed reset.');
 }
 // A front-door origin (saved, or --door on a fresh setup) serves through the door.
 const door = await selectDoor(project, options, previous, { vars, savedOrigin: previous?.origin });
 if (door) return door;
 const host = options.host ?? (previous && !doorSite(previous.origin) ? previous.hostname.replace(/^\[|\]$/g, '') : '127.0.0.1');
 const savedPort = previous && !doorSite(previous.origin) ? Number(previous.port || 80) : undefined;
 // A first setup with no port asked for takes the first free one, never a busy one.
 let port = options.port ?? savedPort, taken;
 if (port === undefined && setup) { port = await firstFreePort(host); taken = port !== defaultPort; }
 port ??= defaultPort;
 const url = origin(host, port);
 // Setup on a saved checkout moves it to another port; the host stays.
 let moved;
 if (setup && previous && previous.origin !== url) {
  if (previous.hostname.replace(/^\[|\]$/g, '') !== host) throw refuse('Setup origin conflicts with the saved installation. Reuse its origin or back up data and run rer reset --yes.');
  moved = { from: savedPort, to: port };
 }
 return { url, host, port, vars, savedOrigin: previous?.origin, moved, explicitPort: options.port !== undefined, ...(taken ? { skipped: defaultPort } : {}) };
}

export async function availablePort(host, port, { root, saved = false } = {}) {
 const socket = createServer();
 try { await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(port, host, resolve); }); }
 catch (error) {
  if (error.code !== 'EADDRINUSE') throw refuse(`Port ${port} cannot be used on ${host}: ${error.code ?? error.message}.`);
  throw refuse(await busyPortMessage({ port, host, root, saved }));
 }
 finally { if (socket.listening) await new Promise(resolve => socket.close(resolve)); }
 // A server on every address (*:port) lets a bind to 127.0.0.1 succeed.
 const { portListener } = await shared('process-diagnostics.mjs');
 if (await portListener(port, host)) throw refuse(await busyPortMessage({ port, host, root, saved }));
}

export {setupInput} from './setup-input.mjs';

export async function stateSafety(project) {
 const { selectLocalState } = await shared('local/state.mjs');
 try { await selectLocalState(project.root, project.adapter.state); }
 catch { throw refuse('Local state placement is unsafe or ambiguous. Preserve legacy state and recover it explicitly before retrying.'); }
}

async function safeTree(project, path) {
 const absolute = await contained(project.root, path, { optional: true });
 let status; try { status = await lstat(absolute); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
 if (status.isSymbolicLink() || (!status.isFile() && !status.isDirectory()) || (process.getuid && status.uid !== process.getuid()) || (status.isFile() && status.nlink !== 1)) throw refuse('Reset inventory contains unsafe or linked storage. Preserve it and resolve placement.');
 if (status.isDirectory()) for (const entry of await readdir(absolute)) await safeTree(project, relative(project.root, resolve(absolute, entry)));
 return absolute;
}

export async function reset(project, options, out) {
 await stateSafety(project);
 await refuseLegacyProcess(project,{reset:true});
 const { strandedOriginals } = await shared('local/recovery.mjs');
 if ((await strandedOriginals(project.root)).length) throw refuse('An interrupted build holds private settings. Run rer build to recover them before reviewing reset.');
 const declared = project.adapter.settings ?? [];
 for (const path of declared) if (!/^\.dev\.vars(?:\.previous)?$|^data\/[a-zA-Z0-9_-]+\.json$/.test(path)) throw refuse('Generated settings inventory is unsafe; declare specific private settings files.');
 const paths = [...new Set(['.wrangler/state', '.rer/local', '.seed/installer', ...declared])];
 const inventory = [];
 for (const path of paths) if (await safeTree(project, path)) inventory.push(path);
 if (options.json) out.event('inventory', { paths: inventory }); else out.human(`reset inventory: ${inventory.length ? inventory.join(', ') : '(empty)'}`);
 let confirmed = options.yes;
 if (!confirmed && !options.json && !options.nonInteractive && process.stdin.isTTY) {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try { confirmed = (await prompt.question('Remove exactly this local inventory? Type yes: ')) === 'yes'; } finally { prompt.close(); }
 }
 if (!confirmed) throw refuse('Reset requires explicit confirmation. Review the inventory, then pass --yes.');
 // The shared lock lives outside every removal path and remains held throughout.
 const { localOperation } = await shared('local/operation.mjs');
 let operation;
 try { operation = await localOperation(project.root); } catch (error) { throw refuse(error.message); }
 try {
  for (const path of inventory) { const absolute = await safeTree(project, path); if (absolute) await rm(absolute, { recursive: true, force: true }); }
 } finally { await operation.release(); }
 return { paths: inventory };
}

export async function refuseLegacyProcess(project,{reset=false}={}) {
 let selected;try{selected=await selectedOrigin(project,{});}catch(error){if(!reset)throw error;}
 // Confirmed reset can recover malformed settings; checkout/state custody is
 // still checked even when there is no usable saved origin.
 const {localProcessConflict}=await shared('process-diagnostics.mjs');
 // The front door holds a door origin's port, not this checkout.
 const conflict=await localProcessConflict(project.root,selected?.door?undefined:selected?.savedOrigin);
 if(conflict)throw refuse(`A local process holds ${conflict.reason}: PID ${conflict.pid} (${conflict.command}). Stop it with kill -TERM ${conflict.pid}, then retry. Use rer dev --stop or rer preview --stop for a registered server.`);
}
