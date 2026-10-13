import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The pinned SDK supports whole diagnostic-store retirement, not subject deletion.
// The isolated helper owns the SDK's actual ChildProcess handles. Cancellation
// does not depend on a process-table inspection or an SDK readiness promise.
export async function retireLocalObservability(root, persist = '.wrangler/state', signal) {
 signal?.throwIfAborted();
 const state = resolve(root, persist), persistence = resolve(state, 'v3');
 const suffix = relative(resolve(root), state);
 if (!isAbsolute(persist) && (suffix === '..' || suffix.startsWith('..' + sep))) throw Error('Local diagnostic retirement requires an absolute state override when storage is outside the checkout.');
 const paths = [state, persistence, resolve(persistence, 'observability')];
 // Relative state is inside this checkout; reject redirected ancestors as well
 // as the SDK directory itself. Absolute overrides explicitly select a state root.
 if (!isAbsolute(persist)) {
  let parent = resolve(state, '..');
  while (parent.startsWith(resolve(root) + sep) && parent !== state) { paths.unshift(parent); parent = resolve(parent, '..'); }
 }
 for (const path of paths) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Local diagnostic retirement requires a real observability directory and state ancestors. Stop local runtimes and recover their placement before restarting.');
 }
 const temporary = await mkdtemp(resolve(tmpdir(), 'dial-diagnostic-retirement-'));
 const cancelled = new AbortController(), abort = () => cancelled.abort();
 const bounded = AbortSignal.any([cancelled.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
 process.once('SIGINT', abort); process.once('SIGTERM', abort);
 try {
  bounded.throwIfAborted();
  await new Promise((done, reject) => {
   // Terminal signals stay at the parent; the helper tears down through IPC.
   const child = spawn(process.execPath, [fileURLToPath(new URL('./observability-runtime.mjs', import.meta.url)), root, persistence, temporary], {
    cwd: root, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    // SDK scratch files must share the parent's disposable private directory.
    env: { PATH: process.env.PATH, TMPDIR: temporary, TMP: temporary, TEMP: temporary, SystemRoot: process.env.SystemRoot },
   });
   let failure, outcome, started = false, disconnected = false, finished = false;
   const finish = () => {
    if (finished || !outcome || !disconnected) return;
    finished = true;
    bounded.removeEventListener('abort', stop);
    if (failure || !started || outcome.code !== 0 || outcome.signal || bounded.aborted) reject(Error('Diagnostic helper failed.'));
    else done();
   };
   const stop = () => {
    // Before granting start, this exact Node handle cannot own SDK children.
    // Afterwards only its installed custodian may stop the native descendants.
    if (!started) { child.kill('SIGKILL'); return; }
    if (child.connected) child.send('cancel', error => { if (error && child.connected) child.disconnect(); });
   };
   child.once('error', error => { failure = error; });
   child.on('message', message => {
    if (message !== 'custody-ready' || started) return;
    if (bounded.aborted) { stop(); return; }
    started = true;
    child.send('start', error => { if (error && child.connected) child.disconnect(); });
   });
   child.once('disconnect', () => { disconnected = true; if (!started) stop(); finish(); });
   // Node 22's explicit IPC disconnect may omit ChildProcess.close. With all
   // three stdio descriptors ignored, exit plus disconnect closes our boundary.
   child.once('exit', (code, signal) => { outcome = { code, signal }; finish(); });
   child.once('close', (code, terminationSignal) => {
    outcome = { code, signal: terminationSignal }; disconnected = true; finish();
   });
   bounded.addEventListener('abort', stop, { once: true });
   if (bounded.aborted) stop();
  });
 } catch {
  // Never forward SDK responses: old traces can contain credentials or URLs.
  throw Error('Local diagnostic retirement failed. Stop local runtimes and retry; startup is refused until the SDK confirms its trace and log stores are empty.');
 } finally {
  process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
  await rm(temporary, { recursive: true, force: true });
 }
}
