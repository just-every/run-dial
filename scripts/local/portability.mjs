import { lstat } from 'node:fs/promises';
import { RerError, refuse, missing } from '../base-cli/cli/errors.mjs';
// Base's CLI accepts only unserved locations (exports/ or an absolute path outside the checkout) before this hook runs.
async function transfer({ root, path, journal, store, signal, operationToken, target, origin, sessionFile }, direction) {
 if (target === 'remote' && direction !== 'export') throw refuse('Remote restore is not exposed. Import the hosted archive into an empty local installation.');
 if (target === 'remote' && (!origin || !sessionFile)) throw missing('Hosted export requires --origin and a private --session-file holding one native owner cookie.');
 if (direction === 'export' && await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; })) throw refuse('Export requires a new archive path.');
 if (target !== 'remote' && !await lstat(root + '/.dev.vars').catch(error => { if (error.code !== 'ENOENT') throw error; })) throw missing('Private settings are required. For import, privately restore the original SESSION_SECRET hash salt before importing; see OPERATIONS.md.');
 const env = { ...process.env, RER_LOCAL_OPERATION: operationToken, WRANGLER_SEND_METRICS: 'false' };
 if (target !== 'remote') {
 await store.run('Preparing local bindings', process.execPath, ['scripts/render-wrangler.mjs'], { cwd: root, signal, env });
 await store.run('Applying local data migrations', 'pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'dial-local', '--local', '--persist-to', '.wrangler/state', '--config', 'wrangler.toml'], { cwd: root, signal, env });
 }
 let output = '';
 const child = store.spawn(target === 'remote' ? 'Downloading complete hosted Dial data' : 'Moving complete local Dial data', process.execPath, target === 'remote' ? ['scripts/local/remote-export.mjs', origin, sessionFile, path] : ['scripts/local/transfer.mjs', direction, path, ...(journal ? [journal] : [])], { cwd: root, signal, env });
 child.stdout.on('data', chunk => { output += chunk; });
 const status = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
 let receipt; try { receipt = JSON.parse(output.trim().split('\n').at(-1)); } catch { throw new RerError('transfer_failed', 'Dial transfer returned no complete receipt.', 1); }
 if (status.code !== 0 || !receipt.ok) throw new RerError('transfer_failed', `Dial transfer failed (${receipt.reason ?? 'incomplete'}); preserve the archive and inspect the private log.`, receipt.exitCode ?? 1);
 delete receipt.ok;
 return { target: target ?? 'local', ...receipt };
}
export const portability = { remote: true, export: context => transfer(context, 'export'), import: context => transfer(context, 'import') };
