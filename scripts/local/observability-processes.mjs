import { subscribe, unsubscribe } from 'node:diagnostics_channel';

// Node's native child_process channel supplies the actual handle before spawn.
// This runs only in the isolated utility: its SDK can launch workerd, but has
// no application, browser, container, debugger or external plugin bindings.
export function ownDiagnosticProcesses() {
 const children = new Set();
 let closing = false, runtime;
 let start;
 const started = new Promise(resolve => { start = resolve; });
 const kill = child => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
 };
 const finish = () => {
  // Exit synchronously once all native handles close: pending initialization
  // cannot resume and launch another child after custody has been retired.
  if (closing && children.size === 0) exit(1);
 };
 const capture = ({ process: child }) => {
  children.add(child);
  child.once('error', () => {});
  child.once('spawn', () => { if (closing) kill(child); });
  child.once('close', () => { children.delete(child); finish(); });
 };
 subscribe('child_process', capture);
 const stop = () => {
  if (closing) return;
  closing = true;
  // Dispose first aborts the SDK's initialization. Its public dispose awaits
  // readiness, so retain independent custody of every native process even if
  // that promise never settles. No numeric PID or process group is signalled.
  void runtime?.dispose().catch(() => {});
  for (const child of children) {
   // A synchronous spawn exception can leave a constructed handle without a
   // PID or a close event. It never acquired an operating-system process.
   if (child.pid === undefined) children.delete(child);
   else kill(child);
  }
  finish();
 };
 const message = message => {
  if (message === 'cancel') stop();
  else if (message === 'start') start();
 };
 process.on('message', message);
 process.once('disconnect', stop);
 process.on('uncaughtException', stop);
 process.on('unhandledRejection', stop);
 const deadline = setTimeout(stop, 30_000);
 const exit = code => {
  clearTimeout(deadline);
  unsubscribe('child_process', capture);
  process.removeListener('message', message);
  process.removeListener('disconnect', stop);
  process.removeListener('uncaughtException', stop);
  process.removeListener('unhandledRejection', stop);
  process.exit(code);
 };
 // A disconnect can precede module evaluation and its event is not replayed.
 if (!process.connected) stop();
 process.send('custody-ready', error => { if (error) stop(); });
 return {
  started,
  attach(value) { runtime = value; },
  fail: stop,
  async complete() {
   await runtime.dispose();
   // The successful SDK disposal must close all handles before acknowledging
   // success. The same deadline remains armed throughout disposal.
   await Promise.all([...children].map(child => new Promise(resolve => child.once('close', resolve))));
   exit(0);
  },
 };
}
